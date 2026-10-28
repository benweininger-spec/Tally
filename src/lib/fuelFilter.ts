/**
 * Steady fuel level from the gauge cluster's raw sender. PURE (verify-tested).
 *
 * The tank sender is a float: on a grade or under braking the fuel sloshes and the raw
 * reading swings several gallons (seen on the truck 2026-10-26). So:
 *  • keep the last FUEL_WINDOW_MS of readings,
 *  • trust only those taken near LEVEL and not accelerating, braking or cornering hard
 *    (IMU pitch / roll / longitudinal + lateral g — a sustained corner sloshes the float
 *    like a grade),
 *  • report the interquartile mean (average of the middle half) — the peaks never count,
 *  • a big jump UP while stopped is a fill-up: restart the window so the gauge follows at once.
 * With too few level readings yet (just started, all hills) it falls back to all readings.
 */

export const FUEL_WINDOW_MS = 5 * 60_000;
export const LEVEL_TILT_DEG = 4;
export const LEVEL_ACCEL_G = 0.08;
/** a rise this big (litres) while stopped = refuelled */
export const REFUEL_JUMP_L = 8;
export const MIN_LEVEL_SAMPLES = 3;

export interface FuelSample {
  at: number;
  litres: number;
  /** taken near level + steady (pitch, roll, longitudinal + lateral g all small) */
  level: boolean;
  stopped: boolean;
}

export interface FuelFilter {
  samples: FuelSample[];
}

export const createFuelFilter = (): FuelFilter => ({ samples: [] });

/** Was the truck level + steady enough for the float to be honest? */
export function isLevel(pitchDeg: number | null, rollDeg: number | null, longG: number | null, latG: number | null = null): boolean {
  if (pitchDeg == null || rollDeg == null) return true; // no IMU: can't tell — trust it
  return (
    Math.abs(pitchDeg) <= LEVEL_TILT_DEG &&
    Math.abs(rollDeg) <= LEVEL_TILT_DEG &&
    Math.abs(longG ?? 0) <= LEVEL_ACCEL_G &&
    Math.abs(latG ?? 0) <= LEVEL_ACCEL_G
  );
}

/** Interquartile mean: drop the lowest + highest quarter, average the rest. */
export function iqm(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  if (v.length < 4) return v[Math.floor(v.length / 2)]; // tiny sets: the median
  const lo = Math.floor(v.length / 4);
  const hi = v.length - lo;
  let sum = 0;
  for (let i = lo; i < hi; i++) sum += v[i];
  return sum / (hi - lo);
}

export function filteredLitres(f: FuelFilter, now: number): number | null {
  const recent = f.samples.filter((s) => now - s.at <= FUEL_WINDOW_MS);
  if (!recent.length) return null;
  const level = recent.filter((s) => s.level);
  return iqm((level.length >= MIN_LEVEL_SAMPLES ? level : recent).map((s) => s.litres));
}

/** Add one raw reading (mutates + returns `f`). */
export function addFuelSample(f: FuelFilter, s: FuelSample): FuelFilter {
  if (!Number.isFinite(s.litres) || s.litres < 0) return f;
  const cur = filteredLitres(f, s.at);
  // filled up: a clear jump while parked → forget the old tank
  if (cur != null && s.stopped && s.litres - cur >= REFUEL_JUMP_L) f.samples = [];
  f.samples.push(s);
  const cut = s.at - FUEL_WINDOW_MS;
  while (f.samples.length && f.samples[0].at < cut) f.samples.shift();
  return f;
}
