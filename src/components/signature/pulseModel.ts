/**
 * The signature's display model, shared by both renderers (Skia on the unit, SVG on
 * web / as the native fallback). React-free: each renderer runs its own ~25 fps loop
 * and calls stepPulse() — which advances the critically-damped follower (or plays a
 * signature moment from the sweep channel) and returns a quantized signature string.
 * A renderer only pushes new geometry when that string changes, so parked ≈ no work.
 */
import type { DashboardData } from '../../data/types';
import { buildTrace, clamp, type Trace } from '../../lib/pulse';
import { readRecord, RECORDER_SLOTS, type DriveRecorder } from '../../lib/driveRecorder';
import { bootSweep, connectSweep, type SweepFrame } from '../../lib/sweep';
import { activeSweep, endSweep } from './sweepChannel';

export const RPM_FULL = 5500;
export const REDLINE_RPM = 4700;
export const SPEED_FULL = 80;
export const LOOP_MS = 40; // ~25 fps cap
/**
 * The trace inside the ring is the last minute of RPM while OBD is live, SPEED without it
 * (it was longitudinal g — on the truck that read as jittery noise with no meaning to the
 * driver, 2026-10-26). Smoothed (1.5 s box average) and drawn as a spline, so it rolls
 * like a wave.
 */
export const CAPTION_RPM = 'RPM · LAST MINUTE';
export const CAPTION = 'SPEED · LAST MINUTE';
export const BOOT_CAPTION = 'INSTRUMENTS ONLINE · 2TR-FE';

/** Smoothed display values, mutated in place by stepPulse (never trigger renders). */
export interface PulseDisp {
  speed: number;
  rpm: number;
  frac: number;
  obdLive: boolean;
  /** the moment frame being shown (null = normal follower display) */
  moment: SweepFrame | null;
}

export const createPulseDisp = (): PulseDisp => ({ speed: 0, rpm: 0, frac: 0, obdLive: false, moment: null });

/** Reusable buffers + the last drawn trace (no per-frame allocation of the ring copy). */
export interface TraceState {
  speeds: Float32Array;
  rpms: Float32Array;
  version: number;
  trace: Trace | null;
  /** eased full scale — crossing 54 mph re-scales over ~1 s instead of snapping */
  top: number | null;
  /** what the trace shows: RPM while OBD is live, else speed */
  kind: 'rpm' | 'speed';
}
export const createTraceState = (): TraceState => ({
  speeds: new Float32Array(RECORDER_SLOTS),
  rpms: new Float32Array(RECORDER_SLOTS),
  version: -1,
  trace: null,
  top: null,
  kind: 'speed',
});

/**
 * Rebuild the speed trace from the always-on drive recorder (so it's already a minute
 * deep when HOME appears). Returns true only when the drawn curve actually changed —
 * parked, the flat line repeats and nothing is pushed.
 */
export function stepTrace(st: TraceState, rec: DriveRecorder, box: { x: number; y: number; width: number; height: number }): boolean {
  if (rec.version === st.version && st.trace) return false;
  st.version = rec.version;
  const n = readRecord(rec, st.speeds, st.rpms);
  const kind = n > 0 && Number.isFinite(st.rpms[n - 1]) ? 'rpm' : 'speed';
  if (kind !== st.kind) {
    st.kind = kind;
    st.top = null; // new units: start the scale fresh
  }
  const tr = buildTrace({
    samples: kind === 'rpm' ? st.rpms : st.speeds, // NaN (no OBD yet) reads as 0
    count: n,
    ...box,
    top: st.top ?? undefined,
    ...(kind === 'rpm' ? { scaleMin: 3000, scaleStep: 1000 } : null),
  });
  // ~1 s ease at the recorder's 20 Hz; snap when within a hair so parked goes static
  st.top = st.top == null ? tr.want : Math.abs(tr.want - st.top) < 0.05 ? tr.want : st.top + (tr.want - st.top) * 0.1;
  if (st.trace && st.trace.line === tr.line) return false;
  st.trace = tr;
  return true;
}

/**
 * Advance one frame toward the latest snapshot. `now` in performance-clock ms, `dt`
 * in seconds. Returns the quantized signature — unchanged means nothing visible moved.
 */
export function stepPulse(disp: PulseDisp, s: DashboardData, now: number, dt: number): string {
  const obdLive = s.obd.connected && s.obd.rpm.status !== 'absent' && s.obd.rpm.value != null;
  const speedT = s.motion.speedMph.value ?? 0;
  const rpmT = obdLive ? (s.obd.rpm.value as number) : 0;
  const fracT = obdLive ? clamp(rpmT / RPM_FULL, 0, 1) : clamp(speedT / SPEED_FULL, 0, 1);

  // a signature moment (boot / OBD-connect sweep) overrides the follower while its
  // timeline runs; afterwards the follower glides on from where it left off
  const sw = activeSweep();
  let moment: SweepFrame | null = null;
  if (sw) {
    const el = now - sw.t0;
    if (sw.kind === 'boot') moment = bootSweep(el, fracT, speedT);
    else {
      if (sw.from == null) sw.from = disp.frac;
      moment = connectSweep(el, sw.from, fracT);
    }
    if (!moment) endSweep(sw);
  }
  disp.moment = moment;

  if (moment) {
    disp.frac = moment.frac;
    if (moment.speed != null) disp.speed = moment.speed;
    disp.rpm = obdLive ? moment.frac * RPM_FULL : 0;
  } else {
    // critically-damped follower: k = 1 - e^(-dt/τ)
    disp.speed += (speedT - disp.speed) * (1 - Math.exp(-dt / 0.18));
    disp.rpm += (rpmT - disp.rpm) * (1 - Math.exp(-dt / 0.12));
    disp.frac += (fracT - disp.frac) * (1 - Math.exp(-dt / 0.18));
  }
  disp.obdLive = obdLive;

  return (
    `${obdLive ? 1 : 0}|${Math.round(disp.speed)}|${Math.round(disp.rpm / 20)}` +
    `|${Math.round(disp.frac * 400)}` +
    (moment ? `|${Math.round((moment.caption ?? -1) * 40)}|${Math.round((moment.redline ?? -1) * 20)}` : '')
  );
}

/** Caption text for the current frame (the boot caption types in during the sweep). */
export function captionFor(disp: PulseDisp): string {
  const c = disp.moment?.caption;
  return c != null ? BOOT_CAPTION.slice(0, Math.ceil(c * BOOT_CAPTION.length)) : disp.obdLive ? CAPTION_RPM : CAPTION;
}

/** Redline-zone stroke opacity (ignites during the connect moment). */
export const redlineOpacityFor = (disp: PulseDisp): number => 0.5 * (disp.moment?.redline ?? 1);

/** Layout of the signature at `size` px — one source of truth for both renderers. */
export function pulseLayout(size: number) {
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size * 0.47;
  const rArc = rOuter - 26;
  return {
    cx,
    cy,
    rArc,
    redFrac: REDLINE_RPM / RPM_FULL,
    wave: { x: cx - rArc * 0.78, y: cy - size * 0.205, width: rArc * 1.56, height: size * 0.15 },
    ticks: (obdLive: boolean) => ({
      cx,
      cy,
      rOuter: rArc + 14,
      minorLen: 10,
      majorLen: 22,
      count: obdLive ? 55 : 40,
      majorEvery: obdLive ? 5 : 4,
    }),
    // text baselines (SVG y), as fractions the renderers share
    rpmY: cy - size * 0.3,
    captionY: cy - size * 0.235,
    speedY: cy + size * 0.16,
    unitY: cy + size * 0.215,
  };
}
