/**
 * Long-term fuel economy log: per-day buckets + per-trip records. PURE — no imports,
 * no I/O (persistence lives in src/data/mpgLogStore.ts). Checked by scripts/verify.ts.
 *
 * Gallons are MAF-derived, so they only exist while OBD is connected. Miles driven
 * without OBD are still logged (`miles`) but never scored: every MPG figure here is
 * `fuelMiles / gallons`, where `fuelMiles` counts only the miles driven while gallons
 * were being measured. MPG is null whenever there's too little to score — it never
 * divides by zero.
 *
 * The functions MUTATE the log in place (the recorder feeds it 20×/s; copying a
 * 400-day array per tick would be waste) and return it for chaining.
 */

export interface DayBucket {
  /** local calendar date, 'YYYY-MM-DD' */
  date: string;
  /** all miles driven that day */
  miles: number;
  /** miles driven while OBD was measuring fuel (the scored part) */
  fuelMiles: number;
  gallons: number;
}

export interface Trip {
  startedAt: number; // epoch ms
  endedAt: number | null; // null while in progress
  miles: number;
  fuelMiles: number;
  gallons: number;
  /** trip-summary stats (absent on trips logged before 2026-10-26) */
  movingSec?: number;
  idleSec?: number;
  /** seconds spent moving with the smoothed instant mpg in the ECO zone */
  ecoSec?: number;
  /** seconds moving with an mpg reading at all (the eco % denominator) */
  scoredSec?: number;
  maxMph?: number;
}

export interface MpgLog {
  /** ascending by date */
  days: DayBucket[];
  /** completed trips, oldest → newest */
  trips: Trip[];
  /** the trip in progress, if any */
  current: Trip | null;
}

export const MAX_DAYS = 400;
export const MAX_TRIPS = 200;
/** a day / trip needs at least this many scored miles to report an MPG */
export const MIN_SCORED_MILES = 0.5;
/** trips shorter than this are discarded when they end (a driveway shuffle) */
export const MIN_TRIP_MILES = 0.1;

export const emptyLog = (): MpgLog => ({ days: [], trips: [], current: null });

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Local 'YYYY-MM-DD' for an epoch-ms time. */
export function dateKey(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** miles / gallons, or null when there's too little to score (never ÷0). */
export function mpgOf(fuelMiles: number, gallons: number, minMiles = MIN_SCORED_MILES): number | null {
  if (!(gallons > 1e-6) || !(fuelMiles >= minMiles)) return null;
  const v = fuelMiles / gallons;
  return Number.isFinite(v) ? v : null;
}

const clean = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);

/**
 * Add a delta to `date`'s bucket (created if new). `measuring` = fuel was being
 * measured while these miles were driven (OBD connected), so they also count as scored
 * `fuelMiles`. It defaults to "gallons arrived with them", but the recorder passes it
 * explicitly: distance arrives in 0.1-mi steps and gallons per MAF read, so a step can
 * land on a tick with no new gallons and must still be scored.
 */
export function addDelta(log: MpgLog, date: string, dMiles: number, dGal: number, measuring = dGal > 0): MpgLog {
  const mi = clean(dMiles);
  const gal = clean(dGal);
  if (mi === 0 && gal === 0) return log;
  let b = log.days[log.days.length - 1];
  if (!b || b.date !== date) {
    b = log.days.find((d) => d.date === date) as DayBucket;
    if (!b) {
      b = { date, miles: 0, fuelMiles: 0, gallons: 0 };
      log.days.push(b);
      log.days.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
      if (log.days.length > MAX_DAYS) log.days.splice(0, log.days.length - MAX_DAYS);
    }
  }
  b.miles += mi;
  b.gallons += gal;
  if (measuring) b.fuelMiles += mi;
  return log;
}

/** Start a trip at `t` (ending any trip still open). */
export function tripStart(log: MpgLog, t: number): MpgLog {
  if (log.current) tripEnd(log, t);
  log.current = { startedAt: t, endedAt: null, miles: 0, fuelMiles: 0, gallons: 0, movingSec: 0, idleSec: 0, ecoSec: 0, scoredSec: 0, maxMph: 0 };
  return log;
}

/** Add a delta to the trip in progress (no-op without one). */
export function tripUpdate(log: MpgLog, dMiles: number, dGal: number, measuring = dGal > 0): MpgLog {
  const c = log.current;
  if (!c) return log;
  const mi = clean(dMiles);
  const gal = clean(dGal);
  c.miles += mi;
  c.gallons += gal;
  if (measuring) c.fuelMiles += mi;
  return log;
}

/**
 * Time-based trip stats for the summary card: moving vs idling, time in the ECO zone
 * (`eco` null = no mpg reading → not scored), top speed. `dtSec` is real elapsed time.
 */
export function tripTick(log: MpgLog, dtSec: number, speedMph: number, eco: boolean | null): MpgLog {
  const c = log.current;
  if (!c || !(dtSec > 0) || dtSec > 5) return log; // a frozen / slept gap isn't driving time
  const moving = speedMph >= 1;
  if (moving) {
    c.movingSec = (c.movingSec ?? 0) + dtSec;
    if (eco != null) {
      c.scoredSec = (c.scoredSec ?? 0) + dtSec;
      if (eco) c.ecoSec = (c.ecoSec ?? 0) + dtSec;
    }
  } else c.idleSec = (c.idleSec ?? 0) + dtSec;
  if (Number.isFinite(speedMph) && speedMph > (c.maxMph ?? 0)) c.maxMph = speedMph;
  return log;
}

/** Share of scored moving time spent in the ECO zone (0..1), or null if too little data. */
export function ecoShare(t: Trip): number | null {
  const s = t.scoredSec ?? 0;
  return s >= 30 ? Math.min(1, (t.ecoSec ?? 0) / s) : null;
}

/** Close the trip in progress at `t`; trips under MIN_TRIP_MILES are dropped. */
export function tripEnd(log: MpgLog, t: number): MpgLog {
  const c = log.current;
  log.current = null;
  if (!c || c.miles < MIN_TRIP_MILES) return log;
  log.trips.push({ ...c, endedAt: t });
  if (log.trips.length > MAX_TRIPS) log.trips.splice(0, log.trips.length - MAX_TRIPS);
  return log;
}

/** Lifetime MPG over every scored mile in the log (null until there's enough). */
export function lifetimeMpg(log: MpgLog): number | null {
  let mi = 0;
  let gal = 0;
  for (const d of log.days) {
    mi += d.fuelMiles;
    gal += d.gallons;
  }
  return mpgOf(mi, gal);
}

export const tripMpg = (t: Trip): number | null => mpgOf(t.fuelMiles, t.gallons, MIN_TRIP_MILES);

/** The last 30 calendar days ending `today` (oldest → newest); null = not enough scored miles. */
export function last30(log: MpgLog, todayMs: number): { date: string; mpg: number | null }[] {
  const t = new Date(todayMs);
  const out: { date: string; mpg: number | null }[] = [];
  for (let i = 29; i >= 0; i--) {
    const key = dateKey(new Date(t.getFullYear(), t.getMonth(), t.getDate() - i).getTime());
    const b = log.days.find((d) => d.date === key);
    out.push({ date: key, mpg: b ? mpgOf(b.fuelMiles, b.gallons) : null });
  }
  return out;
}

/** Best and worst scored day in the log. */
export function bestWorstDay(log: MpgLog): {
  best: { date: string; mpg: number } | null;
  worst: { date: string; mpg: number } | null;
} {
  let best: { date: string; mpg: number } | null = null;
  let worst: { date: string; mpg: number } | null = null;
  for (const d of log.days) {
    const m = mpgOf(d.fuelMiles, d.gallons);
    if (m == null) continue;
    if (!best || m > best.mpg) best = { date: d.date, mpg: m };
    if (!worst || m < worst.mpg) worst = { date: d.date, mpg: m };
  }
  return { best, worst };
}

/** Index ranges [from, to] of consecutive non-null values — a ridgeline gaps the rest. */
export function runs(values: (number | null)[]): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  values.forEach((v, i) => {
    if (v != null && start < 0) start = i;
    if (v == null && start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  });
  if (start >= 0) out.push([start, values.length - 1]);
  return out;
}

/** Coerce a persisted blob into a valid log (drops anything malformed). */
export function normalizeLog(raw: unknown): MpgLog {
  const log = emptyLog();
  if (!raw || typeof raw !== 'object') return log;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  if (Array.isArray(r.days)) {
    for (const d of r.days as Record<string, unknown>[]) {
      if (d && typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
        log.days.push({ date: d.date, miles: num(d.miles), fuelMiles: num(d.fuelMiles), gallons: num(d.gallons) });
      }
    }
    log.days.sort((x, y) => (x.date < y.date ? -1 : 1));
    if (log.days.length > MAX_DAYS) log.days.splice(0, log.days.length - MAX_DAYS);
  }
  const trip = (t: Record<string, unknown> | null | undefined): Trip | null =>
    t && typeof t.startedAt === 'number'
      ? {
          startedAt: t.startedAt,
          endedAt: typeof t.endedAt === 'number' ? t.endedAt : null,
          miles: num(t.miles),
          fuelMiles: num(t.fuelMiles),
          gallons: num(t.gallons),
          ...(typeof t.movingSec === 'number'
            ? { movingSec: num(t.movingSec), idleSec: num(t.idleSec), ecoSec: num(t.ecoSec), scoredSec: num(t.scoredSec), maxMph: num(t.maxMph) }
            : null),
        }
      : null;
  if (Array.isArray(r.trips)) {
    for (const t of r.trips as Record<string, unknown>[]) {
      const x = trip(t);
      if (x) log.trips.push(x);
    }
    if (log.trips.length > MAX_TRIPS) log.trips.splice(0, log.trips.length - MAX_TRIPS);
  }
  log.current = trip(r.current as Record<string, unknown> | null);
  return log;
}

/**
 * Deterministic synthetic history for the SIM preview only (never persisted): 30 days
 * ending `todayMs` with a few no-drive days, plus five recent trips.
 */
export function syntheticLog(todayMs: number, seed = 7): MpgLog {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const log = emptyLog();
  const t = new Date(todayMs);
  for (let i = 29; i >= 0; i--) {
    const day = new Date(t.getFullYear(), t.getMonth(), t.getDate() - i).getTime();
    if (rnd() < 0.15) continue; // parked all day
    const miles = 8 + rnd() * 60;
    const mpg = 17.5 + rnd() * 5.5 + (i % 7 === 0 ? 2 : 0); // highway weekends
    addDelta(log, dateKey(day), miles, miles / mpg);
  }
  for (let k = 5; k >= 1; k--) {
    const start = todayMs - k * 86_400_000 * 1.3;
    const miles = 4 + rnd() * 40;
    const gal = miles / (17 + rnd() * 6);
    log.trips.push({ startedAt: start, endedAt: start + miles * 90_000, miles, fuelMiles: miles, gallons: gal });
  }
  return log;
}
