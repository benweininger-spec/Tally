/** Shared building blocks for the SET sheet sections. */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Press } from '../components/ui/Press';
import type { Theme } from '../theme/themes';

export function Section({ t, title, children }: { t: Theme; title: string; children: React.ReactNode }) {
  return (
    <View style={[styles.section, { borderColor: t.hairline }]}>
      <Text style={[styles.sectionTitle, { color: t.textDim }]}>{title}</Text>
      <View style={{ gap: 12 }}>{children}</View>
    </View>
  );
}

export function Btn({
  t,
  label,
  onPress,
  disabled,
  grow = true,
}: {
  t: Theme;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** fill the row (default) or size to the label */
  grow?: boolean;
}) {
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      hitSlop={12} // 72 px + slop = a 96 px target
      style={[styles.btn, grow ? { flex: 1 } : { flexShrink: 0 }, { borderColor: t.accent, opacity: disabled ? 0.4 : 1 }]}
    >
      <Text style={[styles.btnText, { color: t.accent }]}>{label}</Text>
    </Press>
  );
}

const styles = StyleSheet.create({
  section: { borderTopWidth: 1, paddingTop: 16 },
  sectionTitle: { fontFamily: 'JetBrains Mono', fontSize: 16, letterSpacing: 3, marginBottom: 12 },
  btn: { minHeight: 72, borderWidth: 1, borderRadius: 6, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: 'Oxanium', fontSize: 17, fontWeight: '700', letterSpacing: 1 },
});
