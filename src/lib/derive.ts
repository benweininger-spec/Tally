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
 * Derived from first principles for US pump gas, which is E10 (do NOT use the
 * often-quoted "710.7" — that constant is for different units and yields absurd MPG
 * with MAF in g/s):
 *   fuel mass rate = MAF / AFR              (E10 stoichiometric AFR 14.08)
 *   gal/hr = MAF·3600 / (AFR · 6.20 lb/gal · 453.592 g/lb)
 *          = MAF·3600 / 39596.7 = MAF · 0.09091
 *   MPG    = mph / (gal/hr) = (1/0.09091)·mph/MAF = 11.00 · mph/MAF
 * Ethanol-free (E0: AFR 14.7, 6.17 lb/gal) works out to k = 11.428 — pass that as `k`
 * if the tank only ever sees E0. The pump calibration (`calib` in src/lib/logbook.ts)
 * is the logbook's own correction and is deliberately NOT folded in here.
 * Returns null at/near idle, where instantaneous MPG is undefined (∞) — callers
 * should show fuel burn (GPH) instead, or blank the number.
 */
export const MPG_MAF_CONSTANT = 11.0;
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
  return mafGps / k; // gal/hr = MAF·0.0909; inverse of the MPG constant (mph/GPH = MPG)
}

/**
 * Deceleration fuel cut-off (DFCO): with the pedal released above idle while rolling,
 * the 2TR-FE's ECU shuts the injectors off, but the MAF still reads the air pumped
 * through — integrating it would charge fuel that was never burned.
 *
 * `throttlePct` is measured from the CLOSED position. Toyota's PID 11 is absolute and
 * reads ~17 % with the pedal up on this truck (FACT, docs/DEVICE-MICRONTEK.md), so the
 * caller passes the learned closed position as `closedPct` (see learnClosedThrottle);
 * the default 0 suits a sensor that reads ~0 when closed.
 */
export const DFCO_THROTTLE_PCT = 1.5; // closed pedal, with sensor offset
export const DFCO_MIN_RPM = 1200; // ECU resumes injection near idle
export const DFCO_MIN_MPH = 8; // rolling, not a stall / creep
/** true when the ECU is (almost certainly) in deceleration fuel cut-off */
export function isFuelCut(throttlePct: number | null, rpm: number | null, speedMph: number, closedPct = 0): boolean {
  if (throttlePct == null || rpm == null || !Number.isFinite(throttlePct) || !Number.isFinite(rpm)) return false;
  if (!Number.isFinite(speedMph)) return false;
  return throttlePct - closedPct <= DFCO_THROTTLE_PCT && rpm >= DFCO_MIN_RPM && speedMph >= DFCO_MIN_MPH;
}

/** warm idle — fast idle on a cold engine opens the throttle further, so it never teaches */
export const CLOSED_LEARN_MAX_RPM = 1000;
/** a closed reading above this is a fault / a pedal resting on the floor mat, not "closed" */
export const CLOSED_MAX_PCT = 30;
/**
 * The throttle's closed position, learned as the lowest reading at a warm idle
 * (stopped, 400–1000 rpm). Only ever moves down, so a stray low reading can only make
 * isFuelCut stricter (fewer cuts = the old, pessimistic gallons) — never looser.
 * Returns `prev` unchanged when this reading can't teach anything.
 */
export function learnClosedThrottle(
  prev: number | null,
  throttlePct: number | null,
  rpm: number | null,
  speedMph: number
): number | null {
  if (throttlePct == null || rpm == null || !Number.isFinite(throttlePct) || !Number.isFinite(rpm)) return prev;
  if (!(speedMph < 1) || rpm < 400 || rpm > CLOSED_LEARN_MAX_RPM) return prev;
  if (throttlePct < 0 || throttlePct > CLOSED_MAX_PCT) return prev;
  return prev == null ? throttlePct : Math.min(prev, throttlePct);
}

/**
 * Miles for one integration step: the GPS delta while GPS is fixed, else OBD speed × dt
 * (tunnel, garage, a cold start before the first fix), else 0.
 *  • `gpsJustRestored` → 0: the first GPS delta after a gap spans the whole gap, which
 *    the OBD bridge already counted.
 *  • `speedMph` is the effective speed (GPS, else OBD) and gates the GPS path at 1 mph;
 *    the bridged path gates on the OBD speed itself, because a GPS speed held over
 *    from before the fix was lost must not decide whether a parked truck is moving.
 *  • `obdSpeedMph` must be a FRESH reading (< 3 s) or null.
 */
export function stepMiles(args: {
  gpsFix: boolean;
  gpsJustRestored: boolean;
  gpsDeltaMi: number;
  obdSpeedMph: number | null;
  speedMph: number;
  dtHours: number;
}): number {
  const { gpsFix, gpsJustRestored, gpsDeltaMi, obdSpeedMph, speedMph, dtHours } = args;
  if (gpsJustRestored) return 0;
  if (gpsFix) return speedMph >= 1 && Number.isFinite(gpsDeltaMi) ? Math.max(0, gpsDeltaMi) : 0;
  if (obdSpeedMph == null || !Number.isFinite(obdSpeedMph) || obdSpeedMph < 1) return 0;
  if (!Number.isFinite(dtHours) || dtHours <= 0) return 0;
  return obdSpeedMph * dtHours;
}

/**
 * Trip-average MPG by integration (NOT averaging instantaneous values).
 * Accumulate each poll with the elapsed hours since the last sample; prefer GPS
 * distance for `miles` when available, else speed·dt. `fuelCut` (DFCO, see isFuelCut)
 * counts the step's miles but no gallons.
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
  milesOverride?: number,
  fuelCut = false
): FuelAccum {
  if (!Number.isFinite(dtHours) || dtHours <= 0) return s;
  const gph = gallonsPerHour(mafGps);
  const miles = Number.isFinite(milesOverride as number)
    ? (milesOverride as number)
    : Math.max(0, speedMph) * dtHours;
  return { gallons: fuelCut ? s.gallons : s.gallons + gph * dtHours, miles: s.miles + miles };
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

// ---- altitude profile + grade ---------------------------------------------
/** Altitude history is sampled by DISTANCE, not time: one sample per ALT_SAMPLE_MI. */
export const ALT_SAMPLE_MI = 0.02;
/** Ring size: 250 × 0.02 mi ≈ the last 5 miles. */
export const ALT_SLOTS = 250;
const FT_PER_MI = 5280;

/**
 * Road grade (%) over the last `windowMi` of distance-spaced altitude samples (ft,
 * oldest → newest). Least-squares slope, not an endpoint difference: GPS altitude is
 * noisy (±10–30 ft), and a fit over the window steadies the number. Null until there
 * are enough samples to span the window.
 */
export function gradePct(altFt: number[], spacingMi = ALT_SAMPLE_MI, windowMi = 0.1): number | null {
  if (!(spacingMi > 0)) return null;
  const k = Math.max(1, Math.round(windowMi / spacingMi)); // intervals in the window
  if (altFt.length < k + 1) return null;
  const pts = altFt.slice(-(k + 1));
  const n = pts.length;
  const xm = (n - 1) / 2;
  let ym = 0;
  for (const y of pts) ym += y;
  ym /= n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xm) * (pts[i] - ym);
    den += (i - xm) * (i - xm);
  }
  if (!Number.isFinite(num) || den === 0) return null;
  const ftPerSample = num / den;
  return (ftPerSample / (spacingMi * FT_PER_MI)) * 100;
}
