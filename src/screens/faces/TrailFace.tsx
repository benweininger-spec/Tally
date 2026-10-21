import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { shallowEqual, useTelemetry } from '../../data/DataSourceProvider';
import { useTheme } from '../../theme/ThemeProvider';
import { has } from '../../data/types';
import { AttitudeDisc, SlipBall, signed, useAttitude } from '../../components/GyroCard';
import { CompassCard } from '../../components/CompassCard';
import { AltitudeRibbon } from '../../components/AltitudeRibbon';
import type { Theme } from '../../theme/themes';

/** Angles past these read in the warn color (off-camber / steep-grade caution). */
const PITCH_CAUTION = 30;
const ROLL_CAUTION = 25;

const BAND_TOP = 756;
const BAND_W = 1904;
const BAND_H = 234;

/**
 * TRAIL — the off-road face. Hero is the inclinometer (GyroCard's attitude math at
 * 2×) with big pitch / roll numerals, heading, ground speed and lateral load, over a
 * full-width altitude profile + grade ribbon. The dock stays (shared). Stage
 * coordinates; content between header (92) and dock (1018).
 */
export const TrailFace = React.memo(function TrailFace() {
  return (
    <>
      <View style={{ position: 'absolute', left: 110, top: 118 }}>
        <TrailDisc />
      </View>

      <View style={{ position: 'absolute', left: 780, top: 124, width: 1172, gap: 22 }}>
        <View style={styles.row}>
          <AngleCard axis="pitch" />
          <AngleCard axis="roll" />
        </View>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <CompassCard />
          </View>
          <SpeedCard />
        </View>
        <LateralCard />
      </View>

      <View style={{ position: 'absolute', left: 48, top: BAND_TOP }}>
        <RibbonBand />
      </View>
    </>
  );
});

const TrailDisc = React.memo(function TrailDisc() {
  const t = useTheme();
  const { live, pitch, roll } = useAttitude();
  return <AttitudeDisc size={600} pitch={pitch} roll={roll} live={live} t={t} />;
});

function RibbonBand() {
  const t = useTheme();
  return (
    <Card t={t} style={{ width: BAND_W, height: BAND_H }}>
      <AltitudeRibbon width={BAND_W - 50} height={BAND_H - 50} />
    </Card>
  );
}

const AngleCard = React.memo(function AngleCard({ axis }: { axis: 'pitch' | 'roll' }) {
  const t = useTheme();
  // this axis only (0.25° steps, like the gyro card) so pitch doesn't wake on roll
  const a = useTelemetry((d) => {
    const s = axis === 'pitch' ? d.motion.pitchDeg : d.motion.rollDeg;
    return { live: s.status !== 'absent' && s.value != null, v: Math.round((s.value ?? 0) * 4) / 4 };
  }, shallowEqual);
  const v = a.v;
  const caution = a.live && Math.abs(v) >= (axis === 'pitch' ? PITCH_CAUTION : ROLL_CAUTION);
  const r = Math.round(v);
  const caption = !a.live
    ? 'NO SENSOR'
    : r === 0
      ? 'LEVEL'
      : axis === 'pitch'
        ? r > 0 ? 'NOSE UP' : 'NOSE DOWN'
        : r > 0 ? 'RIGHT SIDE DOWN' : 'LEFT SIDE DOWN';
  return (
    <Card t={t} style={{ flex: 1, height: 262 }} borderColor={caution ? t.warn : undefined}>
      <Text style={[styles.label, { color: t.textFaint }]}>{axis.toUpperCase()}</Text>
      <Text style={[styles.angle, { color: !a.live ? t.absent : caution ? t.warn : t.accent }]}>
        {a.live ? `${signed(v)}°` : '—'}
      </Text>
      <Text style={[styles.caption, { color: caution ? t.warn : t.textDim }]}>{caption}</Text>
    </Card>
  );
});

/** Ground speed — every face carries the safety glance. */
const SpeedCard = React.memo(function SpeedCard() {
  const t = useTheme();
  const mph = useTelemetry((d) => (has(d.motion.speedMph) ? Math.round(d.motion.speedMph.value) : null));
  return (
    <Card t={t} style={{ flex: 1, justifyContent: 'center' }}>
      <Text style={[styles.label, { color: t.textFaint }]}>GROUND SPEED</Text>
      <Text style={[styles.value, { color: mph == null ? t.absent : t.accent }]}>
        {mph == null ? '—' : mph}
        <Text style={{ fontSize: 26, color: t.textDim }}> mph</Text>
      </Text>
    </Card>
  );
});

const LateralCard = React.memo(function LateralCard() {
  const t = useTheme();
  const { live, latG } = useAttitude();
  return (
    <Card t={t} style={{ paddingVertical: 18 }}>
      <View style={styles.latHead}>
        <Text style={[styles.label, { color: t.textFaint }]}>LATERAL G</Text>
        <Text style={[styles.latValue, { color: live ? t.text : t.absent }]}>
          {live ? `${latG >= 0 ? '+' : '−'}${Math.abs(latG).toFixed(2)} g` : '—'}
        </Text>
      </View>
      <SlipBall width={1120} latG={latG} accent={live ? t.accent : t.absent} t={t} />
    </Card>
  );
});

function Card({
  t,
  style,
  borderColor,
  children,
}: {
  t: Theme;
  style?: object;
  borderColor?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.card, { borderColor: borderColor ?? t.panelBorder, backgroundColor: t.panel }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 24 },
  card: { borderWidth: 1, borderRadius: 8, padding: 24 },
  label: { fontFamily: 'JetBrains Mono', fontSize: 14, letterSpacing: 4 },
  angle: { fontFamily: 'Oxanium', fontSize: 128, fontWeight: '700', lineHeight: 146, marginTop: 4 },
  caption: { fontFamily: 'JetBrains Mono', fontSize: 16, letterSpacing: 3 },
  value: { fontFamily: 'Oxanium', fontSize: 54, fontWeight: '700', lineHeight: 60, marginTop: 8 },
  latHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  latValue: { fontFamily: 'Oxanium', fontSize: 30, fontWeight: '700' },
});
