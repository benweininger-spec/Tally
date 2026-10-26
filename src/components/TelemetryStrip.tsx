import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { shallowEqual, useTelemetry } from '../data/DataSourceProvider';
import { useTheme } from '../theme/ThemeProvider';
import { has } from '../data/types';
import { AltitudeRibbon } from './AltitudeRibbon';

export const STRIP_W = 720;
const GAP = 16;
const ANGLE_W = 150;
const PAD_X = 16;
const RIBBON_OUTER = STRIP_W - 2 * ANGLE_W - 2 * GAP;

/**
 * Telemetry strip beneath the signature: altitude profile + grade (compact ribbon),
 * then pitch / roll. Longitudinal / lateral g live in the traction circle now.
 */
export const TelemetryStrip = React.memo(function TelemetryStrip() {
  const t = useTheme();
  const { pitch, roll } = useTelemetry((d) => {
    const m = d.motion;
    return {
      pitch: has(m.pitchDeg) ? `${signedInt(m.pitchDeg.value)}°` : '—',
      roll: has(m.rollDeg) ? `${signedInt(m.rollDeg.value)}°` : '—',
    };
  }, shallowEqual);
  const cell = [styles.cell, { borderColor: t.panelBorder, backgroundColor: t.panel }];
  return (
    <View style={styles.strip}>
      <View style={[cell, { width: RIBBON_OUTER, paddingVertical: 10 }]}>
        <AltitudeRibbon compact width={RIBBON_OUTER - 2 * PAD_X - 2} height={56} />
      </View>
      {(
        [
          ['PITCH', pitch],
          ['ROLL', roll],
        ] as const
      ).map(([label, value]) => (
        <View key={label} style={[cell, { width: ANGLE_W }]}>
          <Text style={[styles.cellLabel, { color: t.textFaint }]}>{label}</Text>
          <Text style={[styles.cellValue, { color: t.text }]}>{value}</Text>
        </View>
      ))}
    </View>
  );
});

const signedInt = (v: number) => (v >= 0 ? '+' : '−') + Math.abs(v);

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', gap: GAP, width: STRIP_W },
  cell: { borderWidth: 1, borderRadius: 6, paddingVertical: 12, paddingHorizontal: PAD_X, justifyContent: 'center' },
  cellLabel: { fontFamily: 'JetBrains Mono', fontSize: 16, letterSpacing: 2 },
  cellValue: { fontFamily: 'Oxanium', fontSize: 30, fontWeight: '600', marginTop: 2 },
});
