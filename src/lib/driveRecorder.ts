/**
 * Always-on drive recorder: the histories the Signal Library instruments draw from,
 * accumulated every telemetry tick whether or not their face is on screen (so the
 * grip envelope and the speed record are complete when you swipe to them).
 *
 *   • g trail       — [lat, long, t] for the phosphor beam (last TRAIL_LIFE_S)
 *   • grip envelope — 36 angular bins of session-peak |g|, slowly fading
 *   • speed record  — 90 s of speed (+ RPM, NaN when absent) at 20 Hz, ring buffer
 *
 * PURE — no runtime imports (constants mirror gscope.ts / speedRecord.ts, which
 * scripts/verify.ts cross-checks). The singleton + its feed live in src/data.
 */

const ENV_BINS = 36; // = gscope.ENV_BINS
const ENV_DECAY_PER_S = 0.015; // = gscope.ENV_DECAY_PER_S
const RECORD_DT = 0.05; // = speedRecord.RECORD_DT
const RECORD_SLOTS = 1800; // = speedRecord.RECORD_SLOTS
export const TRAIL_LIFE_S = 3.6; // gscope.trailLife(0.6)

export interface RecorderTick {
  lat: number | null;
  long: number | null;
  speedMph: number | null;
  rpm: number | null;
}

export interface DriveRecorder {
  trail: [number, number, number][];
  env: number[];
  lat: number;
  long: number;
  gLive: boolean;
  /** ring buffers, newest at (head − 1) */
  speedRing: Float32Array;
  rpmRing: Float32Array;
  head: number;
  count: number;
  lastT: number | null;
  lastSampleT: number;
  /** bumps on every change — renderers skip work when it hasn't moved */
  version: number;
}

export function createDriveRecorder(): DriveRecorder {
  return {
    trail: [],
    env: new Array(ENV_BINS).fill(0),
    lat: 0,
    long: 0,
    gLive: false,
    speedRing: new Float32Array(RECORD_SLOTS),
    rpmRing: new Float32Array(RECORD_SLOTS).fill(NaN),
    head: 0,
    count: 0,
    lastT: null,
    lastSampleT: -Infinity,
    version: 0,
  };
}

/** Feed one telemetry tick at time `t` (seconds, monotonic). */
export function recordTick(r: DriveRecorder, s: RecorderTick, t: number): void {
  const dt = r.lastT == null ? 0 : Math.max(0, Math.min(0.5, t - r.lastT));
  r.lastT = t;

  const gLive = s.lat != null && s.long != null && Number.isFinite(s.lat) && Number.isFinite(s.long);
  r.gLive = gLive;
  if (gLive) {
    const lat = s.lat as number;
    const long = s.long as number;
    r.lat = lat;
    r.long = long;
    r.trail.push([lat, long, t]);
    const k = 1 - dt * ENV_DECAY_PER_S;
    for (let i = 0; i < ENV_BINS; i++) r.env[i] *= k;
    const mag = Math.hypot(lat, long);
    const TAU = Math.PI * 2;
    const b = Math.floor(((((Math.atan2(long, lat)) % TAU) + TAU) % TAU) / TAU * ENV_BINS) % ENV_BINS;
    if (mag > r.env[b]) r.env[b] = mag;
  }
  while (r.trail.length && t - r.trail[0][2] > TRAIL_LIFE_S) r.trail.shift();

  if (t - r.lastSampleT >= RECORD_DT * 0.9) {
    r.lastSampleT = t;
    r.speedRing[r.head] = s.speedMph != null && Number.isFinite(s.speedMph) ? s.speedMph : 0;
    r.rpmRing[r.head] = s.rpm != null && Number.isFinite(s.rpm) ? s.rpm : NaN;
    r.head = (r.head + 1) % RECORD_SLOTS;
    r.count = Math.min(RECORD_SLOTS, r.count + 1);
  }
  r.version++;
}

export function resetEnvelope(r: DriveRecorder): void {
  r.env.fill(0);
  r.version++;
}

/**
 * Copy the speed/RPM rings oldest → newest into reusable output arrays (no per-frame
 * allocation). Returns the number of valid samples.
 */
export function readRecord(r: DriveRecorder, speeds: Float32Array, rpms: Float32Array): number {
  const n = r.count;
  const start = (r.head - n + RECORD_SLOTS) % RECORD_SLOTS;
  for (let i = 0; i < n; i++) {
    const k = (start + i) % RECORD_SLOTS;
    speeds[i] = r.speedRing[k];
    rpms[i] = r.rpmRing[k];
  }
  return n;
}

export const RECORDER_SLOTS = RECORD_SLOTS;
