/**
 * Gear readout + "just parked" detection. PURE (verify-tested); fed by
 * src/data/gearStore.tsx from telemetry.
 *
 * GEAR (moving forward): the 2TR-FE has no gear PID, so it's read from engine speed ÷
 * road speed. Each gear of the 6-speed automatic gives rpm/mph = K × ratio, where K folds
 * in the axle (3.909) and the 245/75R16 tire (≈ 662 rev/mi): K ≈ 43.1. The nearest gear in
 * log space wins if it's within tolerance (torque-converter slip in low gears stays under
 * the ~18–40 % gaps between steps), held 0.5 s so a shift doesn't flicker. K re-learns from
 * clean matches, so a different tire size or axle self-corrects.
 *
 * PARK: the unit reports REVERSE (the camera trigger — `com.microntek.report.event`,
 * type "backview"). Shifting D → P passes through R; backing into a spot ends in R → P.
 * So: reverse released while stopped and NOT followed by rolling forward within
 * REVERSE_TO_PARK_MS ⇒ Park. Engine off while stopped ⇒ Park too. Without either clue a
 * long stop (STOP_PROMPT_MS) is still enough to offer the trip summary.
 */

/** Toyota AC60E 6-speed (3rd-gen Tacoma). */
export const GEAR_RATIOS: readonly number[] = [3.6, 2.09, 1.488, 1.0, 0.687, 0.58];
/** rpm per mph per unit gear ratio: 662 rev/mi ÷ 60 × 3.909 axle */
export const K_NOMINAL = 43.1;
export const K_RANGE: readonly [number, number] = [34, 54];
/** accept a match within this log-distance (~±12 %) */
export const MATCH_TOL = 0.115;
export const MIN_GEAR_MPH = 4;
export const GEAR_HOLD_MS = 500;
export const REVERSE_TO_PARK_MS = 4000;
export const STOP_PROMPT_MS = 60_000;

export function matchGear(rpm: number, mph: number, k = K_NOMINAL): { gear: number; err: number } | null {
  if (!(rpm > 400) || !(mph >= MIN_GEAR_MPH) || !(k > 0)) return null;
  const r = rpm / mph;
  let best = -1;
  let bestErr = Infinity;
  for (let i = 0; i < GEAR_RATIOS.length; i++) {
    const e = Math.abs(Math.log(r / (k * GEAR_RATIOS[i])));
    if (e < bestErr) {
      bestErr = e;
      best = i;
    }
  }
  return bestErr <= MATCH_TOL ? { gear: best + 1, err: bestErr } : null;
}

export type GearShown = 'P' | 'R' | 'D' | '1' | '2' | '3' | '4' | '5' | '6' | '—';

export interface GearState {
  k: number;
  /** what the badge shows */
  shown: GearShown;
  /** candidate forward gear being held before it's shown */
  cand: number | null;
  candSince: number;
  reverse: boolean;
  /** when reverse was last released (while stopped), else null */
  reverseOffAt: number | null;
  stoppedSince: number | null;
  /** Park detected for the current stop */
  parked: boolean;
  /** bumps when `parked` turns true — the trip-summary prompt keys off it */
  parkSeq: number;
}

export const createGearState = (): GearState => ({
  k: K_NOMINAL,
  shown: '—',
  cand: null,
  candSince: 0,
  reverse: false,
  reverseOffAt: null,
  stoppedSince: null,
  parked: false,
  parkSeq: 0,
});

export interface GearInput {
  now: number;
  /** road speed, mph (ECU speed preferred — same timing as rpm) */
  mph: number | null;
  /** engine rpm, null when OBD is down */
  rpm: number | null;
  /** head-unit reverse signal, null when unknown */
  reverse: boolean | null;
}

const STOP_MPH = 1;

/** Advance the tracker one tick (mutates + returns `st`). */
export function gearStep(st: GearState, i: GearInput): GearState {
  const mph = i.mph != null && Number.isFinite(i.mph) ? i.mph : null;
  const stopped = mph == null || mph < STOP_MPH;
  const engineOff = i.rpm != null && i.rpm < 300; // a running 2TR-FE idles ~700

  // ---- reverse + park --------------------------------------------------------
  const rev = i.reverse === true;
  if (st.reverse && !rev && stopped) st.reverseOffAt = i.now;
  if (rev) st.reverseOffAt = null;
  st.reverse = rev;

  if (stopped) {
    if (st.stoppedSince == null) st.stoppedSince = i.now;
  } else {
    st.stoppedSince = null;
    st.reverseOffAt = null; // rolled away (R → N → D after backing out)
    st.parked = false;
  }
  const parkNow =
    stopped && !rev && ((st.reverseOffAt != null && i.now - st.reverseOffAt >= REVERSE_TO_PARK_MS) || engineOff);
  if (parkNow && !st.parked) {
    st.parked = true;
    st.parkSeq++;
  }

  // ---- forward gear from rpm / speed ------------------------------------------
  if (rev) {
    st.shown = 'R';
    st.cand = null;
    return st;
  }
  if (st.parked) {
    st.shown = 'P';
    st.cand = null;
    return st;
  }
  if (stopped) {
    st.shown = i.rpm != null || i.reverse != null ? 'D' : '—';
    st.cand = null;
    return st;
  }
  const m = i.rpm != null ? matchGear(i.rpm, mph as number, st.k) : null;
  if (!m) {
    // shifting / converter slipping / no OBD: keep the last gear, or just "D" when moving
    if (st.shown === 'P' || st.shown === 'R' || st.shown === '—') st.shown = 'D';
    return st;
  }
  if (m.gear !== st.cand) {
    st.cand = m.gear;
    st.candSince = i.now;
  }
  if (i.now - st.candSince >= GEAR_HOLD_MS) {
    st.shown = String(m.gear) as GearShown;
    // learn K from clean, held matches (locked converter in the upper gears especially)
    if (m.err < 0.05 && mph! >= 15) {
      const kObs = i.rpm! / (mph! * GEAR_RATIOS[m.gear - 1]);
      st.k = Math.max(K_RANGE[0], Math.min(K_RANGE[1], st.k + (kObs - st.k) * 0.01));
    }
  }
  return st;
}

/** Offer the trip summary: parked, or simply stopped a long while (no reverse signal). */
export function summaryPromptDue(st: GearState, now: number): boolean {
  return st.parked || (st.stoppedSince != null && now - st.stoppedSince >= STOP_PROMPT_MS);
}
