/**
 * Derived vehicle metrics computed from OBD + GPS. PURE — no imports, no I/O.
 *
 * Fuel economy, a crude HP/torque estimate, and a GPS-armed 0–60 timer. These are
 * computed, not measured — the OBD-II port has no MPG/HP/torque PID on this truck —
 * so each is documented as an estimate. Self-contained so `scripts/verify.ts` can
 * exercise the formulas in Node. See docs/ARCHITECTURE.md.
 *
 * 2TR-FE reference: ~159 hp @ 5200 rpm, ~180 lb-ft @ 3800 rpm (naturally aspirated).
 */

// ---- fuel economy -----------------------------------------------------------
/**
 * Single-constant MPG form: MPG = k · speed(mph) / MAF(g/s).
 *
 * Derived from first principles for gasoline (do NOT use the often-quoted "710.7"
 * — that constant is for different units and yields absurd MPG with MAF in g/s):
 *   fuel mass rate = MAF / AFR              (AFR 14.7)
 *   gal/hr = MAF·3600 / (AFR · 6.17 lb/gal · 453.592 g/lb)
 *          = MAF·3600 / 41140.3 = MAF · 0.087506
 *   MPG    = mph / (gal/hr) = (1/0.087506)·mph/MAF = 11.428 · mph/MAF
 * Returns null at/near idle, where instantaneous MPG is undefined (∞) — callers
 * should show fuel burn (GPH) instead, or blank the number.
 */
export const MPG_MAF_CONSTANT = 11.428;
export function instantMpg(mafGps: number, speedMph: number, k = MPG_MAF_CONSTANT): number | null {
  if (!Number.isFinite(mafGps) || mafGps <= 0) return null;
  if (!Number.isFinite(speedMph) || speedMph < 1) return null; // undefined at idle
  return (k * speedMph) / mafGps;
}

/** Fuel burn in gallons/hour from MAF (g/s). Useful as the idle readout. */
export function gallonsPerHour(mafGps: number, k = MPG_MAF_CONSTANT): number {
  // GPH = speed / MPG = speed / (k·speed/MAF) = MAF / k  (mph cancels) — i.e. 1 mph drives k/MAF mpg.
  // Equivalent direct form: GPH = MAF(g/s)·3600 / (AFR·gasDensity_g_per_gal).
  if (!Number.isFinite(mafGps) || mafGps < 0) return 0;
  return mafGps / k; // gal/hr = MAF·0.0875; inverse of the MPG constant (mph/GPH = MPG)
}

/**
 * Trip-average MPG by integration (NOT averaging instantaneous values).
 * Accumulate each poll with the elapsed hours since the last sample; prefer GPS
 * distance for `miles` when available, else speed·dt.
 */
export interface FuelAccum {
  gallons: number;
  miles: number;
}
export const initFuelAccum = (): FuelAccum => ({ gallons: 0, miles: 0 });
export function accumFuel(
  s: FuelAccum,
  mafGps: number,
  speedMph: number,
  dtHours: number,
  milesOverride?: number
): FuelAccum {
  if (!Number.isFinite(dtHours) || dtHours <= 0) return s;
  const gph = gallonsPerHour(mafGps);
  const miles = Number.isFinite(milesOverride as number)
    ? (milesOverride as number)
    : Math.max(0, speedMph) * dtHours;
  return { gallons: s.gallons + gph * dtHours, miles: s.miles + miles };
}
export function avgMpg(s: FuelAccum): number | null {
  if (s.gallons <= 0) return null;
  return s.miles / s.gallons;
}

// ---- power estimates (crude, label as estimates) ---------------------------
/**
 * Estimated crank HP from RPM + calculated engine load. Load-scaled toward peak
 * power near the peak-power RPM. Only roughly meaningful near WOT — ±20%+.
 */
export function estHp(rpm: number, loadPct: number, maxHp = 159, peakRpm = 5200): number {
  if (!Number.isFinite(rpm) || !Number.isFinite(loadPct)) return 0;
  const load = Math.max(0, Math.min(100, loadPct)) / 100;
  const rpmFrac = Math.max(0, Math.min(1.1, rpm / peakRpm));
  return maxHp * load * rpmFrac;
}

/** Torque (lb-ft) from the HP estimate: T = HP·5252 / RPM. */
export function estTorqueLbFt(hp: number, rpm: number): number {
  if (!Number.isFinite(hp) || !Number.isFinite(rpm) || rpm <= 0) return 0;
  return (hp * 5252) / rpm;
}

// ---- 0–60 mph timer (GPS-armed) --------------------------------------------
/**
 * Pure state machine. Arms when the truck stops, starts the clock on first motion,
 * linearly interpolates the 60 mph crossing between bracketing samples, and aborts
 * if speed falls back before reaching 60. Drive it off GPS speed (smooth, no OBD
 * latency). `tSec` should be the GPS fix timestamp in seconds, not wall clock.
 */
export type ZeroSixtyPhase = 'idle' | 'armed' | 'running' | 'done';
export interface ZeroSixtyState {
  phase: ZeroSixtyPhase;
  t0: number | null;
  /** last completed 0–60 time in seconds, persists until the next run */
  result: number | null;
  prevSpeed: number;
  prevT: number;
  seeded: boolean;
}
export const initZeroSixty = (): ZeroSixtyState => ({
  phase: 'idle',
  t0: null,
  result: null,
  prevSpeed: 0,
  prevT: 0,
  seeded: false,
});

const ARM_BELOW = 1.0; // mph — considered stopped
const START_ABOVE = 1.0; // mph — first motion
const ABORT_BELOW = 5.0; // mph — gave up the run
const TARGET = 60.0;

export function zeroSixtyStep(s: ZeroSixtyState, speedMph: number, tSec: number): ZeroSixtyState {
  if (!Number.isFinite(speedMph) || !Number.isFinite(tSec)) return s;
  if (!s.seeded) {
    const phase: ZeroSixtyPhase = speedMph <= ARM_BELOW ? 'armed' : 'idle';
    return { ...s, seeded: true, phase, prevSpeed: speedMph, prevT: tSec };
  }

  let { phase, t0, result } = s;

  switch (phase) {
    case 'idle':
      if (speedMph <= ARM_BELOW) phase = 'armed';
      break;
    case 'armed':
      if (speedMph > START_ABOVE) {
        phase = 'running';
        t0 = tSec; // first-motion start (rollout-inclusive convention)
      }
      break;
    case 'running':
      if (s.prevSpeed < TARGET && speedMph >= TARGET && t0 != null) {
        const span = speedMph - s.prevSpeed;
        const frac = span > 0 ? (TARGET - s.prevSpeed) / span : 0;
        const t60 = s.prevT + frac * (tSec - s.prevT);
        result = t60 - t0;
        phase = 'done';
      } else if (speedMph < ABORT_BELOW) {
        phase = 'armed'; // gave up; keep the previous result
        t0 = null;
      }
      break;
    case 'done':
      if (speedMph <= ARM_BELOW) phase = 'armed'; // re-arm for the next run
      break;
  }

  return { phase, t0, result, prevSpeed: speedMph, prevT: tSec, seeded: true };
}
