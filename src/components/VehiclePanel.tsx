import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { shallowEqual, useTelemetry } from '../data/DataSourceProvider';
import { useTheme } from '../theme/ThemeProvider';
import { has, type Signal } from '../data/types';

interface Stat {
  value: string;
  unit?: string;
  label: string;
}

/** value rounded to `step` (for change-detection at display precision), or null if absent. */
const hv = (s: Signal<number>, step = 1): number | null =>
  has(s) ? Math.round(s.value / step) * step : null;

/**
 * Reads as a complete, intentional panel WITHOUT an OBD dongle (design-brief §2:
 * "no empty gauges"). Tier-A data (voltage, trip, avg, altitude) fills it today;
 * when the dongle connects, the richer engine metrics replace the GPS-derived
 * ones. No "— AWAIT OBD" dashes, ever.
 */
export const VehiclePanel = React.memo(function VehiclePanel() {
  const t = useTheme();
  const d = useTelemetry(
    (s) => ({
      connected: s.obd.connected,
      voltage: hv(s.system.voltage, 0.1),
      coolant: hv(s.obd.coolantTempF),
      fuel: hv(s.obd.fuelLevelPct),
      mpg: hv(s.obd.instantMpg),
      dist: hv(s.trip.distanceMi, 0.1),
      avg: hv(s.trip.avgSpeedMph),
      alt: hv(s.motion.altitudeFt),
    }),
    shallowEqual
  );

  const stats: Stat[] = [];
  stats.push({ value: d.voltage == null ? '—' : d.voltage.toFixed(1), unit: 'V', label: 'SYSTEM · LIVE' });

  if (d.connected) {
    if (d.coolant != null) stats.push({ value: `${d.coolant}`, unit: '°F', label: 'COOLANT' });
    if (d.fuel != null) stats.push({ value: `${d.fuel}`, unit: '%', label: 'FUEL' });
    if (d.mpg != null) stats.push({ value: `${d.mpg}`, unit: 'mpg', label: 'INSTANT' });
  } else {
    if (d.dist != null) stats.push({ value: d.dist.toFixed(1), unit: 'mi', label: 'TRIP' });
    if (d.avg != null) stats.push({ value: `${d.avg}`, unit: 'mph', label: 'AVG' });
    if (d.alt != null) stats.push({ value: d.alt.toLocaleString(), unit: 'ft', label: 'ALT' });
  }

  const connected = d.connected;
  return (
    <View style={[styles.card, { borderColor: t.panelBorder, backgroundColor: t.panel }]}>
      <Text style={[styles.title, { color: t.textFaint }]}>VEHICLE</Text>
      <View style={styles.grid}>
        {stats.map((s, i) => (
          <View key={i} style={styles.cell}>
            <Text style={[styles.value, { color: t.accent }]}>
              {s.value}
              {s.unit ? <Text style={{ fontSize: 18, color: t.textDim }}> {s.unit}</Text> : null}
            </Text>
            <Text style={[styles.label, { color: t.textFaint }]}>{s.label}</Text>
          </View>
        ))}
      </View>
      <Text style={[styles.footer, { color: connected ? t.textDim : t.textFaint }]}>
        {connected ? 'OBD2 · LIVE' : 'OBD2 · DONGLE AWAITING — GPS + SENSORS ACTIVE'}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 8, padding: 24 },
  title: { fontFamily: 'JetBrains Mono', fontSize: 14, letterSpacing: 4, marginBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '50%', marginBottom: 18 },
  value: { fontFamily: 'Oxanium', fontSize: 38, fontWeight: '700' },
  label: { fontFamily: 'JetBrains Mono', fontSize: 12, letterSpacing: 2 },
  footer: { fontFamily: 'JetBrains Mono', fontSize: 12, letterSpacing: 2, marginTop: 4 },
});
