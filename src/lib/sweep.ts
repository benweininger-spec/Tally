/**
 * Signature "moments" as pure timelines: the cold-start instrument sweep and the
 * OBD-connected sweep. PURE — no imports — so `scripts/verify.ts` can check the hard
 * caps (the boot sweep must hand the numeral to live speed by BOOT_LIVE_BY_MS and be
 * completely over by BOOT_MS).
 *
 * PulseTach evaluates these inside its own ~25 fps loop (no extra timers, no per-frame
 * React props): each frame it asks "where is the sweep at t?" and, while a frame comes
 * back, displays it instead of the follower. When the timeline returns null the
 * follower resumes from exactly where the sweep left it, so the hand-off is seamless.
 */

export interface SweepFrame {
  /** ring / tick progress, 0..1 */
  frac: number;
  /** numeral to show, or null = show live speed */
  speed: number | null;
  /** boot caption reveal, 0..1 (null = normal caption) */
  caption: number | null;
  /** redline-zone opacity multiplier, 0..1 (null = normal) */
  redline: number | null;
}

export const BOOT_UP_MS = 480; // ring 0 → full, numerals count up
export const BOOT_LIVE_BY_MS = 950; // ring back down onto live; numeral = live speed from here
export const BOOT_MS = 1200; // hard cap: everything (caption, veil) over
export const BOOT_PEAK_MPH = 80;
export const CONNECT_UP_MS = 420;
export const CONNECT_MS = 1000;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOutCubic = (t: number) => 1 - (1 - clamp01(t)) ** 3;
export const easeInOutCubic = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};

/**
 * Cold-start sweep: ring 0 → 100% → down onto the live value, ticks lighting in
 * sequence (they follow `frac`), numerals counting up then settling onto live speed,
 * caption typing in. Returns null once the sweep has handed off.
 */
export function bootSweep(tMs: number, liveFrac: number, liveSpeed: number): SweepFrame | null {
  if (!(tMs >= 0) || tMs >= BOOT_LIVE_BY_MS) return null;
  const caption = clamp01(tMs / (BOOT_UP_MS + 200));
  if (tMs < BOOT_UP_MS) {
    const p = easeOutCubic(tMs / BOOT_UP_MS);
    return { frac: p, speed: Math.round(p * BOOT_PEAK_MPH), caption, redline: p };
  }
  const p = easeInOutCubic((tMs - BOOT_UP_MS) / (BOOT_LIVE_BY_MS - BOOT_UP_MS));
  return {
    frac: lerp(1, clamp01(liveFrac), p),
    speed: Math.round(lerp(BOOT_PEAK_MPH, Math.max(0, liveSpeed), p)),
    caption,
    redline: 1,
  };
}

/**
 * OBD-link moment: the ring sweeps once from where it is to full and back onto the
 * (now RPM-based) live value, and the redline zone ignites partway through.
 */
export function connectSweep(tMs: number, fromFrac: number, liveFrac: number): SweepFrame | null {
  if (!(tMs >= 0) || tMs >= CONNECT_MS) return null;
  const redline = clamp01((tMs - CONNECT_UP_MS) / 380);
  if (tMs < CONNECT_UP_MS) {
    return { frac: lerp(clamp01(fromFrac), 1, easeOutCubic(tMs / CONNECT_UP_MS)), speed: null, caption: null, redline };
  }
  const p = easeInOutCubic((tMs - CONNECT_UP_MS) / (CONNECT_MS - CONNECT_UP_MS));
  return { frac: lerp(1, clamp01(liveFrac), p), speed: null, caption: null, redline };
}
