import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stage } from '../components/Stage';
import { Header } from '../components/Header';
import { PulseTach } from '../components/signature/PulseTach';
import { MediaWidget } from '../components/MediaWidget';
import { CompassCard } from '../components/CompassCard';
import { VehiclePanel } from '../components/VehiclePanel';
import { GyroCard } from '../components/GyroCard';
import { TractionCircle } from '../components/TractionCircle';
import { ReactiveBackground } from '../components/ReactiveBackground';
import { Dock } from '../components/Dock';
import { shallowEqual, useTelemetry } from '../data/DataSourceProvider';
import { useTheme } from '../theme/ThemeProvider';
import { has } from '../data/types';
import { signed } from '../lib/format';

/**
 * The clean-hybrid home face. Single default surface the launcher always returns
 * to. Hero = the pulse-tach signature, center-left. Right rail = media / nav /
 * vehicle. Full-width dock. Designed at 2000x1200 landscape.
 */
export function HomeScreen() {
  return (
    <Stage>
      {/* backmost ambient layer — peripheral, speed/g-reactive, nothing when parked */}
      <ReactiveBackground />

      <View style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
        <Header />
      </View>

      {/* hero signature — centered in the space left of the attitude box so the
          left margin (116) equals the gap to the attitude box: (952 - 720) / 2. */}
      <View style={{ position: 'absolute', left: 116, top: 150 }}>
        <PulseTach size={720} />
      </View>

      {/* live telemetry strip beneath the signature (Tier A, glanceable) */}
      <View style={{ position: 'absolute', left: 116, top: 892, width: 720 }}>
        <TelemetryStrip />
      </View>

      {/* center column: attitude on top, traction (g-g) below — both Tier-A instruments */}
      <View style={{ position: 'absolute', left: 952, top: 124, width: 332 }}>
        <GyroCard />
      </View>
      <View style={{ position: 'absolute', left: 952, top: 606, width: 332 }}>
        <TractionCircle />
      </View>

      {/* right rail */}
      <View style={{ position: 'absolute', left: 1300, top: 124, width: 652, gap: 24 }}>
        <MediaWidget />
        <CompassCard />
        <VehiclePanel />
      </View>

      {/* dock */}
      <View style={{ position: 'absolute', left: 48, right: 48, bottom: 50 }}>
        <Dock />
      </View>
    </Stage>
  );
}

const TelemetryStrip = React.memo(function TelemetryStrip() {
  const t = useTheme();
  const items = useTelemetry((d) => {
    const m = d.motion;
    return [
      { label: 'LONG G', value: has(m.longG) ? signed(m.longG.value) : '—' },
      { label: 'LAT G', value: has(m.latG) ? signed(m.latG.value) : '—' },
      { label: 'PITCH', value: has(m.pitchDeg) ? `${signedInt(m.pitchDeg.value)}°` : '—' },
      { label: 'ROLL', value: has(m.rollDeg) ? `${signedInt(m.rollDeg.value)}°` : '—' },
    ];
  }, itemsEqual);
  return (
    <View style={styles.strip}>
      {items.map((it) => (
        <View key={it.label} style={[styles.cell, { borderColor: t.panelBorder, backgroundColor: t.panel }]}>
          <Text style={[styles.cellLabel, { color: t.textFaint }]}>{it.label}</Text>
          <Text style={[styles.cellValue, { color: t.text }]}>{it.value}</Text>
        </View>
      ))}
    </View>
  );
});

const signedInt = (v: number) => (v >= 0 ? '+' : '−') + Math.abs(v);
const itemsEqual = (a: { value: string }[], b: { value: string }[]) =>
  a.length === b.length && a.every((it, i) => it.value === b[i].value);

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', gap: 16 },
  cell: { flex: 1, borderWidth: 1, borderRadius: 6, paddingVertical: 12, paddingHorizontal: 16 },
  cellLabel: { fontFamily: 'JetBrains Mono', fontSize: 13, letterSpacing: 2 },
  cellValue: { fontFamily: 'Oxanium', fontSize: 30, fontWeight: '600', marginTop: 2 },
});
