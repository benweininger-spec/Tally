/**
 * ENGINE face — FUEL ECONOMY card: INSTANT (live), TRIP AVG and LIFETIME (from the
 * long-term log), a 30-day ridgeline (days without scored miles gap the line), best /
 * worst day, and the last four trips.
 *
 * Perf: INSTANT selects one integer from telemetry; everything else comes from
 * `useMpgLog` — the MPG store notifies at most once a second, and the summary is a
 * flat object of strings compared with shallowEqual, so the ridgeline re-renders only
 * when a day's figure actually moves.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { shallowEqual, useTelemetry } from '../../data/DataSourceProvider';
import { useMpgLog } from '../../data/mpgLogStore';
import { useTheme } from '../../theme/ThemeProvider';
import { economyColor } from '../../theme/glanceColors';
import { has } from '../../data/types';
import { bestWorstDay, last30, lifetimeMpg, runs, tripMpg, type MpgLog } from '../../lib/mpgLog';
import { buildWaveform } from '../../lib/pulse';
import { Card } from './parts';

const RIDGE_W = 616;
const RIDGE_H = 104;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const shortDate = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${Number(key.slice(8, 10))}`;
const f1 = (v: number | null) => (v == null ? '' : v.toFixed(1));

interface Summary {
  trip: string;
  lifetime: string;
  series: string; // 30 × "18.4" | "" joined by ','
  best: string;
  worst: string;
  trips: string; // newest first: "OCT 20|12.3|19.8;…"
}

function summarize(log: MpgLog, now: number): Summary {
  const bw = bestWorstDay(log);
  const recent = log.trips.slice(-4).reverse(); // 4 rows fit at the larger text size
  return {
    trip: f1(log.current ? tripMpg(log.current) : null),
    lifetime: f1(lifetimeMpg(log)),
    series: last30(log, now)
      .map((d) => f1(d.mpg))
      .join(','),
    best: bw.best ? `${shortDate(bw.best.date)}|${bw.best.mpg.toFixed(1)}` : '',
    worst: bw.worst ? `${shortDate(bw.worst.date)}|${bw.worst.mpg.toFixed(1)}` : '',
    trips: recent
      .map((t) => {
        const d = new Date(t.startedAt);
        const m = tripMpg(t);
        return `${MONTHS[d.getMonth()]} ${d.getDate()}|${t.miles.toFixed(1)}|${m == null ? '—' : m.toFixed(1)}`;
      })
      .join(';'),
  };
}

const Instant = React.memo(function Instant() {
  const t = useTheme();
  const v = useTelemetry((d) => (has(d.obd.instantMpg) ? Math.round(d.obd.instantMpg.value) : null));
  return (
    <View>
      <Text allowFontScaling={false} style={[s.k, { color: v == null ? t.absent : t.textFaint }]}>INSTANT</Text>
      <Text allowFontScaling={false} style={[s.big, { color: v == null ? t.absent : economyColor(t, v) }]}>
        {v == null ? '—' : v}
        {v != null && <Text allowFontScaling={false} style={[s.unit, { color: t.textDim }]}> mpg</Text>}
      </Text>
    </View>
  );
});

function Ridgeline({ series }: { series: string }) {
  const t = useTheme();
  const geom = useMemo(() => {
    const vals = series.split(',').map((x) => (x === '' ? null : Number(x)));
    const real = vals.filter((v): v is number => v != null);
    if (!real.length) return null;
    const lo = Math.min(...real);
    const hi = Math.max(...real);
    const mid = (lo + hi) / 2;
    const half = Math.max(2, (hi - lo) / 2); // ±2 mpg floor: flat weeks don't look dramatic
    const step = RIDGE_W / (vals.length - 1);
    const shapes = runs(vals).map(([a, b]) => {
      if (a === b) return { dot: { x: a * step, y: RIDGE_H / 2 - (((vals[a] as number) - mid) / half) * (RIDGE_H / 2 - 6) } };
      const w = buildWaveform({
        samples: vals.slice(a, b + 1).map((v) => (v as number) - mid),
        x: a * step,
        y: 6,
        width: (b - a) * step,
        height: RIDGE_H - 12,
        range: half,
        floor: true,
      });
      return { line: w.line, fill: w.fill };
    });
    return { shapes, lo, hi };
  }, [series]);

  if (!geom) {
    return (
      <View style={[s.ridgeEmpty, { borderColor: t.hairline }]}>
        <Text allowFontScaling={false} style={[s.k, { color: t.absent }]}>NO SCORED DAYS YET · NEEDS OBD WHILE DRIVING</Text>
      </View>
    );
  }
  return (
    <View>
      <Svg width={RIDGE_W} height={RIDGE_H}>
        <Defs>
          <LinearGradient id="mpgFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={t.accent} stopOpacity={0.3} />
            <Stop offset="1" stopColor={t.accent} stopOpacity={0.03} />
          </LinearGradient>
        </Defs>
        <Path d={`M 0 ${RIDGE_H - 0.5} L ${RIDGE_W} ${RIDGE_H - 0.5}`} stroke={t.hairline} strokeWidth={1} />
        {geom.shapes.map((sh, i) =>
          'dot' in sh && sh.dot ? (
            <Circle key={i} cx={sh.dot.x} cy={sh.dot.y} r={4} fill={t.accent} />
          ) : (
            <React.Fragment key={i}>
              <Path d={sh.fill} fill="url(#mpgFill)" />
              <Path d={sh.line} stroke={t.accent} strokeWidth={2.5} fill="none" strokeLinejoin="round" />
            </React.Fragment>
          )
        )}
      </Svg>
      <View style={s.ridgeAxis}>
        <Text allowFontScaling={false} style={[s.k, { color: t.textFaint }]}>30 DAYS · {geom.lo.toFixed(0)}–{geom.hi.toFixed(0)} MPG</Text>
        <Text allowFontScaling={false} style={[s.k, { color: t.textFaint }]}>TODAY</Text>
      </View>
    </View>
  );
}

export const MpgCard = React.memo(function MpgCard() {
  const t = useTheme();
  const sum = useMpgLog(summarize, shallowEqual);
  const sessionAvg = useTelemetry((d) => (has(d.obd.avgMpg) ? d.obd.avgMpg.value.toFixed(1) : ''));
  const trip = sum.trip || sessionAvg;
  const stat = (label: string, v: string) => (
    <View>
      <Text allowFontScaling={false} style={[s.k, { color: v ? t.textFaint : t.absent }]}>{label}</Text>
      <Text allowFontScaling={false} style={[s.mid, { color: v ? t.text : t.absent }]}>
        {v || '—'}
        {v ? <Text allowFontScaling={false} style={[s.unitSm, { color: t.textDim }]}> mpg</Text> : null}
      </Text>
    </View>
  );
  const [bd, bv] = sum.best.split('|');
  const [wd, wv] = sum.worst.split('|');
  const trips = sum.trips ? sum.trips.split(';').map((r) => r.split('|')) : [];
  return (
    <Card title="FUEL ECONOMY" style={{ height: 470 }}>
      <View style={s.stats}>
        <Instant />
        {stat('TRIP AVG', trip)}
        {stat('LIFETIME', sum.lifetime)}
      </View>
      <Ridgeline series={sum.series} />
      <View style={s.bw}>
        <Text allowFontScaling={false} style={[s.k, { color: t.textFaint }]}>
          BEST <Text allowFontScaling={false} style={{ color: bv ? t.text : t.absent }}>{bv ? `${bd} · ${bv}` : '—'}</Text>
        </Text>
        <Text allowFontScaling={false} style={[s.k, { color: t.textFaint }]}>
          WORST <Text allowFontScaling={false} style={{ color: wv ? t.text : t.absent }}>{wv ? `${wd} · ${wv}` : '—'}</Text>
        </Text>
      </View>
      <View style={[s.trips, { borderTopColor: t.hairline }]}>
        <Text allowFontScaling={false} style={[s.k, { color: t.textFaint, marginBottom: 2 }]}>LAST TRIPS</Text>
        {trips.length === 0 ? (
          <Text allowFontScaling={false} style={[s.tripRow, { color: t.absent }]}>— no completed trips yet</Text>
        ) : (
          trips.map(([date, mi, mpg], i) => (
            <View key={i} style={s.tripLine}>
              <Text allowFontScaling={false} style={[s.tripRow, { color: t.textDim, width: 110 }]}>{date}</Text>
              <Text allowFontScaling={false} style={[s.tripRow, { color: t.textDim, width: 150 }]}>{mi} mi</Text>
              <Text allowFontScaling={false} style={[s.tripRow, { color: mpg === '—' ? t.absent : t.text }]}>{mpg === '—' ? '— mpg' : `${mpg} mpg`}</Text>
            </View>
          ))
        )}
      </View>
    </Card>
  );
});

const s = StyleSheet.create({
  stats: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10 },
  k: { fontFamily: 'JetBrains Mono', fontSize: 16, letterSpacing: 2 },
  big: { fontFamily: 'Oxanium', fontSize: 64, fontWeight: '700', lineHeight: 70 },
  unit: { fontFamily: 'Oxanium', fontSize: 22, fontWeight: '600' },
  mid: { fontFamily: 'Oxanium', fontSize: 38, fontWeight: '700' },
  unitSm: { fontFamily: 'Oxanium', fontSize: 19, fontWeight: '600' },
  ridgeEmpty: { height: RIDGE_H + 22, borderWidth: 1, borderStyle: 'dashed', borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  ridgeAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  bw: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  trips: { borderTopWidth: 1, marginTop: 10, paddingTop: 8 },
  tripLine: { flexDirection: 'row' },
  tripRow: { fontFamily: 'JetBrains Mono', fontSize: 18, letterSpacing: 1, lineHeight: 23 },
});
