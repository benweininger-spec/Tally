/**
 * Vehicle-frame inertial math for the live data layer.
 *
 * The head unit is mounted at an UNKNOWN fixed angle, so raw accelerometer axes
 * are not the truck's axes. This module turns raw device-frame accelerometer
 * samples (in g, gravity included — what `expo-sensors` Accelerometer reports)
 * into the longitudinal / lateral g the dashboard expects, plus pitch/roll.
 *
 * Two-step calibration (run once, parked):
 *   A. Level capture → mean accel = device "up" (gravity reaction), pins pitch/roll.
 *   B. Forward capture (a gentle straight pull, or GPS course) → resolves the yaw
 *      ambiguity gravity alone can't, pinning vehicle "forward".
 * The result is a device→vehicle rotation `R` (rows = forward / right / up).
 *
 * SELF-CONTAINED ON PURPOSE: no imports. Pure functions only, so the wiring layer
 * (`src/data/live/sensorProvider.ts`) stays thin and `scripts/verify.ts` can run
 * this under `node --experimental-strip-types`. See docs/ARCHITECTURE.md.
 *
 * Sign conventions (outputs, in g):
 *   longitudinal: + = accelerating, − = braking
 *   lateral:      + = cornering right, − = cornering left
 *   pitch:        + = nose up   (climbing)
 *   roll:         + = right side down
 */

export type Vec3 = readonly [number, number, number];
/** 3x3 matrix as 3 row vectors. */
export type Mat3 = readonly [Vec3, Vec3, Vec3];

// ---- vector helpers ---------------------------------------------------------
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const unit = (a: Vec3): Vec3 => {
  const n = norm(a) || 1;
  return scale(a, 1 / n);
};
const matVec = (R: Mat3, v: Vec3): Vec3 => [dot(R[0], v), dot(R[1], v), dot(R[2], v)];

// ---- one-pole low-pass ------------------------------------------------------
/** Smoothing factor for a one-pole LPF at cutoff `fc` (Hz), sample step `dt` (s).
 *  Frame-rate independent: derive α from dt rather than hard-coding it. */
export const lpAlpha = (fc: number, dt: number): number => Math.exp(-2 * Math.PI * fc * dt);
export const lpVec = (prev: Vec3, x: Vec3, a: number): Vec3 => [
  a * prev[0] + (1 - a) * x[0],
  a * prev[1] + (1 - a) * x[1],
  a * prev[2] + (1 - a) * x[2],
];

// ---- calibration ------------------------------------------------------------
export interface Calibration {
  /** device→vehicle rotation; rows map a device vector to [long, lat, vert]. */
  R: Mat3;
  /** the gravity vector captured at calibration (device frame, g). */
  gravityDev: Vec3;
}

/** Step A: mean of parked accelerometer samples = device-up (gravity reaction), in g. */
export function estimateGravity(samples: readonly Vec3[]): Vec3 {
  if (samples.length === 0) return [0, 0, 1];
  const s = samples.reduce<Vec3>(
    (acc, v) => [acc[0] + v[0], acc[1] + v[1], acc[2] + v[2]],
    [0, 0, 0]
  );
  return scale(s, 1 / samples.length);
}

/**
 * Build the device→vehicle rotation.
 *   gravityDev  — mean parked accel (points along device-up).
 *   fwdHintDev  — a device-frame vector pointing along vehicle-forward: the mean of
 *                 gravity-subtracted accel during a straight forward pull, or a
 *                 GPS-course-derived vector. Resolves the yaw ambiguity.
 * If the hint is degenerate (≈parallel to up, e.g. no usable pull captured), falls
 * back to a stable forward in the ground plane so the matrix stays orthonormal.
 */
export function buildCalibration(gravityDev: Vec3, fwdHintDev: Vec3): Calibration {
  const up = unit(gravityDev); // vehicle up, in device frame
  let fwdRaw = sub(fwdHintDev, scale(up, dot(fwdHintDev, up))); // project hint onto ground plane
  if (norm(fwdRaw) < 1e-4) {
    // hint unusable — pick any axis not parallel to up, project it
    const seed: Vec3 = Math.abs(up[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    fwdRaw = sub(seed, scale(up, dot(seed, up)));
  }
  const fwd = unit(fwdRaw);
  const right = unit(cross(up, fwd)); // up × fwd = right (right-handed)
  const fwdOrtho = cross(right, up); // re-orthonormalize forward
  return { R: [fwdOrtho, right, up], gravityDev };
}

/** Identity-ish calibration (device already aligned to vehicle), for tests / first run. */
export const identityCalibration = (): Calibration => ({
  R: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  gravityDev: [0, 0, 1],
});

// ---- per-sample processing --------------------------------------------------
export interface ImuState {
  /** slow-tracked gravity estimate (device frame, g) */
  gLp: Vec3;
  /** display-smoothed vehicle-frame accel (g) */
  outLp: Vec3;
}
export const initImuState = (g: Vec3): ImuState => ({ gLp: g, outLp: [0, 0, 0] });

export interface FrameOut {
  longitudinal: number;
  lateral: number;
  vertical: number;
  /** radians */
  pitch: number;
  /** radians */
  roll: number;
}

/**
 * Per-sample pipeline: track gravity, subtract it, rotate into the vehicle frame,
 * smooth for display. `accelG` is a raw accelerometer sample in g (gravity included),
 * `dt` is seconds since the previous sample.
 *   gravityFc — cutoff for the gravity tracker (low, so braking ≠ gravity).
 *   outputFc  — cutoff for the display smoother (higher, low lag).
 */
export function processSample(
  st: ImuState,
  cal: Calibration,
  accelG: Vec3,
  dt: number,
  gravityFc = 0.3,
  outputFc = 1.6
): { state: ImuState; out: FrameOut } {
  const gA = lpAlpha(gravityFc, dt);
  const gLp = lpVec(st.gLp, accelG, gA); // slow-tracked gravity
  const lin = sub(accelG, gLp); // linear accel (g)
  const veh = matVec(cal.R, lin); // [long, lat, vert] in g
  const oA = lpAlpha(outputFc, dt);
  const outLp = lpVec(st.outLp, veh, oA);

  const gVeh = matVec(cal.R, gLp); // gravity in vehicle frame → tilt
  const pitch = Math.atan2(-gVeh[0], gVeh[2]); // nose up positive
  const roll = Math.atan2(gVeh[1], gVeh[2]); // right side down positive

  return {
    state: { gLp, outLp },
    out: { longitudinal: outLp[0], lateral: outLp[1], vertical: outLp[2], pitch, roll },
  };
}

/** radians → degrees, for the pitch/roll signals the UI renders. */
export const toDeg = (rad: number): number => (rad * 180) / Math.PI;
