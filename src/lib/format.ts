/** Small display formatters. Pure, no imports. */

export function clockTime(now: number): { time: string; ampm: string } {
  const d = new Date(now);
  const hh = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  return { time: `${(hh % 12) || 12}:${mm}`, ampm: hh >= 12 ? 'PM' : 'AM' };
}

export function cardinal(deg: number): string {
  const cards = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return cards[Math.round(deg / 45) % 8];
}

export function signed(v: number, digits = 2): string {
  const s = v >= 0 ? '+' : '−';
  return s + Math.abs(v).toFixed(digits);
}

export function hms(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
