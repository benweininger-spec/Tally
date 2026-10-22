/**
 * ELM327 driver / scheduler. Owns the OBD link lifecycle, runs the AT init
 * handshake, discovers which PIDs the truck supports, then round-robin polls a
 * fast group (RPM/speed/throttle/MAF/load) and interleaves a slow group
 * (temps/fuel/voltage/baro/runtime/fuel trims), plus a rare MIL / trouble-code check,
 * Mode 03/04 code read + clear, and an EXPERIMENTAL one-time Toyota ATF-temp probe.
 *
 * Talks only to an injected `ObdTransport` and the pure `src/lib/elm327.ts`
 * parser — no Bluetooth library here. Every read decays to stale → absent on
 * NO DATA / timeout; nothing throws into the render path.
 */
import {
  AT_INIT,
  DEFAULT_HEADER,
  PIDS,
  TRANS_TEMP_PROBES,
  pidCommand,
  parseObdResponse,
  parseResponse,
  classifyLine,
  decodeDtcs,
  decodePidResponse,
  decodeMonitorStatus,
  decodeProbe,
  decodeSupportMask,
  isClearAck,
  type RawProbe,
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
  PIDS.STFT_B1,
  PIDS.LTFT_B1,
];

const DTC_REREAD_MS = 60_000; // re-read codes at most once a minute while the MIL count > 0
const PROBE_EVERY = 25; // ticks between experimental ATF-probe attempts (never blocks FAST)
const TRANS_EVERY = 40; // ticks between ATF polls once a probe has answered

/** A reply matcher: true when `frame` answers the in-flight command. */
type Match = (frame: string) => boolean;

export interface DtcState {
  /** null = not read yet (or the ECU wasn't awake) — NOT the same as "no codes" */
  codes: string[] | null;
  at: number | null;
}

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

  private codes: DtcState = { codes: null, at: null };
  private codesReadAt = 0;
  private ecuAwakeSeen = false;
  // EXPERIMENTAL ATF-temp probe: tried once per connect, interleaved with polling
  private probeIdx = 0;
  private probeWinner: RawProbe | null = null;
  private transC: Reading = { value: null, at: null };

  // serialized request/response
  private queue: Promise<unknown> = Promise.resolve();
  // multi-command sections that change the CAN header (ATF probe) or must reach the
  // engine ECU (Mode 04 clear) — run one at a time so a CLEAR pressed mid-probe can't
  // be sent to the TCM's 7E1 header
  private section: Promise<unknown> = Promise.resolve();
  private pending: { resolve: (s: string) => void; reject: (e: Error) => void; match: Match | null } | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubFrame: (() => void) | null = null;
  private unsubDisc: (() => void) | null = null;

  private readonly cmdTimeoutMs = 1000;
  private readonly initTimeoutMs = 4000;

  get connected(): boolean {
    return this.initialized && this.transport?.status === 'connected';
  }

  /** the adapter's Bluetooth name, if the transport reported one */
  get adapterName(): string | null {
    return this.transport?.deviceName ?? null;
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
    const { match } = this.pending;
    // Correlate the frame with the command we're actually waiting for. A late frame
    // from a previously-timed-out command would otherwise resolve THIS request with
    // stale data stamped fresh. Only accept a frame that answers this command — OR a
    // terminal status (NO DATA/error), so unsupported requests still resolve (to null)
    // instead of hanging until timeout. AT commands (match null) accept any frame.
    if (match && !match(frame) && !this.isTerminal(frame)) return; // stale/cross-command late frame
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
   *  `expectPid` is the Mode-01 PID this command should answer (null for AT),
   *  used by onFrame to reject stale late frames. */
  private send(cmd: string, expectPid: number | null = null, timeout = this.cmdTimeoutMs): Promise<string> {
    return this.sendRaw(cmd, expectPid == null ? null : (f) => parseObdResponse(f, expectPid) !== null, timeout);
  }

  /** Any-mode command: `match` recognises its reply (e.g. a 43 / 44 / 61 82 prefix). */
  private sendRaw(cmd: string, match: Match | null, timeout = this.cmdTimeoutMs): Promise<string> {
    const run = (): Promise<string> =>
      new Promise<string>((resolve, reject) => {
        const t = this.transport;
        if (!t) return reject(new Error('no transport'));
        this.pending = { resolve, reject, match };
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

  /** Run `fn` exclusively against other sections (single commands still interleave). */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.section.then(fn, fn);
    this.section = next.catch(() => undefined);
    return next;
  }

  /** Point requests back at the functional broadcast header; one retry. */
  private async restoreHeader() {
    for (let i = 0; i < 2; i++) {
      try {
        await this.send(`ATSH${DEFAULT_HEADER}`, null, 600);
        return;
      } catch {
        /* retry once */
      }
    }
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

      // the ECU is asleep with the key off (every PID: SEARCHING…STOPPED) — codes and the
      // ATF probe only make sense once it has answered a FAST PID
      if (!this.ecuAwakeSeen && this.latest.has(PIDS.RPM)) {
        this.ecuAwakeSeen = true;
        await this.readDtcs();
      }
      if (this.ecuAwakeSeen && this.tick % PROBE_EVERY === 0 && !this.probeWinner && this.probeIdx < TRANS_TEMP_PROBES.length) {
        await this.probeTransTemp(TRANS_TEMP_PROBES[this.probeIdx++]);
      } else if (this.probeWinner && this.tick % TRANS_EVERY === 0) {
        await this.probeTransTemp(this.probeWinner);
      }

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
      if (!ms) return;
      this.dtc = { count: ms.dtcCount, milOn: ms.milOn, at: Date.now() };
      if (ms.dtcCount === 0) this.codes = { codes: [], at: Date.now() };
      else if (Date.now() - this.codesReadAt > DTC_REREAD_MS) await this.readDtcs();
    } catch {
      /* ignore */
    }
  }

  /** Mode 03: stored trouble codes. Leaves `codes` unknown if the ECU didn't answer. */
  async readDtcs(): Promise<string[] | null> {
    this.codesReadAt = Date.now();
    try {
      const raw = await this.sendRaw('03', (f) => parseResponse(f, [0x43]) !== null, 2000);
      if (parseResponse(raw, [0x43]) !== null) {
        this.codes = { codes: decodeDtcs(raw), at: Date.now() };
      } else if (raw.split(/[\r\n]+/).some((l) => classifyLine(l) === 'no-data')) {
        this.codes = { codes: [], at: Date.now() }; // some ECUs answer NO DATA for "none"
      }
    } catch {
      /* timeout — keep whatever we knew */
    }
    return this.codes.codes;
  }

  /**
   * Mode 04: clear stored codes and turn the MIL off, then re-read status + codes.
   * UNTESTED ON THE TRUCK (key-on not tried yet). Many ECUs only accept it key-ON /
   * engine-OFF; a refusal rejects with a readable message.
   */
  async clearDtcs(): Promise<void> {
    if (!this.connected) throw new Error('OBD not connected');
    await this.exclusive(async () => {
      await this.restoreHeader(); // belt and braces: Mode 04 must go to 7DF, never a module header
      const raw = await this.sendRaw('04', (f) => parseResponse(f, [0x44]) !== null, 5000);
      if (!isClearAck(raw)) throw new Error('ECU did not accept the clear (try key ON, engine OFF)');
      // re-read inside the section too, so a probe can't retarget Mode 01/03 to the TCM
      await this.pollMonitor();
      await this.readDtcs();
    });
  }

  /** One EXPERIMENTAL ATF-temp attempt: set the TCM header, ask, restore 7DF. */
  private probeTransTemp(p: RawProbe) {
    return this.exclusive(async () => {
      try {
        await this.send(`ATSH${p.header}`, null, 600);
        const raw = await this.sendRaw(p.cmd, (f) => parseResponse(f, p.prefix) !== null, 600);
        const c = decodeProbe(p, raw);
        if (c != null) {
          this.probeWinner = p;
          this.transC = { value: c, at: Date.now() };
        }
      } catch {
        /* no answer from this candidate */
      } finally {
        await this.restoreHeader();
      }
    });
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
  get dtcCodes(): DtcState {
    return this.codes;
  }
  /** EXPERIMENTAL Toyota ATF temperature (°C); absent until a probe answers */
  get transTempC(): Reading {
    return this.transC;
  }
  /** which ATF probe answered (for the UI's EXPERIMENTAL note), or null */
  get transProbeId(): string | null {
    return this.probeWinner?.id ?? null;
  }
}
