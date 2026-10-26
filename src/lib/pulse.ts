/**
 * Pure geometry for the signature element (the "pulse tach").
 *
 * Two parts, after the Tesla Model S energy graph (REFERENCES/model s example.jpg):
 *   1. A scrolling, filled waveform of longitudinal-g, centered on a zero line.
 *   2. A radial arc gauge wrapping it — RPM when OBD is live, ground speed before.
 *
 * SELF-CONTAINED ON PURPOSE: no imports. The render layer (SVG today, Skia later)
 * just consumes these strings/arrays. Runs under `node --experimental-strip-types`
 * for tests — see scripts/verify.ts.
 *
 * Angle convention: degrees, y-DOWN, clockwise from 3 o'clock.
 *   0 = right, 90 = bottom, 180 = left, 270 = top.
 */

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const mapRange = (v: number, inA: number, inB: number, outA: number, outB: number) =>
  outA + ((clamp(v, inA, inB) - inA) / (inB - inA)) * (outB - outA);

export interface Point {
  x: number;
  y: number;
}

export function polar(cx: number, cy: number, r: number, deg: number): Point {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** Clockwise arc path from startDeg to endDeg (endDeg > startDeg). */
export function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const s = polar(cx, cy, r, startDeg);
  const e = polar(cx, cy, r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${f(s.x)} ${f(s.y)} A ${f(r)} ${f(r)} 0 ${large} 1 ${f(e.x)} ${f(e.y)}`;
}

// ---- gauge geometry ---------------------------------------------------------
// Bottom-open tach: starts lower-left, sweeps clockwise over the top to lower-right.
export const GAUGE_START = 135;
export const GAUGE_SWEEP = 270;
export const GAUGE_END = GAUGE_START + GAUGE_SWEEP; // 405 (== 45deg)

export interface Tick {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  major: boolean;
  /** 0..1 position along the sweep */
  frac: number;
}

export interface GaugeTicksOpts {
  cx: number;
  cy: number;
  rOuter: number;
  minorLen: number;
  majorLen: number;
  count: number; // number of intervals
  majorEvery: number;
}

export function gaugeTicks(o: GaugeTicksOpts): Tick[] {
  const out: Tick[] = [];
  for (let i = 0; i <= o.count; i++) {
    const frac = i / o.count;
    const deg = GAUGE_START + frac * GAUGE_SWEEP;
    const major = i % o.majorEvery === 0;
    const len = major ? o.majorLen : o.minorLen;
    const a = polar(o.cx, o.cy, o.rOuter - len, deg);
    const b = polar(o.cx, o.cy, o.rOuter, deg);
    out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, major, frac });
  }
  return out;
}

/** Full track arc (the dim background ring). */
export function gaugeTrack(cx: number, cy: number, r: number): string {
  return arcPath(cx, cy, r, GAUGE_START, GAUGE_END);
}

/** Lit progress arc for a 0..1 value. Returns null below a hair so SVG stays valid. */
export function gaugeProgress(cx: number, cy: number, r: number, frac: number): string | null {
  const f01 = clamp(frac, 0, 1);
  if (f01 <= 0.001) return null;
  return arcPath(cx, cy, r, GAUGE_START, GAUGE_START + f01 * GAUGE_SWEEP);
}

/** Redline zone arc, from redFrac..1 (e.g. 0.84 for ~4400rpm of 5200). */
export function gaugeRedline(cx: number, cy: number, r: number, redFrac: number): string {
  return arcPath(cx, cy, r, GAUGE_START + clamp(redFrac, 0, 1) * GAUGE_SWEEP, GAUGE_END);
}

// ---- waveform ---------------------------------------------------------------
export interface WaveformOpts {
  /** oldest -> newest */
  samples: number[];
  x: number;
  y: number;
  width: number;
  height: number;
  /** value mapped to +/- this fills half-height (e.g. 0.6 g) */
  range: number;
  /** close the fill at the bottom edge instead of the zero line (terrain-style area) */
  floor?: boolean;
}

export interface Waveform {
  /** the trace polyline */
  line: string;
  /** filled region between trace and the zero baseline */
  fill: string;
  /** y of the zero baseline */
  baseline: number;
  /** newest-sample point (lead of the scroll), for a glow dot */
  head: Point;
}

export function buildWaveform(o: WaveformOpts): Waveform {
  const n = o.samples.length;
  const baseline = o.y + o.height / 2;
  if (n === 0) {
    return { line: `M ${f(o.x)} ${f(baseline)}`, fill: '', baseline, head: { x: o.x, y: baseline } };
  }
  const pts: Point[] = o.samples.map((s, i) => {
    const px = o.x + (n === 1 ? 0 : (i / (n - 1)) * o.width);
    const v = clamp(s / o.range, -1, 1);
    const py = baseline - v * (o.height / 2);
    return { x: px, y: py };
  });
  let line = `M ${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) line += ` L ${f(pts[i].x)} ${f(pts[i].y)}`;
  const last = pts[pts.length - 1];
  const fillY = o.floor ? o.y + o.height : baseline;
  const fill =
    `M ${f(pts[0].x)} ${f(fillY)} ` +
    pts.map((p) => `L ${f(p.x)} ${f(p.y)}`).join(' ') +
    ` L ${f(last.x)} ${f(fillY)} Z`;
  return { line, fill, baseline, head: last };
}

function f(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

// ---- smooth trace (the signature's speed history) ----------------------------
export interface TraceOpts {
  /** oldest → newest (e.g. the drive recorder's 20 Hz speed ring, read out in order) */
  samples: ArrayLike<number>;
  /** valid samples at the start of `samples` */
  count: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** samples spanning the full width (default 1200 = 60 s at 20 Hz) */
  window?: number;
  /** curve knots across the width (default 72) */
  points?: number;
  /** moving-average width in samples (default 30 = 1.5 s) — irons out GPS stair-steps */
  smooth?: number;
  /** smallest full-scale value (default 40) and the step it rounds up to (default 20) */
  scaleMin?: number;
  scaleStep?: number;
  /** draw against this full scale instead of the computed one (lets a caller ease it) */
  top?: number;
}

export interface Trace {
  /** smooth curve (cubic Béziers) — no corners, no jags */
  line: string;
  /** the curve closed down to the floor */
  fill: string;
  /** y of the zero line (bottom of the box) */
  floor: number;
  /** newest point, for the glow dot */
  head: Point;
  /** full-scale value the box height represents */
  top: number;
  /** the full scale this data wants (rounded max) — ease `top` toward it */
  want: number;
}

/**
 * A wavy history line: box-averaged knots at fixed x positions (time ≈ now − age), joined
 * with a Catmull-Rom spline. Knot times are measured from the END of the newest sample, so
 * each new sample slides every knot 1/stride of a knot-gap through the data — with the
 * continuous (fractional) box average that reads as a smooth scroll, not a hop.
 */
export function buildTrace(o: TraceOpts): Trace {
  const W = Math.max(2, o.window ?? 1200);
  const K = Math.max(2, Math.floor(o.points ?? 72));
  const S = Math.max(1, o.smooth ?? 30);
  const n = Math.max(0, Math.min(Math.floor(o.count), o.samples.length));
  const floor = o.y + o.height;

  // prefix sums → cumulative C(t) is piecewise-linear in t, so averages over fractional
  // windows change continuously as the window slides
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const v = o.samples[i];
    pre[i + 1] = pre[i] + (Number.isFinite(v) ? Math.max(0, v) : 0);
  }
  const C = (t: number) => {
    if (t <= 0) return 0;
    if (t >= n) return pre[n];
    const i = Math.floor(t);
    return pre[i] + (t - i) * (pre[i + 1] - pre[i]);
  };
  const avg = (center: number) => {
    const a = Math.max(0, center - S / 2);
    const b = Math.min(n, center + S / 2);
    return b - a > 1e-6 ? (C(b) - C(a)) / (b - a) : 0;
  };

  const stride = W / (K - 1);
  const vals: number[] = new Array(K);
  let max = 0;
  for (let k = 0; k < K; k++) {
    const v = avg(n - (K - 1 - k) * stride);
    vals[k] = v;
    if (v > max) max = v;
  }
  const scaleMin = o.scaleMin ?? 40;
  const step = o.scaleStep ?? 20;
  const want = Math.max(scaleMin, Math.ceil((max * 1.1) / step) * step);
  const top = o.top != null && o.top > 0 ? o.top : want;

  const pts: Point[] = vals.map((v, k) => ({
    x: o.x + (k / (K - 1)) * o.width,
    y: floor - Math.min(1, v / top) * o.height,
  }));
  const clampY = (y: number) => Math.max(o.y, Math.min(floor, y));
  let line = `M ${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 0; i < K - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? pts[i + 1];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = clampY(p1.y + (p2.y - p0.y) / 6);
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = clampY(p2.y - (p3.y - p1.y) / 6);
    line += ` C ${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  const last = pts[K - 1];
  const fill = `${line} L ${f(last.x)} ${f(floor)} L ${f(pts[0].x)} ${f(floor)} Z`;
  return { line, fill, floor, head: last, top, want };
}
