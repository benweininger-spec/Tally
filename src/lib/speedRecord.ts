/**
 * Speed Record geometry (Signal Library study 06) — a tachograph disc: the last 90 s
 * of ground speed inked radially (faster = further out), newest at the 12 o'clock pen,
 * older samples receding counter-clockwise. The last 10 s glows; an inner track carries
 * RPM once OBD is live.
 *
 * PURE — no imports. Emits SVG path strings for either renderer. Checked by
 * scripts/verify.ts.
 */

export const RECORD_DT = 0.05; // s between samples (the data tick)
export const RECORD_SPAN_S = 90;
export const RECORD_SLOTS = Math.round(RECORD_SPAN_S / RECORD_DT); // 1800
export const RECORD_FULL_MPH = 70; // outer edge of the disc
const FRESH_S = 10; // the glowing newest stretch
const STRIDE = 3; // draw every 3rd sample (~580 points round the disc)

const TAU = Math.PI * 2;
const TOP = -Math.PI / 2;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const f = (n: number) => (Math.round(n * 10) / 10).toString();

/** Radius for a speed: R0 at 0 mph → R1 at RECORD_FULL_MPH. */
export const speedRadius = (mph: number, R0: number, R1: number) =>
  R0 + clamp01((Number.isFinite(mph) ? mph : 0) / RECORD_FULL_MPH) * (R1 - R0);

/**
 * Inner RPM track radius: 600 → 3200 rpm across a thin band just inside the zero-speed
 * ring (0.78–0.96 R0), leaving the hub clear for the clock (the study used 0.5–0.92 R0
 * with a tiny clock).
 */
export const rpmRadius = (rpm: number, R0: number) => R0 * 0.78 + clamp01((rpm - 600) / 2600) * R0 * 0.18;
/** Hub ring radius — the clock lives inside it. */
export const HUB_FRAC = 0.74;

/** Static disc furniture: speed rings every 10 mph (the 20/40/60 ones brighter). */
export function recordGrid(cx: number, cy: number, R0: number, R1: number) {
  const ring = (r: number) =>
    `M ${f(cx - r)} ${f(cy)} A ${f(r)} ${f(r)} 0 1 0 ${f(cx + r)} ${f(cy)} A ${f(r)} ${f(r)} 0 1 0 ${f(cx - r)} ${f(cy)} Z`;
  const major: string[] = [];
  const minor: string[] = [];
  for (let v = 10; v <= 70; v += 10) (v % 20 === 0 ? major : minor).push(ring(speedRadius(v, R0, R1)));
  return { major: major.join(' '), minor: minor.join(' '), hub: ring(R0 * 0.46), pen: `M ${f(cx)} ${f(cy - R0)} L ${f(cx)} ${f(cy - R1 - 14)}` };
}

/** Time spokes, rotating with the disc (`rot` radians = elapsed / 90 s · 2π). */
export function recordSpokes(cx: number, cy: number, R0: number, R1: number, rot: number) {
  let major = '';
  let minor = '';
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * TAU - rot;
    const c = Math.cos(a);
    const s = Math.sin(a);
    if (i % 6 === 0) major += `M ${f(cx + c * R0)} ${f(cy + s * R0)} L ${f(cx + c * (R1 + 9))} ${f(cy + s * (R1 + 9))} `;
    else minor += `M ${f(cx + c * R1)} ${f(cy + s * R1)} L ${f(cx + c * (R1 + 4))} ${f(cy + s * (R1 + 4))} `;
  }
  return { major: major.trim(), minor: minor.trim() };
}

export interface RecordFrame {
  /** whole 90 s trace */
  line: string;
  /** newest 10 s (glow) */
  fresh: string;
  /** filled band between the trace and the hub (even-odd not needed: it's one loop) */
  area: string;
  /** inner RPM track, '' when no RPM */
  rpm: string;
  /** pen tip (newest sample) */
  head: { x: number; y: number } | null;
}

/**
 * One frame from the newest-last sample arrays. `speeds`/`rpms` are the same length;
 * an RPM of NaN means "absent" (no OBD) and breaks the inner track.
 */
export function recordFrame(o: {
  cx: number;
  cy: number;
  R0: number;
  R1: number;
  speeds: ArrayLike<number>;
  rpms?: ArrayLike<number>;
}): RecordFrame {
  const N = o.speeds.length;
  const n = Math.min(N, RECORD_SLOTS - 60); // leave a gap so the tail never meets the pen
  if (n < 1) return { line: '', fresh: '', area: '', rpm: '', head: null };
  const freshN = Math.round(FRESH_S / RECORD_DT);

  let line = '';
  let fresh = '';
  let rpm = '';
  let rpmOpen = false;
  let head: { x: number; y: number } | null = null;
  let aLast = TOP;
  for (let j = 0; j < n; j += STRIDE) {
    const idx = N - 1 - j;
    const a = TOP - ((j * RECORD_DT) / RECORD_SPAN_S) * TAU;
    const r = speedRadius(o.speeds[idx], o.R0, o.R1);
    const x = o.cx + Math.cos(a) * r;
    const y = o.cy + Math.sin(a) * r;
    const pt = `${f(x)} ${f(y)}`;
    if (j === 0) {
      line = `M ${pt}`;
      fresh = `M ${pt}`;
      head = { x, y };
    } else {
      line += ` L ${pt}`;
      if (j <= freshN) fresh += ` L ${pt}`;
    }
    aLast = a;
    const rv = o.rpms ? o.rpms[idx] : NaN;
    if (Number.isFinite(rv)) {
      const rr = rpmRadius(rv, o.R0);
      rpm += `${rpmOpen ? ' L' : ' M'} ${f(o.cx + Math.cos(a) * rr)} ${f(o.cy + Math.sin(a) * rr)}`;
      rpmOpen = true;
    } else rpmOpen = false;
  }

  // area: trace → down to the hub at the oldest angle → hub arc back to 12 o'clock
  const hx = o.cx + Math.cos(aLast) * o.R0;
  const hy = o.cy + Math.sin(aLast) * o.R0;
  const sweep = TOP - aLast; // radians covered, counter-clockwise from the pen
  const large = sweep > Math.PI ? 1 : 0;
  const area =
    n > STRIDE
      ? `${line} L ${f(hx)} ${f(hy)} A ${f(o.R0)} ${f(o.R0)} 0 ${large} 1 ${f(o.cx)} ${f(o.cy - o.R0)} Z`
      : '';
  return { line, fresh: fresh.includes(' L ') ? fresh : '', area, rpm: rpm.trim(), head };
}
