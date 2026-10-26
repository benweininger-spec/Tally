import React, { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line } from 'react-native-svg';
import { shallowEqual, useTelemetry } from '../data/DataSourceProvider';
import { useTheme } from '../theme/ThemeProvider';
import { cardinal } from '../lib/format';

/** `compact` = HOME's half-width slot beside the fuel card: smaller dial, short caption. */
export const CompassCard = React.memo(function CompassCard({ compact = false }: { compact?: boolean }) {
  const t = useTheme();
  // heading is only valid while moving — expo-location returns -1 when stopped, so
  // the signal decays to stale/absent. HOLD the last real heading (dimmed) instead
  // of snapping to a confident, wrong 0°/N. Quantize to 1° so idle noise can't churn.
  const sel = useTelemetry(
    (d) => ({
      v: d.motion.headingDeg.value == null ? null : Math.round(d.motion.headingDeg.value),
      live: d.motion.headingDeg.status === 'live' && d.motion.headingDeg.value != null,
    }),
    shallowEqual
  );
  const lastRef = useRef(0);
  if (sel.live && sel.v != null) lastRef.current = sel.v;
  const hdg = sel.live && sel.v != null ? sel.v : lastRef.current;
  const dim = !sel.live;
  const needle = dim ? t.textDim : t.accent;

  return (
    <View style={[styles.card, compact && styles.compact, { borderColor: t.panelBorder, backgroundColor: t.panel }]}>
      <Svg width={compact ? 84 : 118} height={compact ? 84 : 118} viewBox="0 0 120 120" style={{ flexShrink: 0 }}>
        <Circle cx={60} cy={60} r={54} fill="none" stroke={t.panelBorder} strokeWidth={1.5} />
        <G originX={60} originY={60} rotation={-hdg}>
          <Line x1={60} y1={10} x2={60} y2={26} stroke={needle} strokeWidth={3} />
        </G>
        <Circle cx={60} cy={60} r={3} fill={needle} />
      </Svg>
      <View style={{ flexShrink: 1 }}>
        <Text allowFontScaling={false} style={[styles.label, { color: t.textFaint }]}>HEADING</Text>
        <Text allowFontScaling={false} style={[styles.value, compact && { fontSize: 46, lineHeight: 50 }, { color: dim ? t.textDim : t.text }]}>
          {hdg}°<Text allowFontScaling={false} style={{ fontSize: compact ? 26 : 30, color: t.textDim }}> {cardinal(hdg)}</Text>
        </Text>
        <Text allowFontScaling={false} style={[styles.sub, { color: t.absent }]} numberOfLines={1}>
          {compact ? (dim ? 'HOLD · TAP TO ROUTE' : 'TAP TO ROUTE') : dim ? 'HEADING HOLD · TAP TO ROUTE' : 'NAV IDLE · TAP TO ROUTE'}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  compact: { flex: 1, padding: 20, gap: 16 },
  label: { fontFamily: 'JetBrains Mono', fontSize: 17, letterSpacing: 4 },
  value: { fontFamily: 'Oxanium', fontSize: 54, fontWeight: '700', lineHeight: 56 },
  sub: { fontFamily: 'JetBrains Mono', fontSize: 17, marginTop: 8 },
});
