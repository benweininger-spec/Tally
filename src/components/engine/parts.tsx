/**
 * Building blocks for the ENGINE face. Presentational only — every data-bound wrapper
 * is a React.memo + useTelemetry(selector) component that passes primitives in, so a
 * block re-renders only when its quantised value changes (CLAUDE.md perf model).
 *
 * The absent contract: a block with no value renders COMPLETE — a dash in `absent`
 * with its label dimmed, never a blank gauge.
 */
import React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

export function Card({ title, right, style, children }: { title?: string; right?: React.ReactNode; style?: ViewStyle; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={[styles.card, { borderColor: t.panelBorder, backgroundColor: t.panel }, style]}>
      {(title || right) && (
        <View style={styles.cardHead}>
          {title ? <Text style={[styles.label, { color: t.textFaint }]}>{title}</Text> : <View />}
          {right}
        </View>
      )}
      {children}
    </View>
  );
}

/** Label + big value + unit (+ caption). `value` null → the absent state. */
export function Tile({
  label,
  value,
  unit,
  caption,
  warn,
  style,
  size = 46,
}: {
  label: string;
  value: string | null;
  unit?: string;
  caption?: string;
  warn?: boolean;
  style?: ViewStyle;
  size?: number;
}) {
  const t = useTheme();
  const absent = value == null;
  return (
    <View style={[styles.card, styles.tile, { borderColor: warn ? t.warn : t.panelBorder, backgroundColor: t.panel }, style]}>
      <Text style={[styles.label, { color: absent ? t.absent : t.textFaint }]}>{label}</Text>
      <Text style={[styles.value, { fontSize: size, lineHeight: size * 1.12, color: absent ? t.absent : warn ? t.warn : t.text }]}>
        {absent ? '—' : value}
        {!absent && unit ? <Text style={[styles.unit, { color: t.textDim, fontSize: Math.max(16, size * 0.4) }]}> {unit}</Text> : null}
      </Text>
      {caption ? <Text style={[styles.caption, { color: absent ? t.absent : t.textFaint }]}>{caption}</Text> : null}
    </View>
  );
}

/** 0..100 % horizontal bar with its label and numeral. */
export function PctBar({ label, pct }: { label: string; pct: number | null }) {
  const t = useTheme();
  const absent = pct == null;
  const w = absent ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <View style={styles.barRow}>
      <View style={styles.barHead}>
        <Text style={[styles.label, { color: absent ? t.absent : t.textFaint }]}>{label}</Text>
        <Text style={[styles.barValue, { color: absent ? t.absent : t.text }]}>{absent ? '—' : `${Math.round(w)}%`}</Text>
      </View>
      <View style={[styles.track, { backgroundColor: t.hairline }]}>
        <View style={[styles.fill, { width: `${w}%`, backgroundColor: t.accent }]} />
      </View>
    </View>
  );
}

export const TRIM_WARN = 10; // % — beyond this a trim is worth a look
const TRIM_SPAN = 25; // ± % across the bar

/** Centred ± bar for a fuel trim: fill grows left (rich) or right (lean) from zero. */
export function TrimBar({ label, pct }: { label: string; pct: number | null }) {
  const t = useTheme();
  const absent = pct == null;
  const v = absent ? 0 : Math.max(-TRIM_SPAN, Math.min(TRIM_SPAN, pct));
  const warn = !absent && Math.abs(pct) > TRIM_WARN;
  const half = (Math.abs(v) / TRIM_SPAN) * 50;
  const color = warn ? t.warn : t.accent;
  return (
    <View style={[styles.card, styles.tile, { borderColor: warn ? t.warn : t.panelBorder, backgroundColor: t.panel }]}>
      <View style={styles.barHead}>
        <Text style={[styles.label, { color: absent ? t.absent : t.textFaint }]}>{label}</Text>
        <Text style={[styles.trimValue, { color: absent ? t.absent : warn ? t.warn : t.text }]}>
          {absent ? '—' : `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`}
        </Text>
      </View>
      <View style={[styles.trimTrack, { backgroundColor: t.hairline }]}>
        <View style={[styles.trimFill, { backgroundColor: color, width: `${half}%`, left: v >= 0 ? '50%' : `${50 - half}%` }]} />
        <View style={[styles.trimZero, { backgroundColor: t.textDim }]} />
        {[-TRIM_WARN, TRIM_WARN].map((w) => (
          <View key={w} style={[styles.trimTick, { left: `${50 + (w / TRIM_SPAN) * 50}%`, backgroundColor: t.textFaint }]} />
        ))}
      </View>
      <View style={styles.trimLegend}>
        <Text style={[styles.caption, { color: t.textFaint }]}>RICH</Text>
        <Text style={[styles.caption, { color: t.textFaint }]}>LEAN</Text>
      </View>
    </View>
  );
}

export const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 8, padding: 18 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  tile: { flex: 1, justifyContent: 'space-between' },
  label: { fontFamily: 'JetBrains Mono', fontSize: 17, letterSpacing: 3 },
  value: { fontFamily: 'Oxanium', fontWeight: '700' },
  unit: { fontFamily: 'Oxanium', fontWeight: '600' },
  caption: { fontFamily: 'JetBrains Mono', fontSize: 15, letterSpacing: 2 },
  barRow: { gap: 8 },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  barValue: { fontFamily: 'Oxanium', fontSize: 30, fontWeight: '700' },
  track: { height: 14, borderRadius: 7, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 7 },
  trimValue: { fontFamily: 'Oxanium', fontSize: 34, fontWeight: '700' },
  trimTrack: { height: 16, borderRadius: 8, marginTop: 10 },
  trimFill: { position: 'absolute', top: 0, bottom: 0, borderRadius: 8 },
  trimZero: { position: 'absolute', left: '50%', top: -6, bottom: -6, width: 2, marginLeft: -1 },
  trimTick: { position: 'absolute', top: -3, bottom: -3, width: 1, opacity: 0.6 },
  trimLegend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
});
