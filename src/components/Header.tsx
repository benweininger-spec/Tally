import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { shallowEqual, useTelemetry } from '../data/DataSourceProvider';
import { useTheme } from '../theme/ThemeProvider';
import { has } from '../data/types';
import { clockTime } from '../lib/format';

export const Header = React.memo(function Header() {
  const t = useTheme();
  // select only the display values — the clock advances once a minute, voltage is
  // absent (live) or slow (sim), so the header wakes rarely instead of 30x/sec.
  const { time, ampm, v, lte, wifi } = useTelemetry((d) => {
    const c = clockTime(d.system.now);
    return {
      time: c.time,
      ampm: c.ampm,
      v: has(d.system.voltage) ? d.system.voltage.value.toFixed(1) : '—',
      lte: d.system.lte,
      wifi: d.system.wifi,
    };
  }, shallowEqual);

  return (
    <View style={[styles.row, { borderBottomColor: t.hairline }]}>
      <Text style={[styles.mono, { color: t.textFaint }]}>
        TACOMA · SR <Text style={{ color: t.absent }}>/</Text> 2TR-FE
      </Text>
      <View style={styles.right}>
        <Text style={[styles.mono, { color: t.accent }]}>
          {time} <Text style={{ color: t.textFaint }}>{ampm}</Text>
        </Text>
        <Text style={[styles.mono, { color: lte ? t.textDim : t.absent }]}>LTE</Text>
        <Text style={[styles.mono, { color: wifi ? t.textDim : t.absent }]}>WI-FI</Text>
        <Text style={[styles.mono, { color: t.accent }]}>
          {v}
          <Text style={{ color: t.textFaint, fontSize: 17 }}>V</Text>
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    height: 92,
    paddingHorizontal: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  right: { flexDirection: 'row', alignItems: 'center', gap: 34 },
  mono: { fontFamily: 'JetBrains Mono', fontSize: 23, letterSpacing: 2 },
});
