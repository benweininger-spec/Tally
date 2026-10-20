/**
 * ELM327 driver / scheduler. Owns the OBD link lifecycle, runs the AT init
 * handshake, discovers which PIDs the truck supports, then round-robin polls a
 * fast group (RPM/speed/throttle/MAF/load) and interleaves a slow group
 * (temps/fuel/voltage/baro/runtime), plus a rare DTC check.
 *
 * Talks only to an injected `ObdTransport` and the pure `src/lib/elm327.ts`
 * parser — no Bluetooth library here. Every read decays to stale → absent on
 * NO DATA / timeout; nothing throws into the render path.
 */
import {
  AT_INIT,
  PIDS,
  pidCommand,
  parseObdResponse,
  classifyLine,
  decodePidResponse,
  decodeMonitorStatus,
  decodeSupportMask,
} from '../../../lib/elm327';
import type { ObdTransport } from './transport';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface Reading {
  value: number | null;
  /** epoch ms of the last successful decode, or null if never */
  at: number | null;
}

const FAST = [PIDS.RPM, PIDS.SPEED, PIDS.THROTTLE, PIDS.MAF, PIDS.ENGINE_LOAD];
const SLOW = [
  PIDS.COOLANT_TEMP,
  PIDS.INTAKE_TEMP,
  PIDS.MAP,
  PIDS.FUEL_LEVEL,
  PIDS.CTRL_VOLTAGE,
  PIDS.BARO,
  PIDS.AMBIENT_TEMP,
  PIDS.OIL_TEMP,
  PIDS.RUNTIME,
];

export class ObdManager {
  private transport: ObdTransport | null = null;
  private running = false;
  private initialized = false;

  private latest = new Map<number, Reading>();
  private supported = new Set<number>();
  private dtc: { count: number | null; milOn: boolean; at: number | null } = {
    count: null,
    milOn: false,
    at: null,
  };

  private fastIdx = 0;
  private slowIdx = 0;
  private tick = 0;

  // serialized request/response
  private queue: Promise<unknown> = Promise.resolve();
  private pending:
    | { resolve: (s: string) => void; reject: (e: Error) => void; expectPid: number | null }
    | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubFrame: (() => void) | null = null;
  private unsubDisc: (() => void) | null = null;

  private readonly cmdTimeoutMs = 1000;
  private readonly initTimeoutMs = 4000;

  get connected(): boolean {
    return this.initialized && this.transport?.status === 'connected';
  }

  /** Connect over an already-constructed transport, init, and begin polling. */
  async connect(transport: ObdTransport): Promise<void> {
    this.transport = transport;
    this.unsubFrame = transport.onFrame((frame) => this.onFrame(frame));
    this.unsubDisc = transport.onDisconnect(() => this.handleDrop());

    if (transport.status !== 'connected') await transport.connect();

    await this.initialize();
    this.initialized = true;
    this.running = true;
    void this.loop();
  }

  disconnect(): void {
    this.running = false;
    this.initialized = false;
    this.clearPending(new Error('disconnected'));
    this.unsubFrame?.();
    this.unsubDisc?.();
    this.unsubFrame = null;
    this.unsubDisc = null;
    const t = this.transport;
    this.transport = null;
    void t?.disconnect();
  }

  private handleDrop() {
    this.running = false;
    this.initialized = false;
    this.clearPending(new Error('link dropped'));
  }

  // ---- request/response over the transport ----------------------------------
  /** A frame is terminal if any of its lines is a NO DATA / error status, using the
   *  authoritative pure classifier (no parallel regex to drift out of sync). */
  private isTerminal(frame: string): boolean {
    return frame.split(/[\r\n]+/).some((l) => {
      const s = classifyLine(l);
      return s === 'no-data' || s === 'error';
    });
  }

  private onFrame(frame: string) {
    if (!this.pending) return; // stray frame after timeout — ignore
    const { expectPid } = this.pending;
    // Correlate the frame with the command we're actually waiting for. A late frame
    // from a previously-timed-out command would otherwise resolve THIS request with
    // stale data stamped fresh. For a PID command, only accept a frame that parses as
    // that PID's response — OR a terminal status (NO DATA/error), so unsupported PIDs
    // still resolve (to null) instead of hanging until timeout. AT commands
    // (expectPid null) accept any frame.
    if (expectPid != null) {
      const matches = parseObdResponse(frame, expectPid) !== null;
      if (!matches && !this.isTerminal(frame)) return; // stale/cross-PID late frame — keep waiting
    }
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    const p = this.pending;
    this.pending = null;
    p.resolve(frame);
  }

  private clearPending(err: Error) {
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
    const p = this.pending;
    this.pending = null;
    p?.reject(err);
  }

  /** Send one command and resolve with the complete response (delimited at '>').
   *  `expectPid` is the Mode-01 PID this command should answer (null for AT/raw),
   *  used by onFrame to reject stale late frames. */
  private send(cmd: string, expectPid: number | null = null, timeout = this.cmdTimeoutMs): Promise<string> {
    const run = (): Promise<string> =>
      new Promise<string>((resolve, reject) => {
        const t = this.transport;
        if (!t) return reject(new Error('no transport'));
        this.pending = { resolve, reject, expectPid };
        this.pendingTimer = setTimeout(() => {
          this.pending = null;
          reject(new Error(`timeout: ${cmd}`));
        }, timeout);
        t.write(cmd).catch((e) => {
          if (this.pendingTimer) clearTimeout(this.pendingTimer);
          this.pending = null;
          reject(e instanceof Error ? e : new Error(String(e)));
        });
      });
    // chain so only one command is ever in flight
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async initialize() {
    for (const cmd of AT_INIT) {
      try {
        await this.send(cmd, null, this.initTimeoutMs);
      } catch {
        /* tolerate; ATSP0 may take a moment, polling will retry the bus */
      }
      await sleep(60);
    }
    await this.discoverSupport();
  }

  private async discoverSupport() {
    for (const base of [0x00, 0x20, 0x40]) {
      try {
        const raw = await this.send(pidCommand(base), base);
        decodeSupportMask(raw, base).forEach((p) => this.supported.add(p));
      } catch {
        /* best-effort: if discovery fails we poll everything */
      }
    }
  }

  private isSupported(pid: number): boolean {
    // if discovery yielded nothing, don't gate — just poll
    return this.supported.size === 0 || this.supported.has(pid);
  }

  private async loop() {
    while (this.running) {
      await this.pollPid(FAST[this.fastIdx]);
      this.fastIdx = (this.fastIdx + 1) % FAST.length;

      if (this.tick % 5 === 0) {
        await this.pollPid(SLOW[this.slowIdx]);
        this.slowIdx = (this.slowIdx + 1) % SLOW.length;
      }
      if (this.tick % 200 === 0) await this.pollMonitor();

      this.tick++;
      await sleep(5);
    }
  }

  private async pollPid(pid: number) {
    if (!this.running) return;
    if (!this.isSupported(pid)) return;
    try {
      const raw = await this.send(pidCommand(pid), pid);
      const v = decodePidResponse(pid, raw);
      if (v !== null) this.latest.set(pid, { value: v, at: Date.now() });
      // null (NO DATA / malformed) → leave the prior reading to age out
    } catch {
      /* timeout → age out */
    }
  }

  private async pollMonitor() {
    try {
      const raw = await this.send(pidCommand(PIDS.MONITOR_STATUS), PIDS.MONITOR_STATUS);
      const ms = decodeMonitorStatus(raw);
      if (ms) this.dtc = { count: ms.dtcCount, milOn: ms.milOn, at: Date.now() };
    } catch {
      /* ignore */
    }
  }

  // ---- reads for LiveDataSource ---------------------------------------------
  read(pid: number): Reading {
    return this.latest.get(pid) ?? { value: null, at: null };
  }

  get dtcCount(): Reading {
    return { value: this.dtc.count, at: this.dtc.at };
  }
  get milOn(): boolean {
    return this.dtc.milOn;
  }
}
