/**
 * SET → THEME split preview: the night and day palettes side by side, each running a
 * live signature + representative readouts, with the measured WCAG contrast of its
 * accent / text on the background. For judging the day palette in real sun without
 * waiting for the clock — the owner's eye is the final test.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ThemeOverride, useTheme } from '../theme/ThemeProvider';
import { amberDay, amberNight, contrastRatio } from '../theme/themes';
import { PulseTach } from '../components/signature/PulseTach';

export function ThemePreview() {
  return (
    <View style={styles.split}>
      <ThemeOverride theme={amberNight}>
        <Sample title="NIGHT" />
      </ThemeOverride>
      <ThemeOverride theme={amberDay}>
        <Sample title="DAY" />
      </ThemeOverride>
    </View>
  );
}

function Sample({ title }: { title: string }) {
  const t = useTheme();
  const ratio = (c: string) => contrastRatio(c, t.bg).toFixed(1);
  return (
    <View style={[styles.panel, { backgroundColor: t.bg, borderColor: t.panelBorder }]}>
      <Text style={[styles.title, { color: t.textFaint }]}>{title}</Text>
      <PulseTach size={300} />
      <View style={styles.stats}>
        <Stat value="196" unit="°F" label="COOLANT" color={t.accent} />
        <Stat value="+12.4" unit="%" label="GRADE" color={t.warn} />
      </View>
      <View style={[styles.tile, { borderColor: t.panelBorder, backgroundColor: t.panel }]}>
        <Text style={[styles.tileText, { color: t.textDim }]}>WAZE</Text>
      </View>
      <Text style={[styles.ratio, { color: t.textDim }]}>
        accent {ratio(t.accent)}:1 · text {ratio(t.text)}:1 · warn {ratio(t.warn)}:1
      </Text>
    </View>
  );
}

function Stat({ value, unit, label, color }: { value: string; unit: string; label: string; color: string }) {
  const t = useTheme();
  return (
    <View>
      <Text style={[styles.value, { color }]}>
        {value}
        <Text style={{ fontSize: 16, color: t.textDim }}> {unit}</Text>
      </Text>
      <Text style={[styles.label, { color: t.textFaint }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  split: { flexDirection: 'row', gap: 16 },
  panel: { flex: 1, borderWidth: 1, borderRadius: 8, padding: 16, alignItems: 'center', gap: 10 },
  title: { alignSelf: 'flex-start', fontFamily: 'JetBrains Mono', fontSize: 13, letterSpacing: 3 },
  stats: { flexDirection: 'row', justifyContent: 'space-around', alignSelf: 'stretch' },
  value: { fontFamily: 'Oxanium', fontSize: 34, fontWeight: '700' },
  label: { fontFamily: 'JetBrains Mono', fontSize: 11, letterSpacing: 2 },
  tile: { alignSelf: 'stretch', height: 72, borderWidth: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  tileText: { fontFamily: 'JetBrains Mono', fontSize: 17, letterSpacing: 3 },
  ratio: { fontFamily: 'JetBrains Mono', fontSize: 12, letterSpacing: 1 },
});
