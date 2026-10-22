import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { GScope } from './viz/GScope';

/**
 * DRIVE-face traction card: the Phosphor G-Scope (Signal Library 04) in the slot the
 * old traction dot used — same g data, plus a fading trail and the session grip
 * envelope. Hold the scope to reset the peaks.
 */
export const GScopeCard = React.memo(function GScopeCard() {
  const t = useTheme();
  return (
    <View style={[styles.card, { borderColor: t.panelBorder, backgroundColor: t.panel }]}>
      <Text style={[styles.title, { color: t.textFaint }]}>TRACTION · G-SCOPE</Text>
      <GScope size={300} />
    </View>
  );
});

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 8, padding: 16, alignItems: 'center' },
  title: { fontFamily: 'JetBrains Mono', fontSize: 14, letterSpacing: 4, alignSelf: 'flex-start', marginBottom: 4 },
});
