/**
 * ENGINE face — left column: RPM hero (numeral + segmented bar with the redline band),
 * coolant arc (cold → normal → hot), LOAD / THROTTLE bars, OIL TEMP.
 * Each piece selects only its own quantised value.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { shallowEqual, useTelemetry } from '../../data/DataSourceProvider';
import { useTheme } from '../../theme/ThemeProvider';
import { has } from '../../data/types';
import { arcPath, polar } from '../../lib/pulse';
import { COOLANT_HOT_F, COOLANT_WARM_F } from '../../lib/engineGlance';
import { coolantColor } from '../../theme/glanceColors';
import { Card, PctBar, Tile } from './parts';

export const RPM_FULL = 5500;
export const REDLINE_RPM = 4700;
const SEGS = 44; // 125 rpm per segment
const SEG_RPM = RPM_FULL / SEGS;

// ---- RPM ---------------------------------------------------------------------
const RpmNumeral = React.memo(function RpmNumeral() {
  const t = useTheme();
  const rpm = useTelemetry((d) => (has(d.obd.rpm) ? Math.round(d.obd.rpm.value / 50) * 50 : null));
  const red = rpm != null && rpm >= REDLINE_RPM;
  return (
    <Text allowFontScaling={false} style={[s.rpm, { color: rpm == null ? t.absent : red ? t.warn : t.accent }]}>
      {rpm == null ? '—' : rpm.toLocaleString()}
    </Text>
  );
});

const BAR_W = 556;
const BAR_H = 44;
const GAP = 3;
const SEG_W = (BAR_W - GAP * (SEGS - 1)) / SEGS;
const RED_FROM = Math.ceil(REDLINE_RPM / SEG_RPM);

function segPath(from: number, to: number): string {
  let d = '';
  for (let i = from; i < to; i++) {
    const x = (i * (SEG_W + GAP)).toFixed(1);
    d += `M ${x} 0 h ${SEG_W.toFixed(1)} v ${BAR_H} h -${SEG_W.toFixed(1)} Z `;
  }
  return d || 'M 0 0';
}

/** Re-renders only when another 125-rpm segment lights. */
const RpmBar = React.memo(function RpmBar() {
  const t = useTheme();
  const lit = useTelemetry((d) => (has(d.obd.rpm) ? Math.min(SEGS, Math.floor(d.obd.rpm.value / SEG_RPM)) : -1));
  const unlitNormal = useMemo(() => segPath(0, RED_FROM), []);
  const unlitRed = useMemo(() => segPath(RED_FROM, SEGS), []);
  const n = Math.max(0, lit);
  return (
    <View>
      <Svg width={BAR_W} height={BAR_H}>
        <Path d={unlitNormal} fill={t.hairline} />
        <Path d={unlitRed} fill={t.warn} fillOpacity={0.22} />
        <Path d={segPath(0, Math.min(n, RED_FROM))} fill={t.accent} />
        {n > RED_FROM && <Path d={segPath(RED_FROM, n)} fill={t.warn} />}
      </Svg>
      <View style={s.scale}>
        {[0, 1, 2, 3, 4, 5].map((k) => (
          <Text allowFontScaling={false} key={k} style={[s.scaleText, { color: k * 1000 >= REDLINE_RPM ? t.warn : t.textFaint, left: (k * 1000 * BAR_W) / RPM_FULL - (k ? 10 : 0) }]}>
            {k ? `${k}k` : '0'}
          </Text>
        ))}
      </View>
    </View>
  );
});

export const RpmCard = React.memo(function RpmCard() {
  const t = useTheme();
  const connected = useTelemetry((d) => d.obd.connected);
  return (
    <Card title="ENGINE RPM" right={<Text allowFontScaling={false} style={[s.redline, { color: t.warn }]}>REDLINE {REDLINE_RPM.toLocaleString()}</Text>} style={{ height: 288 }}>
      <RpmNumeral />
      <RpmBar />
      {!connected && <Text allowFontScaling={false} style={[s.hint, { color: t.absent }]}>OBD2 · CONNECT THE DONGLE IN SET</Text>}
    </Card>
  );
});

// ---- coolant arc --------------------------------------------------------------
const C_MIN = 100;
const C_MAX = 260;
const C_COLD = COOLANT_WARM_F; // below: still warming up (same line as HOME's warm-up card)
const C_HOT = COOLANT_HOT_F; // at/above: running hot
const ARC_W = 556;
const ARC_H = 196;
const ACX = ARC_W / 2;
const ACY = 176;
const AR = 150;
const angleOf = (f: number) => 180 + Math.max(0, Math.min(1, (f - C_MIN) / (C_MAX - C_MIN))) * 180;

export const CoolantCard = React.memo(function CoolantCard() {
  const t = useTheme();
  const temp = useTelemetry((d) => (has(d.obd.coolantTempF) ? Math.round(d.obd.coolantTempF.value) : null));
  const zones = useMemo(
    () => [
      { d: arcPath(ACX, ACY, AR, 180, angleOf(C_COLD)), c: t.cold },
      { d: arcPath(ACX, ACY, AR, angleOf(C_COLD), angleOf(C_HOT)), c: t.accent },
      { d: arcPath(ACX, ACY, AR, angleOf(C_HOT), 360), c: t.warn },
    ],
    [t.cold, t.accent, t.warn]
  );
  const absent = temp == null;
  const state = absent ? null : temp < C_COLD ? 'COLD' : temp >= C_HOT ? 'HOT' : 'NORMAL';
  // the live arc + numeral step blue → amber as it warms (same ramp as HOME's card)
  const color = coolantColor(t, temp);
  const a = absent ? 180 : angleOf(temp);
  const tip = polar(ACX, ACY, AR, a);
  return (
    <Card title="COOLANT" right={<Text allowFontScaling={false} style={[s.zone, { color }]}>{state ?? 'NO DATA'}</Text>} style={{ height: 270 }}>
      <View style={{ width: ARC_W, height: ARC_H }}>
        <Svg width={ARC_W} height={ARC_H}>
          {zones.map((z, i) => (
            <Path key={i} d={z.d} stroke={z.c} strokeOpacity={0.28} strokeWidth={14} fill="none" />
          ))}
          {!absent && a > 180.5 && <Path d={arcPath(ACX, ACY, AR, 180, a)} stroke={color} strokeWidth={14} fill="none" strokeLinecap="round" />}
          {!absent && <Circle cx={tip.x} cy={tip.y} r={11} fill={color} />}
        </Svg>
        <View style={s.arcCenter}>
          <Text allowFontScaling={false} style={[s.arcValue, { color: absent ? t.absent : t.text }]}>
            {absent ? '—' : temp}
            {!absent && <Text allowFontScaling={false} style={[s.arcUnit, { color: t.textDim }]}> °F</Text>}
          </Text>
        </View>
        <Text allowFontScaling={false} style={[s.arcEnd, { left: ACX - AR - 26, color: t.textFaint }]}>{C_MIN}</Text>
        <Text allowFontScaling={false} style={[s.arcEnd, { left: ACX + AR - 14, color: t.textFaint }]}>{C_MAX}</Text>
      </View>
    </Card>
  );
});

// ---- load / throttle / oil -------------------------------------------------------
export const LoadThrottleCard = React.memo(function LoadThrottleCard() {
  const v = useTelemetry(
    (d) => ({
      load: has(d.obd.engineLoadPct) ? Math.round(d.obd.engineLoadPct.value) : null,
      thr: has(d.obd.throttlePct) ? Math.round(d.obd.throttlePct.value) : null,
    }),
    shallowEqual
  );
  return (
    <Card style={{ height: 152, justifyContent: 'center', gap: 14 }}>
      <PctBar label="LOAD" pct={v.load} />
      <PctBar label="THROTTLE" pct={v.thr} />
    </Card>
  );
});

/**
 * Fuel burn right now (gal/h, from MAF). Replaced OIL TEMP: the 2TR-FE doesn't report
 * PID 5C (measured 2026-10-23). Works at idle, where mpg is undefined.
 */
export const FuelRateTile = React.memo(function FuelRateTile() {
  const v = useTelemetry(
    (d) => ({
      gph: has(d.obd.fuelRateGph) ? Math.round(d.obd.fuelRateGph.value * 100) / 100 : null,
      moving: has(d.motion.speedMph) && d.motion.speedMph.value >= 1,
    }),
    shallowEqual
  );
  // fixed-height wrapper: the Tile flexes to fill it (RN-web's flex:0 collapses to content)
  return (
    <View style={{ height: 128 }}>
      <Tile label="FUEL RATE" value={v.gph == null ? null : v.gph.toFixed(2)} unit="gal/h" caption={v.gph == null ? undefined : v.moving ? 'NOW' : 'AT IDLE'} size={40} />
    </View>
  );
});

const s = StyleSheet.create({
  rpm: { fontFamily: 'Oxanium', fontSize: 124, fontWeight: '700', lineHeight: 130, marginBottom: 4 },
  redline: { fontFamily: 'JetBrains Mono', fontSize: 15, letterSpacing: 2 },
  scale: { height: 22, marginTop: 4 },
  scaleText: { position: 'absolute', top: 0, fontFamily: 'JetBrains Mono', fontSize: 16, letterSpacing: 1 },
  hint: { fontFamily: 'JetBrains Mono', fontSize: 15, letterSpacing: 2, marginTop: 6 },
  zone: { fontFamily: 'JetBrains Mono', fontSize: 17, letterSpacing: 3 },
  arcCenter: { position: 'absolute', left: 0, right: 0, top: 96, alignItems: 'center' },
  arcValue: { fontFamily: 'Oxanium', fontSize: 64, fontWeight: '700' },
  arcUnit: { fontFamily: 'Oxanium', fontSize: 26, fontWeight: '600' },
  arcEnd: { position: 'absolute', top: ACY + 6, fontFamily: 'JetBrains Mono', fontSize: 16 },
});
