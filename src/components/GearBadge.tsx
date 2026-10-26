/**
 * Gear readout in the open bottom of the signature dial, like a cluster's PRND strip:
 * P · R · D with the active one lit, and the gear number beside D while moving
 * (rpm ÷ speed — src/lib/gear.ts). N isn't shown: nothing on this truck can tell N from D.
 * Wakes only when the shown gear changes (gearStore notifies a few times per drive).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useGear } from '../data/gearStore';
import { useTheme } from '../theme/ThemeProvider';

export const GearBadge = React.memo(function GearBadge({ size }: { size: number }) {
  const t = useTheme();
  const shown = useGear((v) => v.shown);
  const k = size / 860;
  const num = /^[1-6]$/.test(shown) ? shown : null;
  const lit = (l: 'P' | 'R' | 'D') => (l === 'D' ? shown === 'D' || num != null : shown === l);
  const color = (l: 'P' | 'R' | 'D') => (!lit(l) ? t.absent : l === 'R' ? t.warn : t.accent);
  return (
    <View pointerEvents="none" style={[s.wrap, { top: size * 0.765, width: size }]}>
      <View style={[s.strip, { gap: 18 * k, borderColor: t.panelBorder, paddingHorizontal: 18 * k, height: 72 * k }]}>
        {(['P', 'R', 'D'] as const).map((l) => (
          <Text allowFontScaling={false} key={l} style={[s.letter, { fontSize: 40 * k, color: color(l), opacity: lit(l) ? 1 : 0.55 }]}>
            {l}
          </Text>
        ))}
        <View style={[s.numBox, { width: 54 * k, height: 54 * k, borderColor: num ? t.accent : t.panelBorder }]}>
          <Text allowFontScaling={false} style={[s.num, { fontSize: 38 * k, color: num ? t.accent : t.absent }]}>{num ?? '–'}</Text>
        </View>
      </View>
    </View>
  );
});

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, alignItems: 'center' },
  strip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10 },
  letter: { fontFamily: 'Oxanium', fontWeight: '800' },
  numBox: { borderWidth: 2, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  num: { fontFamily: 'Oxanium', fontWeight: '800' },
});
