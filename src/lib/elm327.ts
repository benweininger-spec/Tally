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

// ---- Mode 03 stored DTCs ----------------------------------------------------
const DTC_LETTERS = ['P', 'C', 'B', 'U'] as const;
/** Decode a Mode 03 response (prefix 0x43, then 2 bytes per code) to code strings. */
export function decodeDtcs(raw: string): string[] {
  const lines = raw.split(/[\r\n]+/);
  let bytes: number[] = [];
  for (const line of lines) {
    if (classifyLine(line) !== 'data') continue;
    const lb = hexBytes(cleanLine(line).replace(/^[0-9A-F]:/, ''));
    if (lb.length) bytes = bytes.concat(lb);
  }
  const start = bytes.indexOf(0x43);
  if (start < 0) return [];
  const body = bytes.slice(start + 1);
  const codes: string[] = [];
  for (let i = 0; i + 1 < body.length; i += 2) {
    const hi = body[i];
    const lo = body[i + 1];
    if (hi === 0 && lo === 0) continue; // padding = no code
    const letter = DTC_LETTERS[(hi & 0xc0) >> 6];
    const d1 = (hi & 0x30) >> 4;
    const d2 = hi & 0x0f;
    const d34 = lo.toString(16).toUpperCase().padStart(2, '0');
    codes.push(`${letter}${d1}${d2.toString(16).toUpperCase()}${d34}`);
  }
  return codes;
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
