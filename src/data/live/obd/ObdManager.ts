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
  FUEL_LEVEL_PROBES,
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
import { PID_LABELS, hexPid, pidHealth, summarizeHealth, type PidHealth, type PidStat } from '../../../lib/obdDiag';
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

// A live ELM327 always answers something (data, NO DATA, SEARCHING…/STOPPED with the key
// off). This many commands in a row with not one byte back means the socket died — e.g.
// the head unit slept with the truck off and the RFCOMM link went stale without a
// disconnect event. Counted per command, NOT wall time: JS timers freeze while another
// app is in front (CarPlay, Maps), and that pause must not look like a dead dongle.
const DEAD_AFTER_SILENT_CMDS = 8;
const DTC_REREAD_MS = 60_000; // re-read codes at most once a minute while the MIL count > 0
const PROBE_EVERY = 25; // ticks between experimental ATF-probe attempts (never blocks FAST)
const TRANS_EVERY = 40; // ticks between ATF polls once a probe has answered
const FUEL_EVERY = 60; // ~every 8 s once it answers: enough samples for the 5-min slosh filter

/** A reply matcher: true when `frame` answers the in-flight command. */
type Match = (frame: string) => boolean;

/** Snapshot for SET → OBD DIAGNOSTICS. */
export interface ObdDiagnostics {
  /** adapter banner from ATZ, e.g. "ELM327 v2.2" */
  adapter: string | null;
  /** ATDPN result once the ECU answered, e.g. "A6" (auto, ISO 15765-4 CAN 11-bit 500k) */
  protocol: string | null;
  /** false = the support query got no answer (key off at connect) — everything is polled */
  supportKnown: boolean;
  /** every Mode 01 PID the truck says it supports (not just the ones the dash uses) */
  supported: number[];
  /** completed PID requests per second, last ~10 s */
  pollHz: number;
  ecuAwake: boolean;
  /** true while polling with the ELM "first reply" suffix (the faster mode) */
  fastReplies: boolean;
  transProbe: string | null;
  /** EXPERIMENTAL meter fuel-level probe that answered, or null */
  fuelProbe: string | null;
  rows: (PidStat & { label: string; health: PidHealth; inMask: boolean | null })[];
}

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
  // EXPERIMENTAL fuel-level probe (combination meter, 7C0) — same pattern as the ATF probe
  private fuelIdx = 0;
  private fuelWinner: RawProbe | null = null;
  private fuelL: Reading = { value: null, at: null };

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
  private dropCbs = new Set<() => void>();
  private dropped = false;
  private silentCmds = 0; // consecutive commands that got no bytes back
  private anyFrame = false;
  /**
   * Append the ELM327 "responses expected" digit ("010C1"): the adapter returns as soon
   * as the first ECU answers instead of waiting out its timeout for others. Measured on
   * the truck without it: ~150 ms per PID. Turned off for the session if the adapter
   * answers "?" (pre-v1.3 clones).
   */
  private oneReply = true;
  // diagnostics
  private stats = new Map<number, PidStat>();
  private adapterBanner: string | null = null;
  private protocol: string | null = null;
  private pollTimes: number[] = []; // completion times of recent PID requests (≤ 10 s)
  private lastLogAt = 0;

  private readonly cmdTimeoutMs = 1000;
  private readonly initTimeoutMs = 4000;

  get connected(): boolean {
    return this.initialized && this.transport?.status === 'connected';
  }

  /** the adapter's Bluetooth name, if the transport reported one */
  get adapterName(): string | null {
    return this.transport?.deviceName ?? null;
  }

  /** Called once if an established link drops (transport event or silence watchdog). */
  onDrop(cb: () => void): () => void {
    this.dropCbs.add(cb);
    return () => this.dropCbs.delete(cb);
  }

  /** Connect over an already-constructed transport, init, and begin polling. */
  /** "6" etc. — the last session's bus protocol, tried first (ATSPA6) instead of ATSP0 */
  protocolHintIn: string | null = null;

  async connect(transport: ObdTransport): Promise<void> {
    this.transport = transport;
    this.unsubFrame = transport.onFrame((frame) => this.onFrame(frame));
    this.unsubDisc = transport.onDisconnect(() => this.handleDrop());

    if (transport.status !== 'connected') await transport.connect();

    this.silentCmds = 0;
    await this.initialize();
    if (transport.status !== 'connected') throw new Error('OBD link dropped during init');
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
    const wasUp = this.initialized;
    this.running = false;
    this.initialized = false;
    this.clearPending(new Error('link dropped'));
    if (wasUp && !this.dropped) {
      this.dropped = true;
      this.dropCbs.forEach((cb) => cb());
    }
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
    this.silentCmds = 0; // any bytes at all = the link is alive
    this.anyFrame = true;
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
          this.silentCmds++;
          reject(new Error(`timeout: ${cmd}`));
        }, timeout);
        t.write(cmd).catch((e) => {
          if (this.pendingTimer) clearTimeout(this.pendingTimer);
          this.pending = null;
          this.silentCmds++; // the socket refused the write
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
    for (let i = 0; i < AT_INIT.length; i++) {
      // known protocol → "try it first, auto if it fails" skips the multi-second search
      const cmd = AT_INIT[i] === 'ATSP0' && this.protocolHintIn ? `ATSPA${this.protocolHintIn}` : AT_INIT[i];
      try {
        const raw = await this.send(cmd, null, this.initTimeoutMs);
        if (AT_INIT[i] === 'ATZ') {
          const banner = raw.split(/[\r\n]+/).map((l) => l.trim()).find((l) => /ELM|V\d/i.test(l));
          if (banner) this.adapterBanner = banner;
        }
      } catch {
        /* tolerate; ATSP0 may take a moment, polling will retry the bus */
      }
      // RFCOMM opened but the adapter never said a word (ATZ + ATE0): it's not really
      // there — fail the connect so the caller retries, instead of "connected" + no data
      if (i === 1 && !this.anyFrame) throw new Error('OBD adapter not responding');
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
      if (this.silentCmds >= DEAD_AFTER_SILENT_CMDS) {
        this.handleDrop(); // dead socket: let the owner reconnect
        break;
      }
      await this.pollPid(FAST[this.fastIdx]);
      this.fastIdx = (this.fastIdx + 1) % FAST.length;

      if (this.tick % 5 === 0) {
        // next SLOW pid the truck actually has — unsupported ones don't eat a slot, so
        // the real ones (coolant, fuel, volts…) refresh as fast as the bus allows
        for (let n = 0; n < SLOW.length; n++) {
          const pid = SLOW[this.slowIdx];
          this.slowIdx = (this.slowIdx + 1) % SLOW.length;
          if (this.isSupported(pid)) {
            await this.pollPid(pid);
            break;
          }
        }
      }
      if (this.tick % 200 === 0) await this.pollMonitor();

      // the ECU is asleep with the key off (every PID: SEARCHING…STOPPED) — codes and the
      // ATF probe only make sense once it has answered a FAST PID
      if (!this.ecuAwakeSeen && this.latest.has(PIDS.RPM)) {
        this.ecuAwakeSeen = true;
        // connected with the key off → discovery got nothing; learn the real set now
        if (this.supported.size === 0) await this.discoverSupport();
        await this.readProtocol();
        await this.readDtcs();
      }
      if (Date.now() - this.lastLogAt > 30_000) this.logSummary();
      if (this.ecuAwakeSeen && this.tick % PROBE_EVERY === 0 && !this.probeWinner && this.probeIdx < TRANS_TEMP_PROBES.length) {
        await this.probeTransTemp(TRANS_TEMP_PROBES[this.probeIdx++]);
      } else if (this.probeWinner && this.tick % TRANS_EVERY === 0) {
        await this.probeTransTemp(this.probeWinner);
      }
      // offset from the ATF probe so the two never land on the same tick
      if (this.ecuAwakeSeen && this.tick % PROBE_EVERY === 12 && !this.fuelWinner && this.fuelIdx < FUEL_LEVEL_PROBES.length) {
        await this.probeFuel(FUEL_LEVEL_PROBES[this.fuelIdx++]);
      } else if (this.fuelWinner && this.tick % FUEL_EVERY === 60) {
        await this.probeFuel(this.fuelWinner);
      }

      this.tick++;
      await sleep(5);
    }
  }

  private stat(pid: number): PidStat {
    let st = this.stats.get(pid);
    if (!st) {
      st = { pid, asked: 0, answered: 0, noData: 0, timeouts: 0, lastValue: null, lastAt: null };
      this.stats.set(pid, st);
    }
    return st;
  }

  private async pollPid(pid: number) {
    if (!this.running) return;
    if (!this.isSupported(pid)) return;
    const st = this.stat(pid);
    st.asked++;
    try {
      let raw = await this.send(pidCommand(pid) + (this.oneReply ? '1' : ''), pid);
      if (this.oneReply && raw.split(/[\r\n]+/).some((l) => l.replace(/>/g, '').trim() === '?')) {
        this.oneReply = false; // adapter doesn't know the response-count digit
        console.log('[OBD] adapter rejected the response-count suffix; polling without it');
        raw = await this.send(pidCommand(pid), pid);
      }
      const v = decodePidResponse(pid, raw);
      const now = Date.now();
      if (v !== null) {
        this.latest.set(pid, { value: v, at: now });
        st.answered++;
        st.lastValue = v;
        st.lastAt = now;
      } else st.noData++; // NO DATA / malformed → leave the prior reading to age out
      this.pollTimes.push(now);
    } catch {
      st.timeouts++; // timeout → age out
    }
    const cut = Date.now() - 10_000;
    while (this.pollTimes.length && this.pollTimes[0] < cut) this.pollTimes.shift();
  }

  /** ATDPN once the ECU has answered: which bus protocol auto-detect settled on. */
  private async readProtocol() {
    try {
      const raw = await this.send('ATDPN', null, 1000);
      const line = raw.split(/[\r\n]+/).map((l) => l.trim()).find((l) => /^A?[0-9A-C]$/i.test(l));
      if (line) this.protocol = line.toUpperCase();
    } catch {
      /* diagnostics only */
    }
  }

  /** Per-PID health for SET → OBD DIAGNOSTICS. */
  diagnostics(): ObdDiagnostics {
    const now = Date.now();
    const known = this.supported.size > 0;
    const polled = [...FAST, ...SLOW, PIDS.MONITOR_STATUS];
    const rows = polled.map((pid) => {
      const st = this.stats.get(pid) ?? { pid, asked: 0, answered: 0, noData: 0, timeouts: 0, lastValue: null, lastAt: null };
      const inMask = known ? this.supported.has(pid) : null;
      return { ...st, label: PID_LABELS[pid] ?? `PID ${hexPid(pid)}`, inMask, health: pidHealth(st, inMask, now) };
    });
    // the monitor-status PID is read by pollMonitor (not pollPid): reflect its result
    const mon = rows[rows.length - 1];
    if (this.dtc.at != null) Object.assign(mon, { answered: 1, lastAt: this.dtc.at, lastValue: this.dtc.count, health: pidHealth({ ...mon, answered: 1, lastAt: this.dtc.at }, mon.inMask, now) });
    return {
      adapter: this.adapterBanner,
      protocol: this.protocol,
      supportKnown: known,
      supported: [...this.supported].sort((a, b) => a - b),
      pollHz: Math.round((this.pollTimes.length / 10) * 10) / 10,
      ecuAwake: this.ecuAwakeSeen,
      fastReplies: this.oneReply,
      transProbe: this.probeWinner?.id ?? null,
      fuelProbe: this.fuelWinner?.id ?? null,
      rows,
    };
  }

  /** One line every 30 s → `adb logcat -s ReactNativeJS | grep "\[OBD\]"`. */
  private logSummary() {
    this.lastLogAt = Date.now();
    const d = this.diagnostics();
    console.log(
      `[OBD] ${d.adapter ?? 'adapter ?'} · proto ${d.protocol ?? '?'} · ${d.pollHz}/s · ecu ${d.ecuAwake ? 'awake' : 'asleep'} · ` +
        `mask ${d.supportKnown ? d.supported.map(hexPid).join(' ') : 'unknown'} · ${summarizeHealth(d.rows)}`
    );
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

  /** One EXPERIMENTAL ATF-temp attempt (TCM header). */
  private async probeTransTemp(p: RawProbe) {
    const c = await this.runProbe(p);
    if (c != null) {
      this.probeWinner = p;
      this.transC = { value: c, at: Date.now() };
    }
  }

  /** One EXPERIMENTAL fuel-level attempt (combination meter). */
  private async probeFuel(p: RawProbe) {
    const l = await this.runProbe(p);
    if (l != null) {
      this.fuelWinner = p;
      this.fuelL = { value: l, at: Date.now() };
    }
  }

  /**
   * Ask one module directly: set its header (and receive filter when its reply id is
   * outside the ELM default), send, then put both back. Exclusive, so a Mode 04 clear can
   * never go out with a module header in place.
   */
  private runProbe(p: RawProbe): Promise<number | null> {
    return this.exclusive(async () => {
      try {
        await this.send(`ATSH${p.header}`, null, 600);
        if (p.rx) await this.send(`ATCRA${p.rx}`, null, 600);
        const raw = await this.sendRaw(p.cmd, (f) => parseResponse(f, p.prefix) !== null, 600);
        return decodeProbe(p, raw);
      } catch {
        return null; // no answer from this candidate
      } finally {
        if (p.rx) {
          try {
            await this.send('ATCRA', null, 600); // back to the automatic receive filter
          } catch {
            /* restoreHeader below still runs */
          }
        }
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
  /** ATDPN result once the ECU answered (e.g. "A6"), else null */
  get protocolDetected(): string | null {
    return this.protocol;
  }
  /** EXPERIMENTAL tank level from the combination meter (litres); absent unless it answered */
  get fuelLevelL(): Reading {
    return this.fuelL;
  }
  /** which ATF probe answered (for the UI's EXPERIMENTAL note), or null */
  get transProbeId(): string | null {
    return this.probeWinner?.id ?? null;
  }
}
