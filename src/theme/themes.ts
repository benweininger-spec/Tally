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
};

/**
 * DAY = sun-readable. Amber-on-black washes out in direct desert sun because a
 * dark screen has almost no lit area to compete with ambient light, so day mode
 * INVERTS: a warm, near-opaque light field with espresso text and a saturated
 * burnt-amber accent. Same identity, maximum contrast. Tuned on-panel later.
 */
export const amberDay: Theme = {
  name: 'amber-day',
  bg: '#F2E2BE', // warm sand
  panel: 'rgba(74,42,8,0.06)',
  panelBorder: 'rgba(74,42,8,0.42)',
  hairline: 'rgba(74,42,8,0.28)',
  accent: '#B45309', // burnt amber — high contrast on sand
  accentSoft: '#7C4513',
  accentGlow: 'rgba(180,83,9,0.18)',
  text: '#241704', // espresso, near-black warm
  textDim: '#5C4017',
  textFaint: '#856433',
  absent: '#C2A877',
  warn: '#B91C1C', // deep red still reads on light for redline
  fontDisplay: 'Oxanium',
  fontMono: 'JetBrains Mono',
};

export const themes = { amberNight, amberDay };

/** Pick the active theme from environment. Extend with user override later. */
export function selectTheme(isDaylight: boolean): Theme {
  return isDaylight ? amberDay : amberNight;
}
