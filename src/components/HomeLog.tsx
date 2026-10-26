/**
 * HOME logbook glances:
 *  • FuelTankCard — fuel left + range. The truck's gauge-cluster level if the EXPERIMENTAL
 *    meter probe answers, otherwise the fill-up estimate (src/lib/logbook.ts). The big
 *    FILLED UP button is the one-tap entry at the pump.
 *  • ServiceNudge — a header pill when a service is due or close (HOME only).
 *  • TripSummaryLayer — on PARK a "trip summary?" button; tap for the card (20 s).
 *
 * Perf: each reads a few quantised values via useTelemetry / useLogbook / useMpgLog
 * selectors (stores notify ≤ 1 Hz) — nothing here ticks at the data rate.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Press } from './ui/Press';
import { shallowEqual, useTelemetry } from '../data/DataSourceProvider';
import { useLogbook } from '../data/logbookStore';
import { useMpgLog } from '../data/mpgLogStore';
import { useTheme } from '../theme/ThemeProvider';
import { economyColor } from '../theme/glanceColors';
import { has } from '../data/types';
import { TANK_GAL, dueText, fuelLeft, lastPrice, nextDue, rangeMiles, spending } from '../lib/logbook';
import { ecoShare, lifetimeMpg, tripMpg, type Trip } from '../lib/mpgLog';
import { ECO_MPG } from '../lib/engineGlance';
import { useLogbookUI } from '../logbook/LogbookUI';
import { useGear } from '../data/gearStore';
import { fmtDate } from '../logbook/parts';

const r1 = (v: number) => Math.round(v * 10) / 10;

export const FuelTankCard = React.memo(function FuelTankCard() {
  const t = useTheme();
  const { openFill, openLog } = useLogbookUI();
  const meter = useTelemetry((d) => (has(d.obd.fuelLevelPct) ? Math.round(d.obd.fuelLevelPct.value) : null));
  const est = useLogbook(
    (lb) => {
      const l = fuelLeft(lb);
      return { gal: l ? r1(l.gallons) : null, since: lb.fills.length ? lb.fills[lb.fills.length - 1].at : null, calib: lb.calib };
    },
    shallowEqual
  );
  const life = useMpgLog((log) => lifetimeMpg(log));
  const spend = useLogbook(
    (lb, now) => {
      const sp = spending(lb, now, life);
      return { month: sp.costedFills ? Math.round(sp.month) : null, perMile: sp.perMile != null ? Math.round(sp.perMile * 100) / 100 : null };
    },
    shallowEqual
  );
  const gal = meter != null ? r1((meter / 100) * TANK_GAL) : est.gal;
  const pct = gal != null ? Math.round((gal / TANK_GAL) * 100) : null;
  // MAF mpg ÷ pump calibration = real mpg; EPA combined until there's history
  const mpg = life != null ? life / (est.calib ?? 1) : ECO_MPG;
  const range = rangeMiles(gal, mpg);
  const low = pct != null && pct < 15;
  const color = gal == null ? t.absent : low ? t.warn : t.text;
  return (
    <Press onPress={() => openLog('fuel')} style={[s.card, { borderColor: low ? t.warn : t.panelBorder, backgroundColor: t.panel }]}>
      <View style={s.head}>
        <Text allowFontScaling={false} style={[s.label, { color: t.textFaint }]}>FUEL TANK</Text>
        <Press onPress={openFill} hitSlop={10} style={[s.fillBtn, { borderColor: t.accent }]}>
          <Text allowFontScaling={false} style={[s.fillText, { color: t.accent }]}>FILLED UP</Text>
        </Press>
      </View>
      <Text allowFontScaling={false} style={[s.big, { color }]}>
        {gal == null ? '—' : `${meter != null ? '' : '≈ '}${gal.toFixed(1)}`}
        {gal != null && <Text allowFontScaling={false} style={[s.unit, { color: t.textDim }]}> gal</Text>}
        {range != null && <Text allowFontScaling={false} style={[s.unit, { color: t.textDim }]}>{`   ≈ ${Math.round(range)} mi`}</Text>}
      </Text>
      <View style={[s.track, { backgroundColor: t.hairline }]}>
        {pct != null && <View style={[s.fill, { width: `${Math.max(2, pct)}%`, backgroundColor: low ? t.warn : t.accent }]} />}
        {[25, 50, 75].map((q) => (
          <View key={q} style={[s.q, { left: `${q}%`, backgroundColor: t.bg }]} />
        ))}
      </View>
      <Text allowFontScaling={false} style={[s.foot, { color: low ? t.warn : t.textFaint }]}>
        {spend.month != null
          ? `${low ? 'LOW · ' : ''}${meter != null ? 'GAUGE' : 'EST'} · $${spend.month} THIS MO${spend.perMile != null ? ` · $${spend.perMile.toFixed(2)}/MI` : ''}`
          : meter != null
            ? 'GAUGE · LIVE'
            : est.since != null
              ? `${low ? 'LOW · ' : ''}ESTIMATE · SINCE ${fmtDate(est.since).replace(/ \d{4}$/, '')} FILL`
              : 'TAP FILLED UP AT YOUR NEXT FILL'}
      </Text>
    </Press>
  );
});

export const ServiceNudge = React.memo(function ServiceNudge() {
  const t = useTheme();
  const { openLog } = useLogbookUI();
  const due = useLogbook((lb, now) => {
    const n = nextDue(lb, now);
    return n ? `${n.type.id}|${n.type.label}|${dueText(n)}|${n.state}` : '';
  });
  if (!due) return null;
  const [id, label, when, state] = due.split('|');
  const c = state === 'due' ? t.warn : t.accent;
  return (
    <Press radius={8} hitSlop={12} onPress={() => openLog('service', id)} style={[s.nudge, { borderColor: c, backgroundColor: t.bg }]}>
      <Text allowFontScaling={false} style={[s.nudgeTitle, { color: c }]}>{label.toUpperCase()}</Text>
      <Text allowFontScaling={false} style={[s.nudgeSub, { color: t.textDim }]}>{when.toUpperCase()} · TAP TO LOG</Text>
    </Press>
  );
});

/** The trip worth summarising: the one in progress, else one that ended in the last 30 min. */
function debriefTrip(cur: Trip | null, trips: Trip[], now: number): Trip | null {
  if (cur) return cur;
  const last = trips[trips.length - 1];
  return last && last.endedAt != null && now - last.endedAt < 30 * 60_000 ? last : null;
}

const CARD_MS = 20_000; // the summary shows for 20 s (tap closes it sooner)
const PROMPT_MS = 120_000; // the "see summary?" button waits 2 min, then steps aside

/**
 * Trip summary, on any face: when you shift into PARK (or sit stopped a minute — see
 * src/lib/gear.ts) a TRIP SUMMARY button appears bottom-centre; tap it for the card,
 * centred in the bottom half, for 20 s. Rolling again clears both and re-arms.
 */
export const TripSummaryLayer = React.memo(function TripSummaryLayer() {
  const t = useTheme();
  const prompt = useGear((v) => v.prompt);
  const parkSeq = useGear((v) => v.parkSeq);
  const [phase, setPhase] = useState<'idle' | 'prompt' | 'card' | 'done'>('idle');
  const trip = useMpgLog((log, now) => {
    const tr = debriefTrip(log.current, log.trips, now);
    if (!tr || tr.miles < 0.5) return null;
    const mpg = tripMpg(tr);
    const eco = ecoShare(tr);
    const mins = Math.round((tr.movingSec ?? ((tr.endedAt ?? now) - tr.startedAt) / 1000) / 60);
    return {
      key: tr.startedAt,
      miles: tr.miles.toFixed(1),
      mins: String(mins),
      mpg: mpg != null ? mpg.toFixed(1) : '',
      mpgRaw: mpg,
      eco: eco != null ? String(Math.round(eco * 100)) : '',
      idle: tr.idleSec != null ? String(Math.round(tr.idleSec / 60)) : '',
      top: tr.maxMph ? String(Math.round(tr.maxMph)) : '',
      gal: tr.gallons,
    };
  }, shallowEqual);
  const money = useLogbook((lb) => ({ price: lastPrice(lb), calib: lb.calib ?? 1 }), shallowEqual);

  // prompt when parked / long-stopped with a real trip behind us; moving re-arms
  useEffect(() => {
    if (!prompt) {
      setPhase('idle');
      return;
    }
    if (trip) setPhase((p) => (p === 'idle' ? 'prompt' : p));
  }, [prompt, parkSeq, trip != null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (phase !== 'prompt' && phase !== 'card') return;
    const id = setTimeout(() => setPhase('done'), phase === 'card' ? CARD_MS : PROMPT_MS);
    return () => clearTimeout(id);
  }, [phase]);

  if (!trip || (phase !== 'prompt' && phase !== 'card')) return null;
  if (phase === 'prompt') {
    return (
      <Press radius={10} hitSlop={12} onPress={() => setPhase('card')} style={[s.prompt, { borderColor: t.accent, backgroundColor: t.bg }]}>
        <Text allowFontScaling={false} style={[s.promptTitle, { color: t.accent }]}>TRIP SUMMARY ›</Text>
        <Text allowFontScaling={false} style={[s.promptSub, { color: t.textDim }]}>
          {trip.miles} MI · {trip.mins} MIN{trip.mpg ? ` · ${trip.mpg} MPG` : ''}
        </Text>
      </Press>
    );
  }
  const gal = trip.gal * money.calib;
  const cost = money.price != null && gal > 0 ? `$${(gal * money.price).toFixed(2)}` : '';
  const stat = (v: string, label: string, color: string) => (
    <View style={s.stat}>
      <Text allowFontScaling={false} style={[s.statVal, { color: v ? color : t.absent }]}>{v || '—'}</Text>
      <Text allowFontScaling={false} style={[s.statLabel, { color: t.textFaint }]}>{label}</Text>
    </View>
  );
  return (
    <Press onPress={() => setPhase('done')} style={[s.debrief, { borderColor: t.accent, backgroundColor: t.bg }]}>
      <View style={s.head}>
        <Text allowFontScaling={false} style={[s.label, { color: t.accent }]}>TRIP SUMMARY</Text>
        <Text allowFontScaling={false} style={[s.close, { color: t.textFaint }]}>TAP TO CLOSE ✕</Text>
      </View>
      <View style={s.stats}>
        {stat(trip.miles, 'MILES', t.text)}
        {stat(trip.mins, 'MIN DRIVING', t.text)}
        {stat(trip.mpg, 'AVG MPG', economyColor(t, trip.mpgRaw))}
        {stat(cost, 'FUEL COST', t.text)}
      </View>
      <Text allowFontScaling={false} style={[s.line, { color: t.textDim }]}>
        {[trip.eco && `ECO ${trip.eco}%`, trip.idle && `IDLE ${trip.idle} MIN`, trip.top && `TOP ${trip.top} MPH`, gal > 0.01 && `${gal.toFixed(2)} GAL`]
          .filter(Boolean)
          .join('   ·   ')}
      </Text>
    </Press>
  );
});

const s = StyleSheet.create({
  card: { flex: 1, borderWidth: 1, borderRadius: 8, padding: 22, justifyContent: 'space-between' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontFamily: 'JetBrains Mono', fontSize: 17, letterSpacing: 4 },
  fillBtn: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 16, minHeight: 52, justifyContent: 'center' },
  fillText: { fontFamily: 'Oxanium', fontSize: 18, fontWeight: '800', letterSpacing: 2 },
  big: { fontFamily: 'Oxanium', fontSize: 44, fontWeight: '700', lineHeight: 52 },
  unit: { fontFamily: 'Oxanium', fontSize: 22, fontWeight: '600' },
  track: { height: 16, borderRadius: 8, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 8 },
  q: { position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1 },
  foot: { fontFamily: 'JetBrains Mono', fontSize: 15, letterSpacing: 2 },
  nudge: {
    position: 'absolute',
    top: 10,
    left: 560,
    width: 640,
    height: 72,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  nudgeTitle: { fontFamily: 'Oxanium', fontSize: 24, fontWeight: '700', letterSpacing: 2 },
  nudgeSub: { fontFamily: 'JetBrains Mono', fontSize: 16, letterSpacing: 2 },
  // centred across the stage, in the bottom half (above the dock)
  debrief: { position: 'absolute', left: 360, top: 560, width: 1280, borderWidth: 2, borderRadius: 12, padding: 32, gap: 20 },
  prompt: {
    position: 'absolute',
    left: 700,
    top: 896,
    width: 600,
    height: 96,
    borderWidth: 2,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  promptTitle: { fontFamily: 'Oxanium', fontSize: 28, fontWeight: '800', letterSpacing: 2 },
  promptSub: { fontFamily: 'JetBrains Mono', fontSize: 16, letterSpacing: 2 },
  close: { fontFamily: 'JetBrains Mono', fontSize: 15, letterSpacing: 2 },
  stats: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'flex-start' },
  statVal: { fontFamily: 'Oxanium', fontSize: 64, fontWeight: '700', lineHeight: 70 },
  statLabel: { fontFamily: 'JetBrains Mono', fontSize: 15, letterSpacing: 3 },
  line: { fontFamily: 'JetBrains Mono', fontSize: 18, letterSpacing: 2 },
});
