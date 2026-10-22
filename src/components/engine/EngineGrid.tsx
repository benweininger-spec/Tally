/**
 * ENGINE face — middle grid: every remaining OBD value as its own memoised tile
 * (INTAKE · AMBIENT · MAP · BARO · FUEL · RUN TIME · ECU vs UNIT volts · TRANS
 * (experimental) · STFT · LTFT). Each tile selects one quantised primitive.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { shallowEqual, useTelemetry } from '../../data/DataSourceProvider';
import { useTheme } from '../../theme/ThemeProvider';
import { has, type DashboardData, type Signal } from '../../data/types';
import { Tile, TrimBar, styles as ps } from './parts';

/** A Signal<number> field rounded to `step`, or null if absent. */
const num = (s: Signal<number> | undefined, step = 1): number | null =>
  s && has(s) ? Math.round(s.value / step) * step : null;

function NumTile({ label, pick, unit, step = 1, digits = 0 }: { label: string; pick: (d: DashboardData) => Signal<number>; unit: string; step?: number; digits?: number }) {
  const v = useTelemetry((d) => num(pick(d), step));
  return <Tile label={label} value={v == null ? null : v.toFixed(digits)} unit={unit} />;
}

const Intake = React.memo(() => <NumTile label="INTAKE AIR" pick={(d) => d.obd.intakeTempF} unit="°F" />);
const Ambient = React.memo(() => <NumTile label="AMBIENT" pick={(d) => d.obd.ambientTempF} unit="°F" />);
const Manifold = React.memo(() => <NumTile label="MANIFOLD (MAP)" pick={(d) => d.obd.mapKpa} unit="kPa" />);
const Baro = React.memo(() => <NumTile label="BAROMETRIC" pick={(d) => d.obd.baroKpa} unit="kPa" />);
const Fuel = React.memo(() => <NumTile label="FUEL LEVEL" pick={(d) => d.obd.fuelLevelPct} unit="%" />);

const RunTime = React.memo(function RunTime() {
  // minutes resolution: the tile wakes once a minute, not once a second
  const min = useTelemetry((d) => (has(d.obd.runTimeSec) ? Math.floor(d.obd.runTimeSec.value / 60) : null));
  const v = min == null ? null : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
  return <Tile label="RUN TIME" value={v} unit="h:mm" caption={v ? 'SINCE ENGINE START' : undefined} />;
});

/** Alternator (ECU, PID 42) vs battery side (the head unit's own 12 V input). */
const Volts = React.memo(function Volts() {
  const t = useTheme();
  const v = useTelemetry((d) => ({ ecu: num(d.obd.ecuVolts, 0.1), unit: num(d.system.unitVoltage, 0.1) }), shallowEqual);
  const cell = (label: string, x: number | null) => (
    <View style={{ flex: 1 }}>
      <Text style={[ps.caption, { color: x == null ? t.absent : t.textFaint }]}>{label}</Text>
      <Text style={[s.volt, { color: x == null ? t.absent : t.text }]}>
        {x == null ? '—' : x.toFixed(1)}
        {x != null && <Text style={[s.voltUnit, { color: t.textDim }]}> V</Text>}
      </Text>
    </View>
  );
  return (
    <View style={[ps.card, ps.tile, { borderColor: t.panelBorder, backgroundColor: t.panel }]}>
      <Text style={[ps.label, { color: v.ecu == null && v.unit == null ? t.absent : t.textFaint }]}>VOLTS</Text>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {cell('ECU · ALT', v.ecu)}
        {cell('UNIT · BATT', v.unit)}
      </View>
    </View>
  );
});

const Trans = React.memo(function Trans() {
  const v = useTelemetry((d) => num(d.obd.transTempF));
  return (
    <Tile
      label="TRANS FLUID"
      value={v == null ? null : String(v)}
      unit="°F"
      caption={v == null ? 'EXPERIMENTAL · NO ANSWER' : 'EXPERIMENTAL PROBE'}
      warn={v != null && v >= 230}
    />
  );
});

const Stft = React.memo(function Stft() {
  const v = useTelemetry((d) => num(d.obd.stftPct, 0.5));
  return <TrimBar label="SHORT TRIM B1" pct={v} />;
});
const Ltft = React.memo(function Ltft() {
  const v = useTelemetry((d) => num(d.obd.ltftPct, 0.5));
  return <TrimBar label="LONG TRIM B1" pct={v} />;
});

const ROWS: React.ComponentType[][] = [
  [Intake, Ambient],
  [Manifold, Baro],
  [Fuel, RunTime],
  [Volts, Trans],
  [Stft, Ltft],
];

export const EngineGrid = React.memo(function EngineGrid() {
  return (
    <View style={s.grid}>
      {ROWS.map((row, i) => (
        <View key={i} style={s.row}>
          {row.map((C, j) => (
            <C key={j} />
          ))}
        </View>
      ))}
    </View>
  );
});

const s = StyleSheet.create({
  grid: { flex: 1, gap: 16 },
  row: { flex: 1, flexDirection: 'row', gap: 16 },
  volt: { fontFamily: 'Oxanium', fontSize: 36, fontWeight: '700' },
  voltUnit: { fontFamily: 'Oxanium', fontSize: 18, fontWeight: '600' },
});
