/**
 * The signature's display model, shared by both renderers (Skia on the unit, SVG on
 * web / as the native fallback). React-free: each renderer runs its own ~25 fps loop
 * and calls stepPulse() — which advances the critically-damped follower (or plays a
 * signature moment from the sweep channel) and returns a quantized signature string.
 * A renderer only pushes new geometry when that string changes, so parked ≈ no work.
 */
import type { DashboardData } from '../../data/types';
import { clamp } from '../../lib/pulse';
import { bootSweep, connectSweep, type SweepFrame } from '../../lib/sweep';
import { activeSweep, endSweep } from './sweepChannel';

export const RPM_FULL = 5500;
export const REDLINE_RPM = 4700;
export const SPEED_FULL = 80;
export const WAVE_RANGE_G = 0.4; // real 2TR-FE street g fills the trace; was 0.55 (sim-tuned)
export const WAVE_SAMPLES = 100; // decimated from HISTORY_LEN=240 — visually identical at ~720px
export const LOOP_MS = 40; // ~25 fps cap
export const CAPTION = 'DRIVE PULSE · LONGITUDINAL G';
export const BOOT_CAPTION = 'INSTRUMENTS ONLINE · 2TR-FE';

/** Smoothed display values, mutated in place by stepPulse (never trigger renders). */
export interface PulseDisp {
  speed: number;
  rpm: number;
  frac: number;
  longG: number;
  obdLive: boolean;
  /** the moment frame being shown (null = normal follower display) */
  moment: SweepFrame | null;
}

export const createPulseDisp = (): PulseDisp => ({ speed: 0, rpm: 0, frac: 0, longG: 0, obdLive: false, moment: null });

/** Even-sample a buffer down to `target` points, always keeping first + newest. */
export function decimate(arr: number[], target: number): number[] {
  const n = arr.length;
  if (n <= target) return arr;
  const out: number[] = [];
  const stepF = (n - 1) / (target - 1);
  for (let i = 0; i < target; i++) out.push(arr[Math.round(i * stepF)]);
  return out;
}

/**
 * Advance one frame toward the latest snapshot. `now` in performance-clock ms, `dt`
 * in seconds. Returns the quantized signature — unchanged means nothing visible moved.
 */
export function stepPulse(disp: PulseDisp, s: DashboardData, longGHist: number[], now: number, dt: number): string {
  const obdLive = s.obd.connected && s.obd.rpm.status !== 'absent' && s.obd.rpm.value != null;
  const speedT = s.motion.speedMph.value ?? 0;
  const rpmT = obdLive ? (s.obd.rpm.value as number) : 0;
  const fracT = obdLive ? clamp(rpmT / RPM_FULL, 0, 1) : clamp(speedT / SPEED_FULL, 0, 1);
  const longGT = s.motion.longG.value ?? 0;

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
  disp.longG += (longGT - disp.longG) * (1 - Math.exp(-dt / 0.08));
  disp.obdLive = obdLive;

  const newest = longGHist.length ? longGHist[longGHist.length - 1] : 0;
  return (
    `${obdLive ? 1 : 0}|${Math.round(disp.speed)}|${Math.round(disp.rpm / 20)}` +
    `|${Math.round(disp.frac * 400)}|${Math.round(disp.longG * 200)}|${Math.round(newest * 200)}` +
    (moment ? `|${Math.round((moment.caption ?? -1) * 40)}|${Math.round((moment.redline ?? -1) * 20)}` : '')
  );
}

/** Caption text for the current frame (the boot caption types in during the sweep). */
export function captionFor(disp: PulseDisp): string {
  const c = disp.moment?.caption;
  return c != null ? BOOT_CAPTION.slice(0, Math.ceil(c * BOOT_CAPTION.length)) : CAPTION;
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
