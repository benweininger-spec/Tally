/**
 * OBD diagnostics — what the truck says it supports vs what actually answers, per PID.
 * Pure (verify-tested); ObdManager keeps the counters, SET → OBD DIAGNOSTICS and the
 * periodic logcat line (`adb logcat -s ReactNativeJS | grep OBD`) present them.
 */

export interface PidStat {
  pid: number;
  /** requests sent */
  asked: number;
  /** decoded answers */
  answered: number;
  /** NO DATA / unparseable replies */
  noData: number;
  /** no reply at all within the command timeout */
  timeouts: number;
  lastValue: number | null;
  lastAt: number | null;
}

export type PidHealth =
  | 'ok' // answering
  | 'slow' // answered before, nothing recent
  | 'no-data' // asked, never decoded (the ECU replies NO DATA)
  | 'unsupported' // the support mask says the truck doesn't have it — never asked
  | 'waiting'; // not asked yet

/** Plain names for the PIDs the dash polls, as SET shows them. */
export const PID_LABELS: Readonly<Record<number, string>> = {
  0x01: 'Check-engine status',
  0x04: 'Engine load',
  0x05: 'Coolant temp',
  0x06: 'Short fuel trim B1',
  0x07: 'Long fuel trim B1',
  0x0b: 'Manifold pressure (MAP)',
  0x0c: 'RPM',
  0x0d: 'Vehicle speed',
  0x0f: 'Intake air temp',
  0x10: 'Mass air flow (MAF)',
  0x11: 'Throttle',
  0x1f: 'Run time',
  0x2f: 'Fuel level',
  0x33: 'Barometric pressure',
  0x42: 'ECU voltage',
  0x46: 'Ambient air temp',
  0x5c: 'Oil temp',
};

/** what each polled PID feeds on screen (so "no data" reads as a consequence, not a code) */
export const PID_FEEDS: Readonly<Record<number, string>> = {
  0x04: 'load bar, HP estimate',
  0x05: 'coolant / warm-up',
  0x06: 'short trim bar',
  0x07: 'long trim bar',
  0x0b: 'MAP tile',
  0x0c: 'RPM ring + bar',
  0x0d: 'speed fallback',
  0x0f: 'intake tile',
  0x10: 'MPG, fuel used, HP',
  0x11: 'throttle bar',
  0x1f: 'run-time tile',
  0x2f: 'fuel tile',
  0x33: 'baro tile',
  0x42: 'ECU volts',
  0x46: 'ambient tile',
  0x5c: 'oil tile',
};

export const hexPid = (pid: number) => pid.toString(16).toUpperCase().padStart(2, '0');

/**
 * @param inMask true/false from the support mask, null when the mask is unknown
 *   (discovery failed — usually connected with the key off — so everything is polled)
 * @param recentMs an answer newer than this counts as `ok`
 */
export function pidHealth(stat: PidStat | undefined, inMask: boolean | null, now: number, recentMs = 30_000): PidHealth {
  if (stat && stat.answered > 0 && stat.lastAt != null) return now - stat.lastAt <= recentMs ? 'ok' : 'slow';
  if (inMask === false) return 'unsupported';
  if (!stat || stat.asked === 0) return 'waiting';
  return 'no-data';
}

/** One logcat-friendly line: `ok: 0C 0D … · no-data: 2F · unsupported: 0B 5C`. */
export function summarizeHealth(rows: readonly { pid: number; health: PidHealth }[]): string {
  const groups: Record<PidHealth, string[]> = { ok: [], slow: [], 'no-data': [], unsupported: [], waiting: [] };
  for (const r of rows) groups[r.health].push(hexPid(r.pid));
  return (Object.keys(groups) as PidHealth[])
    .filter((k) => groups[k].length)
    .map((k) => `${k}: ${groups[k].join(' ')}`)
    .join(' · ');
}
