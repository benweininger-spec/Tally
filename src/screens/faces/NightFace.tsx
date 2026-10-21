import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { shallowEqual, useTelemetry } from '../../data/DataSourceProvider';
import { ThemeOverride, useTheme } from '../../theme/ThemeProvider';
import { amberNightDim } from '../../theme/themes';
import { STAGE_H, STAGE_W } from '../../components/Stage';
import { clamp, gaugeProgress, gaugeTrack } from '../../lib/pulse';
import { clockTime } from '../../lib/format';

const SPEED_FULL = 80;
const CX = STAGE_W / 2;
const CY = 520;
const R = 420;
const TRACK = gaugeTrack(CX, CY, R);

/**
 * NIGHT — the dark-cab face: ground speed, a hairline speed ring, the clock, nothing
 * else. Always the night palette at ~40% luminance (`amberNightDim`), whatever the
 * day/night theme says, and it paints its own full-stage background so it reads the
 * same over the light day theme. HomeScreen hides the header + ambient glow and dims
 * the shared dock while this face is active.
 */
export const NightFace = React.memo(function NightFace() {
  return (
    <ThemeOverride theme={amberNightDim}>
      <NightBody />
    </ThemeOverride>
  );
});

function NightBody() {
  const t = useTheme();
  const { speed, frac, live } = useTelemetry((d) => {
    const s = d.motion.speedMph;
    const v = s.value ?? 0;
    return {
      live: s.status !== 'absent' && s.value != null,
      speed: Math.round(v),
      frac: Math.round(clamp(v / SPEED_FULL, 0, 1) * 300) / 300, // sub-pixel ring steps only
    };
  }, shallowEqual);
  const { time, ampm } = useTelemetry((d) => clockTime(d.system.now), shallowEqual);
  const progress = live ? gaugeProgress(CX, CY, R, frac) : null;

  return (
    // the face layer is full-stage (top -92 inside the pager viewport), so 0,0 = stage origin
    <View style={[StyleSheet.absoluteFill, { backgroundColor: t.bg }]}>
      <Svg style={StyleSheet.absoluteFill} width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}>
        <Path d={TRACK} stroke={t.hairline} strokeWidth={2} fill="none" strokeLinecap="round" />
        {progress && <Path d={progress} stroke={t.accent} strokeWidth={3} fill="none" strokeLinecap="round" />}
      </Svg>

      <View style={styles.center} pointerEvents="none">
        <Text style={[styles.speed, { color: live ? t.accent : t.absent }]}>{live ? speed : '—'}</Text>
        <Text style={[styles.unit, { color: t.textFaint }]}>MPH</Text>
      </View>

      {/* clock sits in the open bottom of the ring */}
      <View style={styles.clockWrap} pointerEvents="none">
        <Text style={[styles.clock, { color: t.textDim }]}>
          {time}
          <Text style={[styles.ampm, { color: t.textFaint }]}> {ampm}</Text>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { position: 'absolute', left: 0, right: 0, top: CY - 250, alignItems: 'center' },
  speed: { fontFamily: 'Oxanium', fontSize: 400, fontWeight: '700', lineHeight: 430 },
  unit: { fontFamily: 'JetBrains Mono', fontSize: 22, letterSpacing: 8, marginTop: -8 },
  clockWrap: { position: 'absolute', left: 0, right: 0, top: CY + R * 0.74, alignItems: 'center' },
  clock: { fontFamily: 'Oxanium', fontSize: 64, fontWeight: '600', letterSpacing: 2 },
  ampm: { fontFamily: 'JetBrains Mono', fontSize: 22, letterSpacing: 3 },
});
