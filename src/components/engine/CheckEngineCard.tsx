/**
 * ENGINE face — CHECK ENGINE card: MIL lamp, stored-code count, each code with its
 * plain-English description, and a two-step CLEAR CODES (tap → "CONFIRM CLEAR" armed
 * for 5 s → Mode 04 via `live.clearDtcs()`). Clearing is live-only: in sim, or with
 * the dongle down, the button renders disabled with the reason.
 *
 * Perf: one selector → { mil, codes (joined string), count, connected } with
 * shallowEqual, so the card wakes only when the lamp or the code list changes.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { shallowEqual, useSourceControls, useTelemetry } from '../../data/DataSourceProvider';
import { useTheme } from '../../theme/ThemeProvider';
import { has } from '../../data/types';
import { describeDtc } from '../../lib/dtcDescriptions';
import { Card } from './parts';

const ARM_MS = 5000;
const MAX_SHOWN = 3;

type Phase = 'idle' | 'armed' | 'clearing' | 'cleared' | 'error';

function MilLamp({ on }: { on: boolean }) {
  const t = useTheme();
  return (
    <View
      style={[
        s.lamp,
        on ? { backgroundColor: t.warn, borderColor: t.warn, shadowColor: t.warn, shadowOpacity: 0.8, shadowRadius: 10 } : { borderColor: t.panelBorder },
      ]}
    />
  );
}

function ClearButton({ enabled, reason }: { enabled: boolean; reason: string | null }) {
  const t = useTheme();
  const { live } = useSourceControls();
  const [phase, setPhase] = useState<Phase>('idle');
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const later = (ms: number, next: Phase) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPhase(next), ms);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const press = async () => {
    if (!enabled || !live) return;
    if (phase === 'idle' || phase === 'cleared' || phase === 'error') {
      setPhase('armed');
      later(ARM_MS, 'idle'); // un-arm if not confirmed
      return;
    }
    if (phase !== 'armed') return;
    if (timer.current) clearTimeout(timer.current);
    setPhase('clearing');
    try {
      await live.clearDtcs();
      setPhase('cleared');
      later(4000, 'idle');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase('error');
      later(8000, 'idle');
    }
  };

  const armed = phase === 'armed';
  const label = !enabled
    ? 'CLEAR CODES'
    : armed
      ? 'CONFIRM CLEAR'
      : phase === 'clearing'
        ? 'CLEARING…'
        : phase === 'cleared'
          ? 'CLEARED'
          : 'CLEAR CODES';
  const note = !enabled ? reason : armed ? 'TAP AGAIN WITHIN 5 S' : phase === 'error' ? err : phase === 'cleared' ? 'CODES RE-READ' : 'ENGINE OFF · KEY ON';
  const fg = !enabled ? t.absent : armed ? t.bg : t.warn;
  return (
    <View style={s.btnCol}>
      <Pressable
        onPress={press}
        disabled={!enabled || phase === 'clearing'}
        accessibilityRole="button"
        accessibilityState={{ disabled: !enabled }}
        style={({ pressed }) => [
          s.btn,
          {
            borderColor: enabled ? t.warn : t.panelBorder,
            backgroundColor: armed ? t.warn : 'transparent',
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Text allowFontScaling={false} style={[s.btnText, { color: fg }]}>{label}</Text>
      </Pressable>
      {note ? (
        <Text allowFontScaling={false} numberOfLines={3} style={[s.note, { color: phase === 'error' ? t.warn : t.textFaint }]}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

export const CheckEngineCard = React.memo(function CheckEngineCard() {
  const t = useTheme();
  const { mode } = useSourceControls();
  const v = useTelemetry(
    (d) => ({
      connected: d.obd.connected,
      mil: d.obd.milOn,
      codes: has(d.obd.dtcCodes) ? d.obd.dtcCodes.value.join(',') : null,
      count: has(d.obd.dtcCount) ? d.obd.dtcCount.value : null,
    }),
    shallowEqual
  );
  const codes = v.codes == null ? null : v.codes === '' ? [] : v.codes.split(',');
  const count = codes ? Math.max(codes.length, v.count ?? 0) : v.count;
  const unknown = !v.connected || codes == null;

  const reason = mode !== 'live' ? 'SIM · CLEARING NEEDS LIVE OBD' : !v.connected ? 'CONNECT OBD TO CLEAR' : null;
  const canClear = mode === 'live' && v.connected && codes != null;

  const head = (
    <View style={s.headRight}>
      <Text allowFontScaling={false} style={[s.count, { color: unknown ? t.absent : count ? t.warn : t.textFaint }]}>
        {unknown ? 'NOT READ' : `${count} CODE${count === 1 ? '' : 'S'}`}
      </Text>
      <MilLamp on={v.connected && v.mil} />
    </View>
  );

  return (
    <Card title="CHECK ENGINE" right={head} style={{ height: 264 }}>
      <View style={s.body}>
        <View style={s.list}>
          {!v.connected ? (
            <Text allowFontScaling={false} style={[s.empty, { color: t.absent }]}>— NO DATA · OBD2 NOT CONNECTED</Text>
          ) : codes == null ? (
            <Text allowFontScaling={false} style={[s.empty, { color: t.absent }]}>— READING CODES…</Text>
          ) : codes.length === 0 ? (
            <Text allowFontScaling={false} style={[s.ok, { color: t.text }]}>NO CODES · ENGINE OK</Text>
          ) : (
            <>
              {codes.slice(0, MAX_SHOWN).map((c) => (
                <View key={c} style={s.codeRow}>
                  <Text allowFontScaling={false} style={[s.code, { color: t.warn }]}>{c}</Text>
                  <Text allowFontScaling={false} numberOfLines={2} style={[s.desc, { color: t.textDim }]}>
                    {describeDtc(c)}
                  </Text>
                </View>
              ))}
              {codes.length > MAX_SHOWN && <Text allowFontScaling={false} style={[s.desc, { color: t.textFaint }]}>+{codes.length - MAX_SHOWN} MORE</Text>}
            </>
          )}
        </View>
        <ClearButton enabled={canClear} reason={reason} />
      </View>
    </Card>
  );
});

const s = StyleSheet.create({
  headRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  count: { fontFamily: 'JetBrains Mono', fontSize: 17, letterSpacing: 2 },
  lamp: { width: 22, height: 22, borderRadius: 11, borderWidth: 2 },
  body: { flex: 1, flexDirection: 'row', gap: 18 },
  list: { flex: 1, gap: 10, justifyContent: 'center' },
  empty: { fontFamily: 'JetBrains Mono', fontSize: 18, letterSpacing: 2 },
  ok: { fontFamily: 'Oxanium', fontSize: 30, fontWeight: '700', letterSpacing: 1 },
  codeRow: { gap: 2 },
  code: { fontFamily: 'Oxanium', fontSize: 30, fontWeight: '700', letterSpacing: 1 },
  desc: { fontFamily: 'JetBrains Mono', fontSize: 16, letterSpacing: 0.5, lineHeight: 18 },
  btnCol: { width: 210, justifyContent: 'center', gap: 8 },
  btn: { height: 112, borderWidth: 2, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: 'Oxanium', fontSize: 22, fontWeight: '700', letterSpacing: 2 },
  note: { fontFamily: 'JetBrains Mono', fontSize: 15, letterSpacing: 1.5, textAlign: 'center' },
});
