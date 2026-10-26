/**
 * Glance rules for engine temperature and fuel economy — shared by the HOME glance
 * cards and the ENGINE face so both read the same thresholds. Pure (verify-tested).
 */

/** OBD-II defines a "warm-up cycle" as coolant reaching ≥ 160 °F (71 °C): warm from here. */
export const COOLANT_WARM_F = 160;
/** at/above: running hot (the 2TR-FE normally sits ~190–205 °F) */
export const COOLANT_HOT_F = 230;
/** where the warm-up bar starts (a cold-soaked engine on a mild day) */
export const WARMUP_FROM_F = 100;

export type CoolantState = 'cold' | 'warm' | 'hot';

export function coolantState(f: number): CoolantState {
  return f >= COOLANT_HOT_F ? 'hot' : f >= COOLANT_WARM_F ? 'warm' : 'cold';
}

/**
 * Warm-up in 4 visible steps — 0 cold (blue) · 1 · 2 · 3 warm (amber) — so the coolant
 * readout drifts from blue to amber as the engine warms instead of flipping at 160 °F.
 * Steps at 120 / 140 / 160 °F (the measured idle warm-up crosses them ~4 min apart).
 */
export function warmupStage(f: number): 0 | 1 | 2 | 3 {
  if (!Number.isFinite(f) || f < 120) return 0;
  if (f < 140) return 1;
  if (f < COOLANT_WARM_F) return 2;
  return 3;
}

/** 0..1 progress from WARMUP_FROM_F to COOLANT_WARM_F (1 once warm). */
export function warmupFrac(f: number): number {
  if (!Number.isFinite(f)) return 0;
  return Math.max(0, Math.min(1, (f - WARMUP_FROM_F) / (COOLANT_WARM_F - WARMUP_FROM_F)));
}

/** EPA combined for a 2016 Tacoma 2.7 L 4x2 automatic (19 city / 23 hwy / 21 combined). */
export const ECO_MPG = 21;
/** the economy bar's full scale; coasting readings above it pin to the end */
export const MPG_BAR_MAX = 40;

/** at/below this the economy colour is fully "poor" (warn) */
export const POOR_MPG = 12;

/**
 * How "eco" a reading is, 0 (poor) … 1 (in the ECO zone), in quarter steps so the
 * colour changes in visible stages (and components re-render rarely):
 * ≥ ECO_MPG → 1, ≤ POOR_MPG → 0, linear between.
 */
export function ecoLevel(mpg: number | null): number | null {
  if (mpg == null || !Number.isFinite(mpg)) return null;
  const f = (mpg - POOR_MPG) / (ECO_MPG - POOR_MPG);
  // floor, not round: only a reading AT the eco line gets full green (20 mpg must not)
  return Math.floor(Math.max(0, Math.min(1, f)) * 4) / 4;
}

/** true while the (smoothed) instant reading beats the eco line */
export function inEcoZone(mpg: number | null, threshold = ECO_MPG): boolean {
  return mpg != null && Number.isFinite(mpg) && mpg >= threshold;
}

/** 0..1 position of an mpg reading on the economy bar */
export function mpgBarFrac(mpg: number): number {
  if (!Number.isFinite(mpg)) return 0;
  return Math.max(0, Math.min(1, mpg / MPG_BAR_MAX));
}

/**
 * One exponential-smoothing step (time-constant `tauMs`), robust to irregular ticks.
 * Instant MPG swings from ~5 (pulling away) to 99 (coasting) between MAF samples; a
 * ~2 s average is what the eye can actually read.
 */
export function emaStep(prev: number | null, next: number, dtMs: number, tauMs: number): number {
  if (prev == null || !Number.isFinite(prev)) return next;
  if (!(dtMs > 0)) return prev;
  const a = 1 - Math.exp(-dtMs / tauMs);
  return prev + (next - prev) * a;
}
