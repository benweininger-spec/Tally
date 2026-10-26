/**
 * Colour ramps for the glance readouts. Pure (theme + engineGlance only) so verify can
 * check the stages.
 *  • coolant: cold blue → amber in 3 steps as the engine warms; warn when hot
 *  • economy: ECO green → accent amber → warn as mpg falls toward "poor"
 */
import { COOLANT_HOT_F, ecoLevel, warmupStage } from '../lib/engineGlance';
import { mixColor, type Theme } from './themes';

export function coolantColor(t: Theme, f: number | null): string {
  if (f == null || !Number.isFinite(f)) return t.absent;
  if (f >= COOLANT_HOT_F) return t.warn;
  return mixColor(t.cold, t.accent, warmupStage(f) / 3);
}

/** green at/above the eco line, fading through amber to warn at poor economy */
export function economyColor(t: Theme, mpg: number | null): string {
  const lv = ecoLevel(mpg);
  if (lv == null) return t.absent;
  return lv >= 0.5 ? mixColor(t.accent, t.eco, (lv - 0.5) * 2) : mixColor(t.warn, t.accent, lv * 2);
}
