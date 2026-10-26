/**
 * HOME glance cards (Tier C, both render complete without OBD):
 *  • ECONOMY — smoothed instant mpg on a 0–40 bar with the ECO zone (≥ EPA combined),
 *    fuel burn in gal/h while idling, trip + lifetime averages underneath.
 *  • ENGINE TEMP — coolant °F and a warm-up bar to the OBD-II "warm" line (160 °F).
 *
 * Perf: each card selects a few quantised primitives (whole mpg, 0.05 gal/h, whole °F)
 * via useTelemetry + shallowEqual; averages come from the MPG store (≤ 1 Hz).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { shallowEqual, useTelemetry } from '../data/DataSourceProvider';
import { useMpgLog } from '../data/mpgLogStore';
import { useTheme } from '../theme/ThemeProvider';
import { coolantColor, economyColor } from '../theme/glanceColors';
import { has } from '../data/types';
import { lifetimeMpg, tripMpg } from '../lib/mpgLog';
import {
  COOLANT_WARM_F,
  ECO_MPG,
  MPG_BAR_MAX,
  coolantState,
  inEcoZone,
  mpgBarFrac,
  warmupFrac,
} from '../lib/engineGlance';

const pct = (f: number) => `${Math.round(f * 1000) / 10}%` as const;

export const EcoCard = React.memo(function EcoCard() {
  const t = useTheme();
  const v = useTelemetry(
    (d) => ({
      obd: d.obd.connected,
      mpg: has(d.obd.instantMpg) ? Math.round(d.obd.instantMpg.value) : null,
      moving: has(d.motion.speedMph) && d.motion.speedMph.value >= 1,
      gph: has(d.obd.fuelRateGph) ? Math.round(d.obd.fuelRateGph.value * 20) / 20 : null,
      session: has(d.obd.avgMpg) ? d.obd.avgMpg.value.toFixed(1) : '',
    }),
    shallowEqual
  );
  const avgs = useMpgLog(
    (log) => ({
      trip: log.current ? (tripMpg(log.current)?.toFixed(1) ?? '') : '',
      life: lifetimeMpg(log)?.toFixed(1) ?? '',
    }),
    shallowEqual
  );
  const trip = avgs.trip || v.session;
  const idle = v.obd && !v.moving && v.mpg == null;
  const eco = inEcoZone(v.mpg);
  const frac = v.mpg == null ? 0 : mpgBarFrac(v.mpg);
  const ecoFrom = mpgBarFrac(ECO_MPG);
  // green in the ECO zone, fading through amber to warn as economy gets poor
  const ecoCol = economyColor(t, v.mpg);
  const fill = ecoCol;

  return (
    <View style={[s.card, { borderColor: eco ? t.eco : t.panelBorder, backgroundColor: t.panel }]}>
      <View style={s.head}>
        <Text style={[s.label, { color: v.obd ? t.textFaint : t.absent }]}>ECONOMY</Text>
        <View style={[s.pill, { borderColor: eco ? t.eco : t.panelBorder, backgroundColor: eco ? t.eco : 'transparent' }]}>
          <Text style={[s.pillText, { color: eco ? t.bg : t.textFaint }]}>ECO</Text>
        </View>
      </View>

      {idle ? (
        <Text style={[s.big, { color: t.text }]}>
          IDLE
          <Text style={[s.unit, { color: t.textDim }]}>{v.gph != null ? `  ${v.gph.toFixed(2)} gal/h` : ''}</Text>
        </Text>
      ) : (
        <Text style={[s.big, { color: v.mpg == null ? t.absent : ecoCol }]}>
          {v.mpg == null ? '—' : v.mpg >= MPG_BAR_MAX ? `${MPG_BAR_MAX}+` : v.mpg}
          {v.mpg != null && <Text style={[s.unit, { color: t.textDim }]}> mpg</Text>}
        </Text>
      )}

      {/* 0–40 bar; the ECO band is the right-hand stretch from the EPA line */}
      <View style={[s.track, { backgroundColor: t.hairline }]}>
        <View style={[s.band, { left: pct(ecoFrom), backgroundColor: t.eco, opacity: eco ? 0.3 : 0.16 }]} />
        {v.mpg != null && <View style={[s.fill, { width: pct(frac), backgroundColor: fill }]} />}
        <View style={[s.tick, { left: pct(ecoFrom), backgroundColor: t.eco }]} />
      </View>
      <View style={s.scale}>
        <Text style={[s.scaleText, { color: t.textFaint }]}>0</Text>
        <Text style={[s.scaleText, { color: t.eco, position: 'absolute', left: pct(ecoFrom), marginLeft: -8 }]}>{ECO_MPG} ECO →</Text>
        <Text style={[s.scaleText, { color: t.textFaint }]}>{MPG_BAR_MAX}+</Text>
      </View>

      <View style={s.avgRow}>
        <Text style={[s.foot, { color: t.textFaint }]}>
          TRIP <Text style={[s.avgVal, { color: trip ? t.text : t.absent }]}>{trip || '—'}</Text>
        </Text>
        <Text style={[s.foot, { color: t.textFaint }]}>
          LIFETIME <Text style={[s.avgVal, { color: avgs.life ? t.text : t.absent }]}>{avgs.life || '—'}</Text>
        </Text>
        {!v.obd && <Text style={[s.foot, { color: t.absent }]}>NEEDS OBD</Text>}
      </View>
    </View>
  );
});

export const WarmupCard = React.memo(function WarmupCard() {
  const t = useTheme();
  const f = useTelemetry((d) => (has(d.obd.coolantTempF) ? Math.round(d.obd.coolantTempF.value) : null));
  const state = f == null ? null : coolantState(f);
  // blue → amber in three steps as it warms (120 / 140 / 160 °F), warn when hot
  const color = coolantColor(t, f);
  const frac = f == null ? 0 : warmupFrac(f);
  const caption =
    state == null ? 'NO OBD' : state === 'cold' ? `WARMING UP · ${Math.round(frac * 100)}%` : state === 'hot' ? 'RUNNING HOT' : 'WARM · READY';
  return (
    <View style={[s.card, { borderColor: state === 'hot' ? t.warn : t.panelBorder, backgroundColor: t.panel }]}>
      <Text style={[s.label, { color: f == null ? t.absent : t.textFaint }]}>ENGINE TEMP</Text>
      <Text style={[s.big, { color: f == null ? t.absent : color }]}>
        {f == null ? '—' : f}
        {f != null && <Text style={[s.unit, { color: t.textDim }]}> °F</Text>}
      </Text>
      <View style={[s.track, { backgroundColor: t.hairline }]}>
        <View style={[s.fill, { width: pct(frac), backgroundColor: color }]} />
      </View>
      <View style={s.scale}>
        <Text style={[s.scaleText, { color: t.textFaint }]}>COLD</Text>
        <Text style={[s.scaleText, { color: t.textFaint }]}>{COOLANT_WARM_F}°</Text>
      </View>
      <Text style={[s.foot, { color }]}>{caption}</Text>
    </View>
  );
});

const s = StyleSheet.create({
  card: { flex: 1, borderWidth: 1, borderRadius: 8, padding: 24, justifyContent: 'space-between' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontFamily: 'JetBrains Mono', fontSize: 17, letterSpacing: 4 },
  pill: { borderWidth: 1, borderRadius: 5, paddingHorizontal: 14, paddingVertical: 4 },
  pillText: { fontFamily: 'JetBrains Mono', fontSize: 17, letterSpacing: 4, fontWeight: '700' },
  big: { fontFamily: 'Oxanium', fontSize: 64, fontWeight: '700', lineHeight: 72 },
  unit: { fontFamily: 'Oxanium', fontSize: 24, fontWeight: '600' },
  track: { height: 16, borderRadius: 8, overflow: 'hidden' },
  band: { position: 'absolute', top: 0, bottom: 0, right: 0 },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 8 },
  tick: { position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1 },
  scale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  scaleText: { fontFamily: 'JetBrains Mono', fontSize: 15, letterSpacing: 2 },
  avgRow: { flexDirection: 'row', alignItems: 'baseline', gap: 28, marginTop: 6 },
  avgVal: { fontFamily: 'Oxanium', fontSize: 24, fontWeight: '700', letterSpacing: 0 },
  foot: { fontFamily: 'JetBrains Mono', fontSize: 16, letterSpacing: 2, marginTop: 8 },
});
