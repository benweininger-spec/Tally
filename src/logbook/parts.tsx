/**
 * Input parts for the logbook sheets, built for a head unit: a big on-screen number pad
 * (no Android keyboard popping over the form), tap-to-edit number fields, and date
 * steppers for back-logging old service. Every target is ≥ 72 px.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Press } from '../components/ui/Press';
import type { Theme } from '../theme/themes';

/** Edit state for a numeric field: the text being typed + whether the next key replaces it. */
export interface NumEdit {
  text: string;
  /** true right after focusing a prefilled field: the first key starts fresh */
  fresh: boolean;
}

export const numEdit = (v: number | null, digits = 1): NumEdit => ({ text: v == null ? '' : v.toFixed(digits), fresh: true });
export const numValue = (e: NumEdit): number | null => {
  const v = parseFloat(e.text);
  return Number.isFinite(v) ? v : null;
};

/** Apply one keypad key to an edit (pure). */
export function pressKey(e: NumEdit, key: string, maxLen = 9): NumEdit {
  if (key === '⌫') return { text: e.fresh ? '' : e.text.slice(0, -1), fresh: false };
  if (key === 'C') return { text: '', fresh: false };
  const base = e.fresh ? '' : e.text;
  if (key === '.' && base.includes('.')) return { ...e, fresh: false };
  const next = base === '0' && key !== '.' ? key : base + key;
  return { text: next.length > maxLen ? base : next, fresh: false };
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

export function NumPad({ t, onKey, decimals = true }: { t: Theme; onKey: (k: string) => void; decimals?: boolean }) {
  return (
    <View style={s.pad}>
      {KEYS.map((k) => {
        const off = k === '.' && !decimals;
        return (
          <Press key={k} disabled={off} onPress={() => onKey(k)} style={[s.key, { borderColor: t.panelBorder, opacity: off ? 0.25 : 1 }]}>
            <Text style={[s.keyText, { color: k === '⌫' ? t.textDim : t.text }]}>{k}</Text>
          </Press>
        );
      })}
    </View>
  );
}

/** A tap-to-edit number field; `active` = the pad is typing into it. */
export function NumField({
  t,
  label,
  edit,
  active,
  onFocus,
  prefix,
  suffix,
  hint,
  thousands,
}: {
  t: Theme;
  label: string;
  edit: NumEdit;
  active: boolean;
  onFocus: () => void;
  prefix?: string;
  suffix?: string;
  hint?: string;
  /** show 84210 as 84,210 */
  thousands?: boolean;
}) {
  const shown = edit.text === '' ? '—' : thousands && !edit.text.includes('.') ? Number(edit.text).toLocaleString() : edit.text;
  return (
    <Press onPress={onFocus} style={[s.field, { borderColor: active ? t.accent : t.panelBorder, backgroundColor: t.panel }]}>
      <Text style={[s.fieldLabel, { color: active ? t.accent : t.textFaint }]}>{label}</Text>
      <Text style={[s.fieldValue, { color: edit.text === '' ? t.absent : edit.fresh ? t.textDim : t.text }]}>
        {prefix && edit.text !== '' ? prefix : ''}
        {shown}
        {suffix && edit.text !== '' ? <Text style={[s.fieldSuffix, { color: t.textDim }]}> {suffix}</Text> : null}
      </Text>
      {hint ? <Text style={[s.fieldHint, { color: t.textFaint }]}>{hint}</Text> : null}
    </Press>
  );
}

/** Two-way choice (FULL / PARTIAL, tabs). */
export function Segmented<T extends string>({
  t,
  options,
  value,
  onChange,
}: {
  t: Theme;
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={s.seg}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Press key={o.id} onPress={() => onChange(o.id)} style={[s.segBtn, { borderColor: on ? t.accent : t.panelBorder, backgroundColor: on ? t.panel : 'transparent' }]}>
            <Text style={[s.segText, { color: on ? t.accent : t.textDim }]}>{o.label}</Text>
          </Press>
        );
      })}
    </View>
  );
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const fmtDate = (at: number) => {
  const d = new Date(at);
  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
};

/** Month / day / year steppers + TODAY — back-logging old service without a keyboard. */
export function DateSteps({ t, at, onChange }: { t: Theme; at: number; onChange: (at: number) => void }) {
  const d = new Date(at);
  const shift = (part: 'm' | 'd' | 'y', by: number) => {
    const n = new Date(at);
    if (part === 'd') n.setDate(n.getDate() + by);
    if (part === 'm') n.setMonth(n.getMonth() + by);
    if (part === 'y') n.setFullYear(n.getFullYear() + by);
    onChange(Math.min(Date.now(), n.getTime())); // no future service
  };
  const cell = (part: 'm' | 'd' | 'y', text: string) => (
    <View style={s.dateCell}>
      <Press onPress={() => shift(part, -1)} style={[s.dateBtn, { borderColor: t.panelBorder }]}>
        <Text style={[s.dateArrow, { color: t.textDim }]}>‹</Text>
      </Press>
      <Text style={[s.dateText, { color: t.text }]}>{text}</Text>
      <Press onPress={() => shift(part, 1)} style={[s.dateBtn, { borderColor: t.panelBorder }]}>
        <Text style={[s.dateArrow, { color: t.textDim }]}>›</Text>
      </Press>
    </View>
  );
  return (
    <View style={s.dateRow}>
      {cell('m', MONTHS[d.getMonth()])}
      {cell('d', String(d.getDate()))}
      {cell('y', String(d.getFullYear()))}
      <Press onPress={() => onChange(Date.now())} style={[s.today, { borderColor: t.panelBorder }]}>
        <Text style={[s.segText, { color: t.textDim }]}>TODAY</Text>
      </Press>
    </View>
  );
}

export const ls = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  sheet: { borderWidth: 1, borderRadius: 10, padding: 28, maxHeight: '96%' },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 20 },
  title: { fontFamily: 'Oxanium', fontSize: 30, fontWeight: '800', letterSpacing: 2 },
  close: { fontFamily: 'JetBrains Mono', fontSize: 18, letterSpacing: 2 },
  label: { fontFamily: 'JetBrains Mono', fontSize: 16, letterSpacing: 3 },
  hint: { fontFamily: 'JetBrains Mono', fontSize: 15, lineHeight: 22 },
  big: { minHeight: 84, borderWidth: 2, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  bigText: { fontFamily: 'Oxanium', fontSize: 24, fontWeight: '800', letterSpacing: 2 },
});

const s = StyleSheet.create({
  pad: { width: 360, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  key: { width: 113, height: 84, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontFamily: 'Oxanium', fontSize: 36, fontWeight: '700' },
  field: { borderWidth: 2, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 18, minHeight: 84 },
  fieldLabel: { fontFamily: 'JetBrains Mono', fontSize: 15, letterSpacing: 3 },
  fieldValue: { fontFamily: 'Oxanium', fontSize: 38, fontWeight: '700', marginTop: 2 },
  fieldSuffix: { fontFamily: 'Oxanium', fontSize: 20, fontWeight: '600' },
  fieldHint: { fontFamily: 'JetBrains Mono', fontSize: 14, letterSpacing: 1, marginTop: 2 },
  seg: { flexDirection: 'row', gap: 12 },
  segBtn: { flex: 1, minHeight: 72, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  segText: { fontFamily: 'Oxanium', fontSize: 20, fontWeight: '700', letterSpacing: 2 },
  dateRow: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  dateCell: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateBtn: { width: 64, height: 72, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dateArrow: { fontFamily: 'Oxanium', fontSize: 34, fontWeight: '700' },
  dateText: { fontFamily: 'Oxanium', fontSize: 26, fontWeight: '700', minWidth: 72, textAlign: 'center' },
  today: { height: 72, borderWidth: 1, borderRadius: 8, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
});
