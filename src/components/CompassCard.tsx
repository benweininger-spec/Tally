import React, { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line } from 'react-native-svg';
import { shallowEqual, useTelemetry } from '../data/DataSourceProvider';
import { useTheme } from '../theme/ThemeProvider';
import { cardinal } from '../lib/format';

export const CompassCard = React.memo(function CompassCard() {
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
    <View style={[styles.card, { borderColor: t.panelBorder, backgroundColor: t.panel }]}>
      <Svg width={118} height={118} viewBox="0 0 120 120">
        <Circle cx={60} cy={60} r={54} fill="none" stroke={t.panelBorder} strokeWidth={1.5} />
        <G originX={60} originY={60} rotation={-hdg}>
          <Line x1={60} y1={10} x2={60} y2={26} stroke={needle} strokeWidth={3} />
        </G>
        <Circle cx={60} cy={60} r={3} fill={needle} />
      </Svg>
      <View>
        <Text style={[styles.label, { color: t.textFaint }]}>HEADING</Text>
        <Text style={[styles.value, { color: dim ? t.textDim : t.text }]}>
          {hdg}°<Text style={{ fontSize: 30, color: t.textDim }}> {cardinal(hdg)}</Text>
        </Text>
        <Text style={[styles.sub, { color: t.absent }]}>
          {dim ? 'HEADING HOLD · TAP TO ROUTE' : 'NAV IDLE · TAP TO ROUTE'}
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
  label: { fontFamily: 'JetBrains Mono', fontSize: 14, letterSpacing: 4 },
  value: { fontFamily: 'Oxanium', fontSize: 54, fontWeight: '700', lineHeight: 56 },
  sub: { fontFamily: 'JetBrains Mono', fontSize: 14, marginTop: 8 },
});
