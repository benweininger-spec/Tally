/**
 * ELM327 / OBD-II Mode 01 protocol + parser. PURE — no imports, no I/O.
 *
 * The transport layer (Bluetooth) hands raw response strings to these functions;
 * they validate framing and decode PID bytes into ENGINEERING units (°C, km/h,
 * kPa, V, %, RPM, g/s). UI-unit conversion (°F, mph) is done separately in
 * `src/lib/units.ts` at the source layer, so this file stays about the protocol.
 *
 * Decode formulas are SAE J1979 (verified against the Wikipedia "OBD-II PIDs"
 * table and the ELM327 datasheet). Runs under `node --experimental-strip-types`
 * for `scripts/verify.ts`. Keep it self-contained.
 *
 * Vehicle: 2016 Tacoma 2.7L 2TR-FE, naturally aspirated — no boost PID by design.
 */

// ---- AT init handshake ------------------------------------------------------
/**
 * Sent once on connect, in order, each terminated by CR ('\r'), waiting for the
 * '>' prompt between commands. ATE0 (echo off) + ATS0 (no spaces) + ATL0 (no LF)
 * + ATH0 (no headers) make responses trivial to parse; ATSP0 auto-detects the
 * bus (Tacoma is ISO 15765-4 CAN 11-bit/500k); ATAT1 adapts timing.
 */
export const AT_INIT: readonly string[] = ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATAT1', 'ATSP0'];

export const CR = '\r';
/** Build the wire command for a Mode 01 PID, e.g. pidCommand(0x0c) -> "010C". */
export function pidCommand(pid: number, mode = 0x01): string {
  return hex2(mode) + hex2(pid);
}
const hex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');

// ---- framing / status -------------------------------------------------------
const NON_DATA = [
  'SEARCHING',
  'NO DATA',
  'STOPPED',
  'UNABLE TO CONNECT',
  'BUS INIT',
  'BUS ERROR',
  'CAN ERROR',
  'BUFFER FULL',
  'ERROR',
  '?',
  'OK',
];

/** Strip the '>' prompt, CR/LF, spaces; uppercase. */
export function cleanLine(raw: string): string {
  return raw.replace(/>/g, '').replace(/[\r\n]/g, '').replace(/\s+/g, '').toUpperCase();
}

/** Human-status of a raw line (for marking Signals stale/absent vs. parsing). */
export type LineStatus = 'data' | 'searching' | 'no-data' | 'error' | 'empty';
export function classifyLine(raw: string): LineStatus {
  const u = raw.replace(/>/g, '').trim().toUpperCase();
  if (u.length === 0) return 'empty';
  if (u.startsWith('SEARCHING')) return 'searching';
  if (u.startsWith('NO DATA')) return 'no-data';
  if (
    u === '?' ||
    u.startsWith('STOPPED') ||
    u.startsWith('UNABLE') ||
    u.startsWith('BUS') ||
    u.startsWith('CAN ') ||
    u.startsWith('ERROR') ||
    u.startsWith('BUFFER')
  ) {
    return 'error';
  }
  return 'data';
}

/** Parse a hex string ("410C1AF8" or "41 0C 1A F8") into byte values. */
export function hexBytes(s: string): number[] {
  const c = cleanLine(s);
  const out: number[] = [];
  for (let i = 0; i + 1 < c.length; i += 2) {
    const b = parseInt(c.slice(i, i + 2), 16);
    if (Number.isNaN(b)) return [];
    out.push(b);
  }
  return out;
}

/**
 * Validate a Mode 01 response and return its DATA bytes (after the `41 <pid>`
 * prefix), or null if it isn't a clean answer to `expectedPid`.
 * Handles ELM327 chatter by scanning lines and ignoring SEARCHING / NO DATA / etc.
 * Multi-frame ISO-TP lines prefixed with a "N:" line counter are stripped & joined.
 */
export function parseObdResponse(raw: string, expectedPid: number, mode = 0x01): number[] | null {
  const respMode = mode + 0x40; // 0x01 -> 0x41
  const lines = raw.split(/[\r\n]+/);
  // collect candidate data bytes, dropping ISO-TP "0:" / "1:" frame counters
  let bytes: number[] = [];
  for (const line of lines) {
    if (classifyLine(line) !== 'data') continue;
    const cleaned = cleanLine(line).replace(/^[0-9A-F]:/, ''); // drop leading "N:" counter
    const lb = hexBytes(cleaned);
    if (lb.length) bytes = bytes.concat(lb);
  }
  // find the "41 <pid>" prefix and return what follows
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] === respMode && bytes[i + 1] === expectedPid) {
      return bytes.slice(i + 2);
    }
  }
  return null;
}

// ---- PID decoders (return ENGINEERING units) --------------------------------
export interface PidDef {
  pid: number;
  name: string;
  /** minimum data bytes required */
  bytes: number;
  unit: string;
  decode: (b: number[]) => number;
}

const A = (b: number[]) => b[0];
const AB = (b: number[]) => b[0] * 256 + b[1];

/** All Mode 01 PIDs this dashboard reads, keyed by PID number. */
export const PIDS = {
  ENGINE_LOAD: 0x04,
  COOLANT_TEMP: 0x05,
  STFT_B1: 0x06,
  LTFT_B1: 0x07,
  MAP: 0x0b,
  RPM: 0x0c,
  SPEED: 0x0d,
  INTAKE_TEMP: 0x0f,
  MAF: 0x10,
  THROTTLE: 0x11,
  RUNTIME: 0x1f,
  FUEL_LEVEL: 0x2f,
  BARO: 0x33,
  CTRL_VOLTAGE: 0x42,
  AMBIENT_TEMP: 0x46,
  OIL_TEMP: 0x5c,
  MONITOR_STATUS: 0x01,
} as const;

export const PID_DEFS: Readonly<Record<number, PidDef>> = {
  0x04: { pid: 0x04, name: 'engineLoad', bytes: 1, unit: '%', decode: (b) => A(b) / 2.55 },
  0x05: { pid: 0x05, name: 'coolantTemp', bytes: 1, unit: '°C', decode: (b) => A(b) - 40 },
  // fuel trims: 128 = 0 %, below = removing fuel (rich), above = adding fuel (lean)
  0x06: { pid: 0x06, name: 'stftB1', bytes: 1, unit: '%', decode: (b) => ((A(b) - 128) * 100) / 128 },
  0x07: { pid: 0x07, name: 'ltftB1', bytes: 1, unit: '%', decode: (b) => ((A(b) - 128) * 100) / 128 },
  0x0b: { pid: 0x0b, name: 'map', bytes: 1, unit: 'kPa', decode: (b) => A(b) },
  0x0c: { pid: 0x0c, name: 'rpm', bytes: 2, unit: 'rpm', decode: (b) => AB(b) / 4 },
  0x0d: { pid: 0x0d, name: 'speed', bytes: 1, unit: 'km/h', decode: (b) => A(b) },
  0x0f: { pid: 0x0f, name: 'intakeTemp', bytes: 1, unit: '°C', decode: (b) => A(b) - 40 },
  0x10: { pid: 0x10, name: 'maf', bytes: 2, unit: 'g/s', decode: (b) => AB(b) / 100 },
  0x11: { pid: 0x11, name: 'throttle', bytes: 1, unit: '%', decode: (b) => A(b) / 2.55 },
  0x1f: { pid: 0x1f, name: 'runtime', bytes: 2, unit: 's', decode: (b) => AB(b) },
  0x2f: { pid: 0x2f, name: 'fuelLevel', bytes: 1, unit: '%', decode: (b) => A(b) / 2.55 },
  0x33: { pid: 0x33, name: 'baro', bytes: 1, unit: 'kPa', decode: (b) => A(b) },
  0x42: { pid: 0x42, name: 'ctrlVoltage', bytes: 2, unit: 'V', decode: (b) => AB(b) / 1000 },
  0x46: { pid: 0x46, name: 'ambientTemp', bytes: 1, unit: '°C', decode: (b) => A(b) - 40 },
  0x5c: { pid: 0x5c, name: 'oilTemp', bytes: 1, unit: '°C', decode: (b) => A(b) - 40 },
};

/**
 * Decode a full raw response for `pid` into its engineering value, or null if the
 * frame is missing / malformed / too short. Never throws — callers mark the
 * matching Signal `stale`/`absent` on null.
 */
export function decodePidResponse(pid: number, raw: string): number | null {
  const def = PID_DEFS[pid];
  if (!def) return null;
  const data = parseObdResponse(raw, pid);
  if (!data || data.length < def.bytes) return null;
  const v = def.decode(data);
  return Number.isFinite(v) ? v : null;
}

// ---- MIL / DTC count (PID 01) ----------------------------------------------
export interface MonitorStatus {
  milOn: boolean;
  dtcCount: number;
}
/** Decode PID 01 byte A: bit7 = MIL lamp, low 7 bits = stored DTC count. */
export function decodeMonitorStatus(raw: string): MonitorStatus | null {
  const data = parseObdResponse(raw, PIDS.MONITOR_STATUS);
  if (!data || data.length < 1) return null;
  const a = data[0];
  return { milOn: (a & 0x80) !== 0, dtcCount: a & 0x7f };
}

// ---- generic response framing (any mode) -------------------------------------
/**
 * Split a raw ELM327 response into MESSAGES of data bytes. Handles the two shapes
 * headers-off (ATH0) output takes:
 *   • one message per line (single-frame CAN, or legacy protocols / several ECUs);
 *   • an ISO-TP multi-frame answer: a 3-hex-digit total-length line ("00A") followed
 *     by "0:" "1:" … frames, reassembled into ONE message and trimmed to that length
 *     (the last frame carries padding).
 * Status lines (SEARCHING, NO DATA, …) are skipped.
 */
export function responseMessages(raw: string): number[][] {
  const lines = raw.split(/[\r\n]+/).filter((l) => classifyLine(l) === 'data');
  const msgs: number[][] = [];
  let multi: number[] | null = null;
  let multiLen = 0;
  for (const line of lines) {
    const c = cleanLine(line);
    if (/^[0-9A-F]{3}$/.test(c)) {
      // ISO-TP total-length header starts a reassembled message
      if (multi) msgs.push(multi.slice(0, multiLen));
      multi = [];
      multiLen = parseInt(c, 16);
      continue;
    }
    const framed = /^[0-9A-F]:/.test(c);
    const bytes = hexBytes(c.replace(/^[0-9A-F]:/, ''));
    if (!bytes.length) continue;
    if (multi && framed) multi.push(...bytes);
    else {
      if (multi) {
        msgs.push(multi.slice(0, multiLen));
        multi = null;
      }
      msgs.push(bytes);
    }
  }
  if (multi) msgs.push(multi.slice(0, multiLen));
  return msgs;
}

/** Data bytes following `prefix` in the first message that starts with it (any mode), or null. */
export function parseResponse(raw: string, prefix: readonly number[]): number[] | null {
  for (const m of responseMessages(raw)) {
    for (let i = 0; i + prefix.length <= m.length; i++) {
      if (prefix.every((b, k) => m[i + k] === b)) return m.slice(i + prefix.length);
    }
  }
  return null;
}

// ---- Mode 03 stored DTCs ----------------------------------------------------
const DTC_LETTERS = ['P', 'C', 'B', 'U'] as const;

const dtcString = (hi: number, lo: number) =>
  `${DTC_LETTERS[(hi & 0xc0) >> 6]}${(hi & 0x30) >> 4}${(hi & 0x0f).toString(16).toUpperCase()}${lo
    .toString(16)
    .toUpperCase()
    .padStart(2, '0')}`;

/**
 * Decode a Mode 03 (stored) — or, with respByte 0x47, Mode 07 (pending) — response.
 * Two wire formats exist and the 2016 Tacoma uses the FIRST:
 *   • CAN / ISO 15765: `43 <count> <hi lo> × count` — e.g. "43 01 01 33" = P0133. An
 *     odd body length (1 + 2·count) identifies it; multi-frame answers are reassembled.
 *   • Legacy (J1850 / ISO 9141 / KWP): `43 <hi lo> × 3`, unused slots padded 00 00.
 * Each ECU answers in its own message; codes are de-duplicated.
 */
export function decodeDtcs(raw: string, respByte = 0x43): string[] {
  const out: string[] = [];
  for (const m of responseMessages(raw)) {
    const start = m.indexOf(respByte);
    if (start < 0) continue;
    let body = m.slice(start + 1);
    if (body.length % 2 === 1) {
      const count = body[0];
      body = body.slice(1, 1 + count * 2); // CAN: count byte first
    }
    for (let i = 0; i + 1 < body.length; i += 2) {
      if (body[i] === 0 && body[i + 1] === 0) continue; // padding = no code
      const code = dtcString(body[i], body[i + 1]);
      if (!out.includes(code)) out.push(code);
    }
  }
  return out;
}

/** Mode 04 (clear codes + MIL) answers 0x44 when the ECU accepted it. */
export const isClearAck = (raw: string) => parseResponse(raw, [0x44]) !== null;

// ---- EXPERIMENTAL: Toyota transmission (ATF) temperature -------------------
/**
 * EXPERIMENTAL — NOT VERIFIED ON THIS TRUCK. Toyota publishes no standard PID for ATF
 * temperature; owners' scan-tool communities cite a few manufacturer requests to the
 * transmission ECU (CAN header 7E1 → replies 7E9). Each candidate is tried ONCE on
 * connect (after discovery, interleaved with normal polling); the first that returns a
 * parseable, in-range value wins and is polled rarely after that. None answering → the
 * reading stays absent. Every candidate uses Toyota's usual temperature encoding, A − 40
 * °C, which is itself an assumption: check against a scan tool before trusting it.
 */
export interface RawProbe {
  id: string;
  /** CAN request header to set with ATSH before sending (restored to 7DF after) */
  header: string;
  cmd: string;
  /** reply bytes preceding the data, e.g. 61 82 for request 21 82 */
  prefix: readonly number[];
  decode: (data: number[]) => number;
}

export const TRANS_TEMP_PROBES: readonly RawProbe[] = [
  { id: 'tcm-21-82', header: '7E1', cmd: '2182', prefix: [0x61, 0x82], decode: (b) => b[0] - 40 },
  { id: 'tcm-22-0182', header: '7E1', cmd: '220182', prefix: [0x62, 0x01, 0x82], decode: (b) => b[0] - 40 },
  { id: 'tcm-22-1e1c', header: '7E1', cmd: '221E1C', prefix: [0x62, 0x1e, 0x1c], decode: (b) => b[0] - 40 },
];

/** Plausible ATF range (°C); anything outside means the candidate isn't ATF temp. */
export const ATF_RANGE_C: readonly [number, number] = [-30, 160];
export const DEFAULT_HEADER = '7DF';

/** Decode a probe's raw reply to °C, or null if missing / malformed / implausible. */
export function decodeProbe(p: RawProbe, raw: string): number | null {
  const data = parseResponse(raw, p.prefix);
  if (!data || data.length < 1) return null;
  const v = p.decode(data);
  return Number.isFinite(v) && v >= ATF_RANGE_C[0] && v <= ATF_RANGE_C[1] ? v : null;
}

// ---- PID-support bitmask (00 / 20 / 40 ...) --------------------------------
/**
 * Decode a support-bitmask response (PID 00/20/40/60). `base` is the PID the mask
 * is relative to (0x00→covers 01..20). Returns the list of supported PID numbers.
 * Bit31 (A bit7) = base+1 … bit0 (D bit0) = base+32. The lowest bit signals the
 * next block exists.
 */
export function decodeSupportMask(raw: string, base: number): number[] {
  const data = parseObdResponse(raw, base);
  if (!data || data.length < 4) return [];
  const mask = ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0;
  const supported: number[] = [];
  for (let bit = 0; bit < 32; bit++) {
    if (mask & (1 << (31 - bit))) supported.push(base + bit + 1);
  }
  return supported;
}
