/**
 * Phosphor G-Scope geometry (Signal Library study 04) — an XY beam of lateral (x) /
 * longitudinal (y) g with a decaying phosphor trail and a session "grip envelope":
 * 36 angular bins of peak |g| that fade slowly, i.e. how hard you've actually pushed.
 *
 * PURE — no imports. Emits SVG path strings consumed by either renderer (Skia on the
 * unit, SVG on web). Checked by scripts/verify.ts.
 *
 * Axes: +lat = right, +long = accelerating (drawn UP the screen).
 */

export const ENV_BINS = 36;
export const ENV_DECAY_PER_S = 0.015; // envelope fades ×(1 − 0.015·dt)
export const SCOPE_RINGS = [0.2, 0.4, 0.6, 0.8]; // g; the 0.8 ring is the outer edge
export const TRAIL_BANDS = 8;

/** Seconds of trail kept: 0.6 s at persistence 0, 5.6 s at 1. */
export const trailLife = (persistence: number) => 0.6 + Math.max(0, Math.min(1, persistence)) * 5;

/** Envelope bin (0..35) for a g vector, by its angle (0 = right, CCW). */
export function envelopeBin(lat: number, long: number): number {
  const TAU = Math.PI * 2;
  const ang = Math.atan2(long, lat);
  return Math.floor((((ang % TAU) + TAU) % TAU) / TAU * ENV_BINS) % ENV_BINS;
}

/** Decay every bin, then raise the bin the current vector falls in. Mutates `env`. */
export function updateEnvelope(env: number[], lat: number, long: number, dt: number): void {
  const k = 1 - Math.max(0, dt) * ENV_DECAY_PER_S;
  for (let i = 0; i < env.length; i++) env[i] *= k;
  const mag = Math.hypot(lat, long);
  if (!Number.isFinite(mag)) return;
  const b = envelopeBin(lat, long);
  if (mag > env[b]) env[b] = mag;
}

export const envelopePeak = (env: number[]) => env.reduce((m, v) => (v > m ? v : m), 0);

const f = (n: number) => (Math.round(n * 10) / 10).toString();

/** Closed circle as an SVG path (two arcs). */
export function circlePath(cx: number, cy: number, r: number): string {
  return `M ${f(cx - r)} ${f(cy)} A ${f(r)} ${f(r)} 0 1 0 ${f(cx + r)} ${f(cy)} A ${f(r)} ${f(r)} 0 1 0 ${f(cx - r)} ${f(cy)} Z`;
}

/** Static grid: the inner rings, the outer (0.8 g) ring, and the crosshair. */
export function gscopeGrid(cx: number, cy: number, S: number) {
  const inner = SCOPE_RINGS.slice(0, -1).map((g) => circlePath(cx, cy, g * S)).join(' ');
  const outer = circlePath(cx, cy, SCOPE_RINGS[SCOPE_RINGS.length - 1] * S);
  const c = S * 0.9;
  const cross = `M ${f(cx - c)} ${f(cy)} L ${f(cx + c)} ${f(cy)} M ${f(cx)} ${f(cy - c)} L ${f(cx)} ${f(cy + c)}`;
  return { inner, outer, cross };
}

export interface ScopeFrame {
  /** trail split into TRAIL_BANDS, oldest → newest (draw with rising alpha/width) */
  bands: string[];
  /** closed grip envelope */
  envelope: string;
  /** beam position (px) */
  beam: { x: number; y: number };
}

/**
 * One frame. `trail` is [lat, long] pairs oldest → newest; `S` is px per g (the 0.8 g
 * ring sits at 0.8·S). Values beyond the scope are clamped to 1.12× the outer ring.
 */
export function gscopeFrame(o: {
  cx: number;
  cy: number;
  S: number;
  trail: [number, number][];
  env: number[];
  lat: number;
  long: number;
}): ScopeFrame {
  const lim = SCOPE_RINGS[SCOPE_RINGS.length - 1] * 1.12;
  const cl = (v: number) => Math.max(-lim, Math.min(lim, Number.isFinite(v) ? v : 0));
  const X = (lat: number) => o.cx + cl(lat) * o.S;
  const Y = (long: number) => o.cy - cl(long) * o.S;

  const n = o.trail.length;
  const bands: string[] = [];
  for (let b = 0; b < TRAIL_BANDS; b++) {
    if (n < 2) {
      bands.push('');
      continue;
    }
    const i0 = Math.floor((b * (n - 1)) / TRAIL_BANDS);
    const i1 = Math.floor(((b + 1) * (n - 1)) / TRAIL_BANDS);
    let d = '';
    for (let i = i0; i <= i1; i++) d += `${i === i0 ? 'M' : ' L'} ${f(X(o.trail[i][0]))} ${f(Y(o.trail[i][1]))}`;
    bands.push(i1 > i0 ? d : '');
  }

  const TAU = Math.PI * 2;
  let env = '';
  for (let i = 0; i <= ENV_BINS; i++) {
    const k = i % ENV_BINS;
    const a = ((k + 0.5) / ENV_BINS) * TAU;
    const r = Math.min(lim, Math.max(0.05, o.env[k] || 0)) * o.S;
    env += `${i ? ' L' : 'M'} ${f(o.cx + Math.cos(a) * r)} ${f(o.cy - Math.sin(a) * r)}`;
  }
  env += ' Z';

  return { bands, envelope: env, beam: { x: X(o.lat), y: Y(o.long) } };
}
