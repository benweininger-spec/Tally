/**
 * ENGINE face — small performance tiles: last 0–60 run, estimated HP, estimated torque.
 * HP/torque are MAF-derived estimates (see src/lib/derive.ts), labelled as such.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTelemetry } from '../../data/DataSourceProvider';
import { has } from '../../data/types';
import { Tile } from './parts';

const ZeroSixty = React.memo(function ZeroSixty() {
  const v = useTelemetry((d) => (d.obd.zeroToSixtySec && has(d.obd.zeroToSixtySec) ? d.obd.zeroToSixtySec.value.toFixed(1) : null));
  return <Tile label="0–60" value={v} unit="s" caption={v ? 'LAST RUN' : 'NO RUN YET'} size={38} />;
});

const Hp = React.memo(function Hp() {
  // 5-hp steps: the estimate is noisy and a jittering numeral reads as false precision
  const v = useTelemetry((d) => (has(d.obd.estHp) ? Math.round(d.obd.estHp.value / 5) * 5 : null));
  return <Tile label="EST HP" value={v == null ? null : String(v)} unit="hp" caption="ESTIMATE" size={38} />;
});

const Torque = React.memo(function Torque() {
  const v = useTelemetry((d) => (has(d.obd.estTorqueLbFt) ? Math.round(d.obd.estTorqueLbFt.value / 5) * 5 : null));
  return <Tile label="TORQUE" value={v == null ? null : String(v)} unit="lb·ft" caption="ESTIMATE" size={38} />;
});

export const PerfTiles = React.memo(function PerfTiles() {
  return (
    <View style={s.row}>
      <ZeroSixty />
      <Hp />
      <Torque />
    </View>
  );
});

const s = StyleSheet.create({
  row: { height: 120, flexDirection: 'row', gap: 16 },
});
