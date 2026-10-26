import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, Polygon, Rect } from 'react-native-svg';
import { shallowEqual, useTelemetry } from '../data/DataSourceProvider';
import { useTheme } from '../theme/ThemeProvider';
import { polar } from '../lib/pulse';
import type { Theme } from '../theme/themes';

/**
 * Live attitude / inclinometer (the off-road gyro view, design-brief §4.9). The
 * horizon tilts with roll and shifts with pitch; a lateral-g bubble shows cornering
 * load. It animates straight off the live sensor stream — the data source ticks
 * ~30fps and pitch/roll are low-pass filtered (src/lib/imu.ts), so the motion is
 * smooth without any animation library (GPU-light for the Snapdragon 665).
 *
 * Degrades gracefully: with no sensors it sits level and dims, never an empty gauge.
 */
const SIZE = 300;
const CX = 150;
const CY = 150;
const R = 120;
const PX_PER_DEG = 4; // ±30° fills the disc

const q = (v: number, step: number) => Math.round(v / step) * step;

/** Selector shared by every attitude readout: quantized so parked noise can't churn. */
export function useAttitude() {
  return useTelemetry((d) => {
    const hasPR =
      (d.motion.pitchDeg.status !== 'absent' && d.motion.pitchDeg.value != null) ||
      (d.motion.rollDeg.status !== 'absent' && d.motion.rollDeg.value != null);
    return {
      live: hasPR,
      pitch: q(d.motion.pitchDeg.value ?? 0, 0.25),
      roll: q(d.motion.rollDeg.value ?? 0, 0.25),
      latG: q(d.motion.latG.value ?? 0, 0.01),
    };
  }, shallowEqual);
}

export const GyroCard = React.memo(function GyroCard() {
  const t = useTheme();
  // quantize to sub-visual steps so the low-pass sensor noise while parked can't
  // wake this every tick; driving motion crosses the steps and animates normally.
  const { live, pitch, roll, latG } = useAttitude();
  const accent = live ? t.accent : t.absent;

  return (
    <View style={[styles.card, { borderColor: t.panelBorder, backgroundColor: t.panel }]}>
      <Text allowFontScaling={false} style={[styles.title, { color: t.textFaint }]}>ATTITUDE</Text>

      <AttitudeDisc size={SIZE} pitch={pitch} roll={roll} live={live} t={t} />

      {/* readouts */}
      <View style={styles.readouts}>
        <Readout t={t} label="PITCH" value={live ? `${signed(pitch)}°` : '—'} />
        <Readout t={t} label="ROLL" value={live ? `${signed(roll)}°` : '—'} />
      </View>

      {/* lateral-g slip bubble */}
      <Text allowFontScaling={false} style={[styles.gLabel, { color: t.textFaint }]}>LATERAL G</Text>
      <SlipBall width={SIZE} latG={latG} accent={accent} t={t} />
    </View>
  );
});

/**
 * The attitude disc itself — drawn in a fixed 300-unit viewBox and scaled to `size`,
 * so the GyroCard (300 px) and the Trail face hero (2×) share one geometry.
 */
export function AttitudeDisc({
  size,
  pitch,
  roll,
  live,
  t,
}: {
  size: number;
  pitch: number;
  roll: number;
  live: boolean;
  t: Theme;
}) {
  const horizonY = CY + clamp(pitch, -30, 30) * PX_PER_DEG;
  const accent = live ? t.accent : t.absent;
  const clipId = `disc-${size}`; // unique per size: web resolves url(#id) document-wide
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${SIZE} ${SIZE}`}>
      <Defs>
        <ClipPath id={clipId}>
          <Circle cx={CX} cy={CY} r={R} />
        </ClipPath>
      </Defs>

      {/* rotating horizon (roll) + shifting horizon (pitch), clipped to the disc */}
      <G clipPath={`url(#${clipId})`}>
        <Rect x={CX - R} y={CY - R} width={2 * R} height={2 * R} fill={t.bg} />
        {/* horizon counter-rotates against vehicle bank (fixed-reference attitude
            indicator): roll + = right-side-down → world tilts so its right rises.
            SVG rotation is CW-positive (y-down), so negate. Matches CompassCard. */}
        <G rotation={-roll} originX={CX} originY={CY}>
          {/* ground */}
          <Rect x={-200} y={horizonY} width={700} height={500} fill={accent} opacity={0.12} />
          {/* horizon line */}
          <Line x1={-200} y1={horizonY} x2={500} y2={horizonY} stroke={accent} strokeWidth={2.5} />
          {/* pitch ladder */}
          {[10, 20].map((d) => (
            <G key={d}>
              <Line x1={CX - (d === 10 ? 22 : 36)} y1={horizonY - d * PX_PER_DEG} x2={CX + (d === 10 ? 22 : 36)} y2={horizonY - d * PX_PER_DEG} stroke={accent} strokeWidth={1.5} opacity={0.5} />
              <Line x1={CX - (d === 10 ? 22 : 36)} y1={horizonY + d * PX_PER_DEG} x2={CX + (d === 10 ? 22 : 36)} y2={horizonY + d * PX_PER_DEG} stroke={accent} strokeWidth={1.5} opacity={0.5} />
            </G>
          ))}
        </G>
      </G>

      {/* bezel */}
      <Circle cx={CX} cy={CY} r={R} fill="none" stroke={t.panelBorder} strokeWidth={1.5} />

      {/* fixed bank scale */}
      {BANK_TICKS.map((tk, i) => (
        <Line key={i} x1={tk.x} y1={tk.y} x2={tk.x2} y2={tk.y2} stroke={t.textFaint} strokeWidth={tk.major ? 2.5 : 1.5} />
      ))}
      {/* fixed sky pointer at top */}
      <Polygon points={`${CX},${CY - R + 4} ${CX - 9},${CY - R + 20} ${CX + 9},${CY - R + 20}`} fill={accent} />

      {/* fixed vehicle reference (wings + center) */}
      <Line x1={CX - 46} y1={CY} x2={CX - 16} y2={CY} stroke={t.warn} strokeWidth={3} />
      <Line x1={CX + 16} y1={CY} x2={CX + 46} y2={CY} stroke={t.warn} strokeWidth={3} />
      <Circle cx={CX} cy={CY} r={4} fill={t.warn} />
    </Svg>
  );
}

/** Lateral-g slip ball (+ = cornering right), drawn at `width` px. */
export function SlipBall({ width, latG, accent, t }: { width: number; latG: number; accent: string; t: Theme }) {
  const cx = width / 2;
  const half = width * 0.32;
  const ballX = cx + clamp(latG, -1, 1) * half;
  return (
    <Svg width={width} height={26} viewBox={`0 0 ${width} 26`}>
      <Line x1={cx - half} y1={13} x2={cx + half} y2={13} stroke={t.panelBorder} strokeWidth={2} />
      <Line x1={cx} y1={4} x2={cx} y2={22} stroke={t.textFaint} strokeWidth={1.5} />
      <Line x1={cx - half} y1={6} x2={cx - half} y2={20} stroke={t.textFaint} strokeWidth={1.5} />
      <Line x1={cx + half} y1={6} x2={cx + half} y2={20} stroke={t.textFaint} strokeWidth={1.5} />
      <Circle cx={ballX} cy={13} r={8} fill={accent} />
    </Svg>
  );
}

// bank scale ticks around the top of the bezel (fixed); top = 270° in polar convention
const BANK_TICKS = [-60, -45, -30, -15, 0, 15, 30, 45, 60].map((d) => {
  const major = d % 30 === 0;
  const a = 270 + d;
  const outer = polar(CX, CY, R, a);
  const inner = polar(CX, CY, R - (major ? 16 : 9), a);
  return { ...inner, x2: outer.x, y2: outer.y, major };
});

function Readout({ t, label, value }: { t: Theme; label: string; value: string }) {
  return (
    <View style={styles.readout}>
      <Text allowFontScaling={false} style={[styles.rLabel, { color: t.textFaint }]}>{label}</Text>
      <Text allowFontScaling={false} style={[styles.rValue, { color: t.text }]}>{value}</Text>
    </View>
  );
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const signed = (v: number) => (v >= 0 ? '+' : '−') + Math.abs(Math.round(v));

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 8, padding: 16, alignItems: 'center' },
  title: { fontFamily: 'JetBrains Mono', fontSize: 17, letterSpacing: 4, alignSelf: 'flex-start', marginBottom: 6 },
  readouts: { flexDirection: 'row', justifyContent: 'space-around', width: '100%', marginTop: 4 },
  readout: { alignItems: 'center' },
  rLabel: { fontFamily: 'JetBrains Mono', fontSize: 15, letterSpacing: 2 },
  rValue: { fontFamily: 'Oxanium', fontSize: 34, fontWeight: '700' },
  gLabel: { fontFamily: 'JetBrains Mono', fontSize: 15, letterSpacing: 2, alignSelf: 'flex-start', marginTop: 10 },
});
