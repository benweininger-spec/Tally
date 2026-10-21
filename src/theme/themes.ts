/**
 * Theme tokens. The references vote overwhelmingly for amber VFD, so amber is
 * the shipped default — but everything is tokenized so adding the mono / teal /
 * red directions later is a data change, not a refactor.
 *
 * `amberDay` exists because "readable in direct desert sun" is a HARD constraint
 * (design-brief §2) and amber-on-black is the worst case for it. Night is the
 * hero; day flips to high-contrast. The switch is driven by system.isDaylight.
 */

export interface Theme {
  name: string;
  bg: string;
  panel: string;
  panelBorder: string;
  hairline: string;
  /** primary instrument accent (speed, live values, signature) */
  accent: string;
  accentSoft: string;
  accentGlow: string; // rgba for shadows/drop-shadows
  /** primary readable text */
  text: string;
  textDim: string;
  textFaint: string;
  /** absent / awaiting-OBD elements */
  absent: string;
  /** warning / redline */
  warn: string;
  fontDisplay: string; // big numerals
  fontMono: string; // labels, telemetry
  /** signature ring stroke multiplier (day thickens lines for sun) */
  stroke: number;
  /** reactive ambient glow opacity cap (day keeps it near-invisible) */
  ambientMax: number;
}

export const amberNight: Theme = {
  name: 'amber-night',
  bg: '#0c0a07',
  panel: 'rgba(244,162,58,0.035)',
  panelBorder: 'rgba(244,162,58,0.20)',
  hairline: 'rgba(244,162,58,0.18)',
  accent: '#FFB454',
  accentSoft: '#c9a96f',
  accentGlow: 'rgba(255,180,84,0.45)',
  text: '#F4E6CF',
  textDim: '#c9a96f',
  textFaint: '#9a7f54',
  absent: '#5a4a30',
  warn: '#F2403A',
  fontDisplay: 'Oxanium',
  fontMono: 'JetBrains Mono',
  stroke: 1,
  ambientMax: 0.16,
};

/**
 * DAY = sun-readable. Amber-on-black washes out in direct desert sun because a
 * dark screen has almost no lit area to compete with ambient light, so day mode
 * INVERTS: a warm near-white field (the most lit area the panel can make) with
 * espresso text and a deep burnt-amber accent. Contrast targets, checked by
 * `npm run verify` / `npm run contrast` (WCAG ratio vs bg):
 *   text / accent / accentSoft / textDim / warn ≥ 7:1 (AAA) · textFaint ≥ 4.5:1
 * Ring strokes are 20% heavier and the ambient glow is capped at 0.06. The owner
 * judges it outdoors; retune here.
 */
export const amberDay: Theme = {
  name: 'amber-day',
  bg: '#FBF5E8', // warm near-white
  panel: 'rgba(74,42,8,0.04)',
  panelBorder: 'rgba(74,42,8,0.56)', // ≥ 3:1 — tile edges must survive glare
  hairline: 'rgba(74,42,8,0.30)',
  accent: '#7A3800', // deep burnt amber
  accentSoft: '#6B3A0E',
  accentGlow: 'rgba(122,56,0,0.18)',
  text: '#1C1103', // espresso, near-black warm
  textDim: '#4A320F',
  textFaint: '#6E5428',
  absent: '#B89C6A',
  warn: '#9B1C1C', // deep red still reads on light for redline
  fontDisplay: 'Oxanium',
  fontMono: 'JetBrains Mono',
  stroke: 1.2,
  ambientMax: 0.06,
};

export const themes = { amberNight, amberDay };

/**
 * Minimum WCAG contrast vs `bg` for the DAY palette (direct-sun legibility).
 * Asserted by `npm run verify`, tabulated by `npm run contrast`, shown in SET → THEME.
 */
export const DAY_CONTRAST_TARGETS = {
  text: 7,
  accent: 7,
  accentSoft: 7,
  textDim: 7,
  warn: 7,
  textFaint: 4.5,
} as const;

/** Pick the active theme from environment. Extend with user override later. */
export function selectTheme(isDaylight: boolean): Theme {
  return isDaylight ? amberDay : amberNight;
}

// ---- color math (pure; shared by the night face dimming + day/night crossfade) ----
export type RGBA = [r: number, g: number, b: number, a: number];

/** '#rgb' | '#rrggbb' | 'rgb(…)' | 'rgba(…)' → [0-255, 0-255, 0-255, 0-1]; null if not a color. */
export function parseColor(c: unknown): RGBA | null {
  if (typeof c !== 'string') return null;
  const s = c.trim();
  if (s[0] === '#') {
    const h = s.slice(1);
    if (h.length === 3) return [0, 1, 2].map((i) => parseInt(h[i] + h[i], 16)).concat(1) as RGBA;
    if (h.length === 6) return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1) as RGBA;
    return null;
  }
  const m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (!m) return null;
  const p = m[1].split(',').map((x) => parseFloat(x));
  if (p.length < 3 || p.some((x) => !Number.isFinite(x))) return null;
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}

export function formatColor([r, g, b, a]: RGBA): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  if (a >= 0.999) return '#' + [r, g, b].map((v) => c(v).toString(16).padStart(2, '0')).join('');
  return `rgba(${c(r)},${c(g)},${c(b)},${Math.round(Math.max(0, Math.min(1, a)) * 1000) / 1000})`;
}

const toLinear = (v: number) => {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (l: number) => 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055);

/** WCAG relative luminance (0..1) of an opaque color. */
export function relLuminance(c: string): number {
  const p = parseColor(c);
  if (!p) return 0;
  return 0.2126 * toLinear(p[0]) + 0.7152 * toLinear(p[1]) + 0.0722 * toLinear(p[2]);
}

/** Paint a (possibly translucent) color over an opaque backdrop. */
export function composite(fg: string, over: string): string {
  const f = parseColor(fg);
  const b = parseColor(over);
  if (!f || !b) return fg;
  const a = f[3];
  return formatColor([f[0] * a + b[0] * (1 - a), f[1] * a + b[1] * (1 - a), f[2] * a + b[2] * (1 - a), 1]);
}

/** WCAG contrast ratio (1..21) of `fg` on `bg`; translucent fg is composited first. */
export function contrastRatio(fg: string, bg: string): number {
  const a = relLuminance(composite(fg, bg));
  const b = relLuminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Map every color token of a theme through `fn`; non-color strings are copied. */
function mapTheme(t: Theme, fn: (c: RGBA, key: keyof Theme) => RGBA, name: string): Theme {
  const out = { ...t, name } as Theme;
  for (const k of Object.keys(t) as (keyof Theme)[]) {
    const p = parseColor(t[k]);
    if (p) (out as unknown as Record<string, unknown>)[k] = formatColor(fn(p, k));
  }
  return out;
}

/** Scale every color token's luminance to `k` (0..1) — in linear light, alpha kept. */
export function dimTheme(t: Theme, k: number): Theme {
  return mapTheme(t, ([r, g, b, a]) => [toSrgb(toLinear(r) * k), toSrgb(toLinear(g) * k), toSrgb(toLinear(b) * k), a], `${t.name}-dim`);
}

/**
 * Blend two themes: every color token lerped in RGB (alpha too), `t` 0 → a, 1 → b.
 * Non-color strings (name, font families) come from `b`. Drives the dusk/dawn crossfade.
 */
export function lerpTheme(a: Theme, b: Theme, t: number): Theme {
  const k = Math.max(0, Math.min(1, t));
  if (k <= 0) return a;
  if (k >= 1) return b;
  const out = { ...b, name: `${a.name}→${b.name}@${k.toFixed(3)}` } as Theme;
  const o = out as unknown as Record<string, unknown>;
  for (const key of Object.keys(b) as (keyof Theme)[]) {
    const va = a[key];
    const vb = b[key];
    if (typeof va === 'number' && typeof vb === 'number') {
      o[key] = va + (vb - va) * k;
      continue;
    }
    const pa = parseColor(va);
    const pb = parseColor(vb);
    if (!pa || !pb) continue;
    o[key] = formatColor([
      pa[0] + (pb[0] - pa[0]) * k,
      pa[1] + (pb[1] - pa[1]) * k,
      pa[2] + (pb[2] - pa[2]) * k,
      pa[3] + (pb[3] - pa[3]) * k,
    ]);
  }
  return out;
}

/** Night face palette: the night theme at ~40% luminance (design-brief: calm, dark cab). */
export const amberNightDim: Theme = dimTheme(amberNight, 0.4);
