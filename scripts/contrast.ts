/**
 * Contrast report for the shipped palettes: WCAG 2.x ratio of every text / accent /
 * UI token against the theme background and against a panel (translucent tokens are
 * composited first). Pure — runs in Node:
 *   npm run contrast
 * The DAY targets (DAY_CONTRAST_TARGETS) are also asserted by `npm run verify`.
 */
import {
  amberDay,
  amberNight,
  amberNightDim,
  composite,
  contrastRatio,
  DAY_CONTRAST_TARGETS,
  type Theme,
} from '../src/theme/themes.ts';

const TOKENS = ['text', 'accent', 'accentSoft', 'textDim', 'textFaint', 'warn', 'absent', 'panelBorder', 'hairline'] as const;

const grade = (r: number) => (r >= 7 ? 'AAA' : r >= 4.5 ? 'AA ' : r >= 3 ? 'UI ' : '-- ');

function report(t: Theme, targets?: Partial<Record<string, number>>) {
  const panel = composite(t.panel, t.bg);
  console.log(`\n${t.name}   bg ${t.bg}   panel ${panel}`);
  console.log('  token        color                      on bg        on panel   target');
  for (const k of TOKENS) {
    const c = t[k];
    const onBg = contrastRatio(c, t.bg);
    const onPanel = contrastRatio(c, panel);
    const target = targets?.[k];
    const flag = target == null ? '' : onBg >= target ? `≥ ${target} ✓` : `≥ ${target} ✗`;
    console.log(
      `  ${k.padEnd(12)} ${c.padEnd(26)} ${onBg.toFixed(2).padStart(5)} ${grade(onBg)}  ${onPanel.toFixed(2).padStart(5)} ${grade(onPanel)}  ${flag}`
    );
  }
}

report(amberDay, DAY_CONTRAST_TARGETS);
report(amberNight);
report(amberNightDim);
console.log('\nAAA ≥ 7 · AA ≥ 4.5 · UI ≥ 3 (borders / non-text)\n');
