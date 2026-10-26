/**
 * The truck's logbook: fuel fill-ups (→ fuel left + range, since the 2TR-FE doesn't
 * report tank level over standard OBD), service history (→ what's due), and an odometer
 * estimate tying them together. PURE — no imports, no I/O; persistence lives in
 * src/data/logbookStore.tsx. Checked by scripts/verify.ts.
 *
 * Fuel model: after a FULL fill the tank holds TANK_GAL; every MAF-measured gallon since
 * then is subtracted, scaled by `calib` — the pump's own verdict on our MAF math, learned
 * from consecutive full fills (pumped ÷ measured). A partial fill adds what was pumped.
 *
 * Odometer model: OBD can't read the odometer, so the driver enters it now and then (at a
 * fill-up or a service); between entries it advances by the miles we log (`milesLogged`).
 *
 * Functions MUTATE the logbook in place (it's fed 20×/s) and return it for chaining.
 */

export const TANK_GAL = 21.1; // every 3rd-gen Tacoma
export const MAX_FILLS = 300;
export const MAX_SERVICE = 500;
/** a calibration sample needs at least this much measured fuel to mean anything */
export const MIN_CALIB_GAL = 3;
export const CALIB_RANGE: readonly [number, number] = [0.6, 1.6];

export interface FillUp {
  id: string;
  at: number; // epoch ms
  /** gallons pumped as entered (null = not entered: assume we measured right) */
  gallons: number | null;
  full: boolean;
  pricePerGal: number | null;
  /** what the pump said you paid, when entered (else gallons × price) */
  total?: number | null;
  odometer: number | null;
  /** MAF gallons measured since the previous fill (snapshot at this fill) */
  measuredGal: number;
  /** miles logged since the previous fill */
  miles: number;
}

export interface ServiceType {
  id: string;
  label: string;
  everyMiles: number | null;
  everyMonths: number | null;
}

/**
 * Defaults from Toyota's 2016 Tacoma maintenance guide (0W-20 synthetic: 10k mi / 12 mo
 * oil; 5k tire rotation; 30k engine air filter; 15k cabin filter; …). Edit here.
 */
export const SERVICE_TYPES: readonly ServiceType[] = [
  { id: 'oil', label: 'Oil & filter', everyMiles: 10_000, everyMonths: 12 },
  { id: 'rotate', label: 'Tire rotation', everyMiles: 5_000, everyMonths: null },
  { id: 'airFilter', label: 'Engine air filter', everyMiles: 30_000, everyMonths: null },
  { id: 'cabinFilter', label: 'Cabin air filter', everyMiles: 15_000, everyMonths: 12 },
  { id: 'brakeFluid', label: 'Brake fluid', everyMiles: null, everyMonths: 36 },
  { id: 'wipers', label: 'Wiper blades', everyMiles: null, everyMonths: 12 },
  { id: 'coolant', label: 'Coolant', everyMiles: 100_000, everyMonths: 120 },
  { id: 'plugs', label: 'Spark plugs', everyMiles: 120_000, everyMonths: null },
  { id: 'other', label: 'Other', everyMiles: null, everyMonths: null },
];

export interface ServiceEntry {
  id: string;
  at: number; // epoch ms — can be in the past (back-logged history)
  odometer: number | null;
  types: string[]; // SERVICE_TYPES ids
  note: string;
  cost: number | null;
}

export interface OdoAnchor {
  odometer: number;
  at: number;
  /** `milesLogged` at the moment of the reading */
  milesLogged: number;
}

export interface Logbook {
  fills: FillUp[]; // oldest → newest
  service: ServiceEntry[]; // sorted by `at`
  /** MAF gallons + miles since the last fill */
  usedSinceFill: number;
  milesSinceFill: number;
  /** gallons in the tank right after the last fill (null = never filled here) */
  levelAtFill: number | null;
  /** pumped ÷ measured, learned from full-to-full fills (null = not learned yet) */
  calib: number | null;
  calibSamples: number[];
  /** every mile we've logged, ever (monotonic) */
  milesLogged: number;
  odo: OdoAnchor | null;
}

export const emptyLogbook = (): Logbook => ({
  fills: [],
  service: [],
  usedSinceFill: 0,
  milesSinceFill: 0,
  levelAtFill: null,
  calib: null,
  calibSamples: [],
  milesLogged: 0,
  odo: null,
});

const pos = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
let seq = 0;
export const newId = (at: number) => `${at.toString(36)}-${(seq++).toString(36)}`;

/** Feed driven miles + MAF gallons (from the same deltas the MPG log uses). */
export function onUsage(lb: Logbook, dMiles: number, dGal: number): Logbook {
  const mi = pos(dMiles);
  const gal = pos(dGal);
  lb.milesLogged += mi;
  lb.milesSinceFill += mi;
  lb.usedSinceFill += gal;
  return lb;
}

/** Gallons we think were burned since the last fill, corrected by the pump calibration. */
export const usedCorrected = (lb: Logbook) => lb.usedSinceFill * (lb.calib ?? 1);

export interface FuelLeft {
  gallons: number;
  pct: number; // 0..100
}

/** Estimated fuel in the tank, or null until the first fill-up is logged. */
export function fuelLeft(lb: Logbook): FuelLeft | null {
  if (lb.levelAtFill == null) return null;
  const g = Math.max(0, Math.min(TANK_GAL, lb.levelAtFill - usedCorrected(lb)));
  return { gallons: g, pct: (g / TANK_GAL) * 100 };
}

/** Range on what's left at `mpg` (null if either is unknown). */
export function rangeMiles(gallons: number | null, mpg: number | null): number | null {
  if (gallons == null || mpg == null || !(mpg > 0)) return null;
  return gallons * mpg;
}

export interface FillInput {
  at: number;
  gallons: number | null;
  full: boolean;
  pricePerGal: number | null;
  /** the pump's total $, if entered instead of (or as well as) the price */
  total?: number | null;
  odometer: number | null;
}

/**
 * Log a fill-up. A FULL fill entered with pumped gallons, right after a previous full
 * fill, is a calibration sample (pumped ÷ measured); `calib` = median of the last 3.
 * Then the tank level resets (full → TANK_GAL; partial → estimate + pumped).
 */
export function addFill(lb: Logbook, f: FillInput): Logbook {
  const prev = lb.fills[lb.fills.length - 1];
  const measured = lb.usedSinceFill;
  if (f.full && f.gallons != null && f.gallons > 0 && prev?.full && measured >= MIN_CALIB_GAL) {
    const sample = f.gallons / measured;
    if (sample >= CALIB_RANGE[0] && sample <= CALIB_RANGE[1]) {
      lb.calibSamples = [...lb.calibSamples, sample].slice(-3);
      lb.calib = median(lb.calibSamples);
    }
  }
  const before = fuelLeft(lb);
  const level = f.full
    ? TANK_GAL
    : Math.min(TANK_GAL, (before?.gallons ?? 0) + (f.gallons != null && f.gallons > 0 ? f.gallons : 0));
  lb.fills.push({
    id: newId(f.at),
    at: f.at,
    gallons: f.gallons != null && f.gallons > 0 ? f.gallons : null,
    full: f.full,
    pricePerGal: f.pricePerGal != null && f.pricePerGal > 0 ? f.pricePerGal : null,
    total: f.total != null && f.total > 0 ? f.total : null,
    odometer: f.odometer != null && f.odometer > 0 ? f.odometer : null,
    measuredGal: measured,
    miles: lb.milesSinceFill,
  });
  if (lb.fills.length > MAX_FILLS) lb.fills.splice(0, lb.fills.length - MAX_FILLS);
  lb.levelAtFill = level;
  lb.usedSinceFill = 0;
  lb.milesSinceFill = 0;
  if (f.odometer != null && f.odometer > 0) setOdometer(lb, f.odometer, f.at);
  return lb;
}

export function removeFill(lb: Logbook, id: string): Logbook {
  lb.fills = lb.fills.filter((x) => x.id !== id);
  return lb;
}

/** Last entered pump price (pre-fills the form). */
export const lastPrice = (lb: Logbook): number | null => {
  for (let i = lb.fills.length - 1; i >= 0; i--) if (lb.fills[i].pricePerGal != null) return lb.fills[i].pricePerGal;
  return null;
};

/** Pump-measured MPG between consecutive full fills (the honest number), newest first. */
export function pumpMpgs(lb: Logbook): { at: number; mpg: number }[] {
  const out: { at: number; mpg: number }[] = [];
  for (let i = lb.fills.length - 1; i > 0; i--) {
    const f = lb.fills[i];
    if (f.full && lb.fills[i - 1].full && f.gallons != null && f.gallons > 1 && f.miles > 10) {
      out.push({ at: f.at, mpg: f.miles / f.gallons });
    }
  }
  return out;
}

// ---- odometer -------------------------------------------------------------
/** Record a dashboard odometer reading taken at `at` (a newer reading wins). */
export function setOdometer(lb: Logbook, odometer: number, at: number): Logbook {
  if (!(odometer > 0)) return lb;
  if (lb.odo && lb.odo.at > at) return lb; // a back-logged service's odometer is history, not "now"
  lb.odo = { odometer, at, milesLogged: lb.milesLogged };
  return lb;
}

/** Odometer now: the last reading + miles logged since (null until one is entered). */
export function odometerNow(lb: Logbook): number | null {
  return lb.odo ? lb.odo.odometer + Math.max(0, lb.milesLogged - lb.odo.milesLogged) : null;
}

// ---- service ----------------------------------------------------------------
export interface ServiceInput {
  at: number;
  odometer: number | null;
  types: string[];
  note: string;
  cost: number | null;
}

export function addService(lb: Logbook, s: ServiceInput): Logbook {
  lb.service.push({
    id: newId(s.at),
    at: s.at,
    odometer: s.odometer != null && s.odometer > 0 ? s.odometer : null,
    types: s.types.filter((t, i, a) => a.indexOf(t) === i),
    note: s.note.trim(),
    cost: s.cost != null && s.cost > 0 ? s.cost : null,
  });
  lb.service.sort((a, b) => a.at - b.at);
  if (lb.service.length > MAX_SERVICE) lb.service.splice(0, lb.service.length - MAX_SERVICE);
  if (s.odometer != null && s.odometer > 0) setOdometer(lb, s.odometer, s.at);
  return lb;
}

export function removeService(lb: Logbook, id: string): Logbook {
  lb.service = lb.service.filter((x) => x.id !== id);
  return lb;
}

export type DueState = 'ok' | 'soon' | 'due' | 'never' | 'unknown';
export interface ServiceStatus {
  type: ServiceType;
  state: DueState;
  /** last time it was done */
  last: ServiceEntry | null;
  /** miles until due (negative = overdue), when computable */
  inMiles: number | null;
  /** days until due (negative = overdue), when computable */
  inDays: number | null;
}

/** "soon" = within this many miles / days */
export const SOON_MILES = 500;
export const SOON_DAYS = 30;
const DAY_MS = 86_400_000;

function addMonths(at: number, months: number): number {
  const d = new Date(at);
  d.setMonth(d.getMonth() + months);
  return d.getTime();
}

/** Due status for every interval-based service type, most urgent first. */
export function serviceStatus(lb: Logbook, now: number): ServiceStatus[] {
  const odo = odometerNow(lb);
  const rows: ServiceStatus[] = [];
  for (const type of SERVICE_TYPES) {
    if (type.everyMiles == null && type.everyMonths == null) continue;
    let last: ServiceEntry | null = null;
    for (const e of lb.service) if (e.types.includes(type.id) && (!last || e.at >= last.at)) last = e;
    if (!last) {
      rows.push({ type, state: 'never', last: null, inMiles: null, inDays: null });
      continue;
    }
    const inMiles = type.everyMiles != null && last.odometer != null && odo != null ? last.odometer + type.everyMiles - odo : null;
    const inDays = type.everyMonths != null ? Math.floor((addMonths(last.at, type.everyMonths) - now) / DAY_MS) : null;
    let state: DueState;
    if (inMiles == null && inDays == null) state = 'unknown';
    else if ((inMiles != null && inMiles <= 0) || (inDays != null && inDays <= 0)) state = 'due';
    else if ((inMiles != null && inMiles <= SOON_MILES) || (inDays != null && inDays <= SOON_DAYS)) state = 'soon';
    else state = 'ok';
    rows.push({ type, state, last, inMiles, inDays });
  }
  const rank: Record<DueState, number> = { due: 0, soon: 1, ok: 2, unknown: 3, never: 4 };
  const urgency = (r: ServiceStatus) => Math.min(r.inMiles != null ? r.inMiles / 30 : Infinity, r.inDays ?? Infinity);
  return rows.sort((a, b) => rank[a.state] - rank[b.state] || urgency(a) - urgency(b));
}

/** The one thing worth a HOME nudge (due or soon), or null. */
export function nextDue(lb: Logbook, now: number): ServiceStatus | null {
  const top = serviceStatus(lb, now)[0];
  return top && (top.state === 'due' || top.state === 'soon') ? top : null;
}

/** Plain-English "due" line: "in 320 mi", "in 12 days", "300 mi overdue". */
export function dueText(s: ServiceStatus): string {
  const parts: string[] = [];
  if (s.inMiles != null) parts.push(s.inMiles <= 0 ? `${Math.round(-s.inMiles).toLocaleString()} mi overdue` : `in ${Math.round(s.inMiles).toLocaleString()} mi`);
  if (s.inDays != null) parts.push(s.inDays <= 0 ? `${-s.inDays} days overdue` : `in ${s.inDays} days`);
  if (!parts.length) return s.state === 'never' ? 'not logged yet' : 'set the odometer';
  // the nearer of the two is what matters
  return parts.length === 2 && s.inMiles != null && s.inDays != null ? (s.inMiles / 30 < s.inDays ? parts[0] : parts[1]) : parts[0];
}

/** Defensive load of persisted JSON. */
export function normalizeLogbook(raw: unknown): Logbook {
  const lb = emptyLogbook();
  if (!raw || typeof raw !== 'object') return lb;
  const r = raw as Partial<Logbook>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  if (Array.isArray(r.fills)) {
    lb.fills = r.fills
      .filter((f): f is FillUp => !!f && typeof f === 'object' && typeof (f as FillUp).at === 'number')
      .map((f) => ({
        id: typeof f.id === 'string' ? f.id : newId(f.at),
        at: f.at,
        gallons: numOrNull(f.gallons),
        full: !!f.full,
        pricePerGal: numOrNull(f.pricePerGal),
        total: numOrNull(f.total),
        odometer: numOrNull(f.odometer),
        measuredGal: num(f.measuredGal, 0),
        miles: num(f.miles, 0),
      }))
      .slice(-MAX_FILLS);
  }
  if (Array.isArray(r.service)) {
    lb.service = r.service
      .filter((e): e is ServiceEntry => !!e && typeof e === 'object' && typeof (e as ServiceEntry).at === 'number')
      .map((e) => ({
        id: typeof e.id === 'string' ? e.id : newId(e.at),
        at: e.at,
        odometer: numOrNull(e.odometer),
        types: Array.isArray(e.types) ? e.types.filter((x): x is string => typeof x === 'string') : [],
        note: typeof e.note === 'string' ? e.note : '',
        cost: numOrNull(e.cost),
      }))
      .sort((a, b) => a.at - b.at)
      .slice(-MAX_SERVICE);
  }
  lb.usedSinceFill = num(r.usedSinceFill, 0);
  lb.milesSinceFill = num(r.milesSinceFill, 0);
  lb.levelAtFill = numOrNull(r.levelAtFill);
  lb.calibSamples = Array.isArray(r.calibSamples) ? r.calibSamples.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).slice(-3) : [];
  lb.calib = lb.calibSamples.length ? median(lb.calibSamples) : null;
  lb.milesLogged = num(r.milesLogged, 0);
  const o = r.odo as OdoAnchor | null | undefined;
  lb.odo = o && typeof o.odometer === 'number' && typeof o.at === 'number' ? { odometer: o.odometer, at: o.at, milesLogged: num(o.milesLogged, 0) } : null;
  return lb;
}

// ---- spending -----------------------------------------------------------------
/** What a fill cost, when both gallons and price were entered. */
export const fillCost = (f: FillUp): number | null =>
  f.total != null ? f.total : f.gallons != null && f.pricePerGal != null ? f.gallons * f.pricePerGal : null;

export interface Spending {
  /** pump spend this calendar month / the last 30 days ($) */
  month: number;
  last30: number;
  /** fills that had both gallons + price (the rest can't be costed) */
  costedFills: number;
  /** average $/gal over the last 3 priced fills */
  avgPrice: number | null;
  /** real mpg used for the per-mile figure (pump full→full first, else MAF ÷ calibration) */
  mpg: number | null;
  /** cost to drive one mile ($/mi) */
  perMile: number | null;
}

/**
 * Real spending from fill-ups. `mafMpg` (the MPG log's lifetime figure) is the fallback
 * efficiency until two full fills give a pump-honest one; it's divided by the pump
 * calibration because MAF mpg inherits the MAF fuel error.
 */
export function spending(lb: Logbook, now: number, mafMpg: number | null = null): Spending {
  const d = new Date(now);
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  let month = 0;
  let last30 = 0;
  let costed = 0;
  for (const f of lb.fills) {
    const c = fillCost(f);
    if (c == null) continue;
    costed++;
    if (f.at >= monthStart && f.at <= now) month += c;
    if (f.at > now - 30 * 86_400_000 && f.at <= now) last30 += c;
  }
  const prices = lb.fills.filter((f) => f.pricePerGal != null).slice(-3).map((f) => f.pricePerGal as number);
  const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
  const pm = pumpMpgs(lb).slice(0, 3);
  const mpg = pm.length ? pm.reduce((a, b) => a + b.mpg, 0) / pm.length : mafMpg != null && mafMpg > 0 ? mafMpg / (lb.calib ?? 1) : null;
  return { month, last30, costedFills: costed, avgPrice, mpg, perMile: avgPrice != null && mpg != null && mpg > 0 ? avgPrice / mpg : null };
}
