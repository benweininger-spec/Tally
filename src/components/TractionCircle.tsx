/**
 * Traction circle (g-g diagram) — the friction dot. Longitudinal g on the vertical
 * axis (accel up / brake down), lateral g on the horizontal (right +), a live dot
 * showing the combined grip vector plus a fading trail of the last ~1s. Concentric
 * 0.2 / 0.4 / 0.6 g rings read "how hard am I driving" in <1s. Pure Tier-A: it runs
 * off the same IMU (src/lib/imu.ts) the gyro card uses — no new hardware, no OBD.
 *
 * Perf: memoized + selector-subscribed like every widget, and it wakes only when the
 * quantized g values change, so parked it costs nothing.
 */
import React, { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';
import { shallowEqual, useTelemetry } from '../data/DataSourceProvider';
import { useTheme } from '../theme/ThemeProvider';

const SIZE = 300;
const CX = 150;
const CY = 150;
const R = 118;
const G_FULL = 0.8; // g at the outer ring
const RINGS = [0.2, 0.4, 0.6];
const TRAIL = 22;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export const TractionCircle = React.memo(function TractionCircle() {
  const t = useTheme();
  const { longG, latG, live } = useTelemetry(
    (d) => ({
      longG: Math.round((d.motion.longG.value ?? 0) * 100) / 100,
      latG: Math.round((d.motion.latG.value ?? 0) * 100) / 100,
      live: d.motion.longG.status !== 'absent' || d.motion.latG.status !== 'absent',
    }),
    shallowEqual
  );

  const accent = live ? t.accent : t.absent;
  const dotX = CX + clamp(latG / G_FULL, -1.12, 1.12) * R;
  const dotY = CY + clamp(-longG / G_FULL, -1.12, 1.12) * R;
  const mag = Math.min(G_FULL * 1.12, Math.hypot(latG, longG));

  // local trail buffer — pushes on each change (component only wakes when g moves)
  const trail = useRef<{ x: number; y: number }[]>([]).current;
  trail.push({ x: dotX, y: dotY });
  if (trail.length > TRAIL) trail.shift();

  return (
    <View style={[styles.card, { borderColor: t.panelBorder, backgroundColor: t.panel }]}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: t.textFaint }]}>TRACTION</Text>
        <Text style={[styles.g, { color: accent }]}>{mag > 0.03 ? `${mag.toFixed(2)} g` : '—'}</Text>
      </View>

      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* grip rings */}
        {RINGS.map((g) => (
          <Circle key={g} cx={CX} cy={CY} r={(g / G_FULL) * R} fill="none" stroke={t.panelBorder} strokeWidth={1} opacity={0.5} />
        ))}
        <Circle cx={CX} cy={CY} r={R} fill="none" stroke={t.hairline} strokeWidth={1.5} />

        {/* crosshair */}
        <Line x1={CX - R} y1={CY} x2={CX + R} y2={CY} stroke={t.panelBorder} strokeWidth={1} opacity={0.4} />
        <Line x1={CX} y1={CY - R} x2={CX} y2={CY + R} stroke={t.panelBorder} strokeWidth={1} opacity={0.4} />

        {/* axis captions */}
        <SvgText x={CX} y={22} fill={t.textFaint} fontSize={12} fontFamily={t.fontMono} textAnchor="middle" letterSpacing={2}>
          ACCEL
        </SvgText>
        <SvgText x={CX} y={SIZE - 12} fill={t.textFaint} fontSize={12} fontFamily={t.fontMono} textAnchor="middle" letterSpacing={2}>
          BRAKE
        </SvgText>

        {/* fading trail */}
        {trail.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={2.5} fill={accent} opacity={(i / TRAIL) * 0.5} />
        ))}

        {/* live grip dot */}
        <Circle cx={dotX} cy={dotY} r={13} fill={accent} opacity={0.16} />
        <Circle cx={dotX} cy={dotY} r={6.5} fill={accent} />
      </Svg>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 8, padding: 16, alignItems: 'center' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', width: '100%', marginBottom: 4 },
  title: { fontFamily: 'JetBrains Mono', fontSize: 14, letterSpacing: 4 },
  g: { fontFamily: 'Oxanium', fontSize: 22, fontWeight: '700' },
});
