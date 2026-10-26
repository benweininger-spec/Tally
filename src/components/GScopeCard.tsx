import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { GScope, type GReadout } from './viz/GScope';

/**
 * DRIVE-face traction card: the Phosphor G-Scope (Signal Library 04) in the slot the
 * old traction dot used — same g data, plus a fading trail and the session grip
 * envelope. Hold the scope to reset the peaks.
 */
export const GScopeCard = React.memo(function GScopeCard() {
  const t = useTheme();
  // the scope's live g + session peak, shown in the title row (inside a 300 px scope
  // they collide with the ACCEL / BRAKE captions at the larger text size)
  const [r, setR] = useState<GReadout>({ g: '—', peak: '0.00' });
  return (
    <View style={[styles.card, { borderColor: t.panelBorder, backgroundColor: t.panel }]}>
      <View style={styles.head}>
        <View>
          <Text style={[styles.title, { color: t.textFaint }]}>TRACTION</Text>
          <Text style={[styles.peak, { color: t.textFaint }]}>PEAK {r.peak}G</Text>
        </View>
        <Text style={[styles.g, { color: r.g === '—' ? t.absent : t.text }]}>{r.g === '—' ? '—' : `${r.g}g`}</Text>
      </View>
      <GScope size={300} onReadout={setR} />
    </View>
  );
});

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 8, padding: 16, alignItems: 'center' },
  head: { alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  title: { fontFamily: 'JetBrains Mono', fontSize: 17, letterSpacing: 4 },
  peak: { fontFamily: 'JetBrains Mono', fontSize: 15, letterSpacing: 2, marginTop: 2 },
  g: { fontFamily: 'Oxanium', fontSize: 34, fontWeight: '700' },
});
