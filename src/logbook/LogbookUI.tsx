/**
 * The logbook sheets: FILL-UP (one tap at the pump; numbers optional) and LOGBOOK
 * (SERVICE: what's due + back-logged history; FUEL: fill-ups, pump-honest mpg).
 * Opened from the HOME fuel card, the service nudge and SET. Data: logbookStore.
 *
 * Ease of use at a pump: FULL is the default and every field is PREFILLED (our estimate of
 * what went in, the last price, the estimated odometer), so SAVE alone is a valid entry.
 * Typing the pump's real gallons is what calibrates the MAF fuel math — but an untouched
 * estimate is saved as "not entered" so it can never calibrate us against ourselves.
 */
import React, { createContext, useContext, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../components/ui/Press';
import { useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/themes';
import { logbookStore, useLogbook } from '../data/logbookStore';
import {
  SERVICE_TYPES,
  dueText,
  fuelLeft,
  lastPrice,
  fillCost,
  odometerNow,
  pumpMpgs,
  serviceStatus,
  spending,
  usedCorrected,
  type Logbook,
} from '../lib/logbook';
import { useMpgLog } from '../data/mpgLogStore';
import { lifetimeMpg } from '../lib/mpgLog';
import { DateSteps, NumField, NumPad, Segmented, fmtDate, ls, numEdit, numValue, pressKey, type NumEdit } from './parts';

type Tab = 'service' | 'fuel';
interface Ctx {
  openFill: () => void;
  openLog: (tab?: Tab, serviceType?: string) => void;
}
const LogbookCtx = createContext<Ctx>({ openFill: () => {}, openLog: () => {} });
export const useLogbookUI = () => useContext(LogbookCtx);

export function LogbookProvider({ children }: { children: React.ReactNode }) {
  const [fill, setFill] = useState(false);
  const [log, setLog] = useState<{ tab: Tab; type?: string } | null>(null);
  const value = useMemo<Ctx>(
    () => ({
      openFill: () => setFill(true),
      openLog: (tab = 'service', type) => setLog({ tab, type }),
    }),
    []
  );
  return (
    <LogbookCtx.Provider value={value}>
      {children}
      {fill && <FillUpSheet onClose={() => setFill(false)} />}
      {log && <LogbookSheet initialTab={log.tab} initialType={log.type} onClose={() => setLog(null)} onAddFill={() => setFill(true)} />}
    </LogbookCtx.Provider>
  );
}

/** Re-render on every logbook change (sheets only — they're open briefly). */
const useWholeLogbook = () => useLogbook((lb) => ({ lb }), () => false).lb;

function Sheet({ t, title, width, onClose, right, children }: { t: Theme; title: string; width: number; onClose: () => void; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={ls.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[ls.sheet, { width, backgroundColor: t.bg, borderColor: t.panelBorder }]}>
          <View style={ls.headRow}>
            <Text style={[ls.title, { color: t.accent }]}>{title}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 24 }}>
              {right}
              <Press hitSlop={16} onPress={onClose}>
                <Text style={[ls.close, { color: t.textDim }]}>CLOSE ✕</Text>
              </Press>
            </View>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

// ---- FILL-UP --------------------------------------------------------------------------
type FillField = 'gal' | 'money' | 'odo';

function FillUpSheet({ onClose }: { onClose: () => void }) {
  const t = useTheme();
  const lb = useWholeLogbook();
  const hasPrev = lb.levelAtFill != null;
  const est = hasPrev ? Math.round(usedCorrected(lb) * 10) / 10 : null;
  const prevPrice = lastPrice(lb);
  const [full, setFull] = useState<'full' | 'partial'>('full');
  const [gal, setGal] = useState<NumEdit>(() => numEdit(est));
  // the pump shows gallons, $/gal AND the total — enter whichever $ number is handy
  const [moneyMode, setMoneyMode] = useState<'price' | 'total'>('price');
  const [money, setMoney] = useState<NumEdit>(() => numEdit(prevPrice, 2));
  const [odo, setOdo] = useState<NumEdit>(() => numEdit(odometerNow(lb) != null ? Math.round(odometerNow(lb)!) : null, 0));
  const [active, setActive] = useState<FillField>('gal');

  const edits = { gal: [gal, setGal], money: [money, setMoney], odo: [odo, setOdo] } as const;
  const onKey = (k: string) => {
    const [e, set] = edits[active];
    set(pressKey(e, k, active === 'odo' ? 7 : 6));
  };
  const typedGal = !gal.fresh ? numValue(gal) : null;
  const galForMath = typedGal ?? numValue(gal);
  const moneyVal = numValue(money);
  const price = moneyMode === 'price' ? moneyVal : moneyVal != null && typedGal ? moneyVal / typedGal : null;
  const total = moneyMode === 'total' ? (!money.fresh ? moneyVal : null) : null;
  const shownTotal = moneyMode === 'total' ? moneyVal : galForMath != null && moneyVal != null ? galForMath * moneyVal : null;
  const partialNeedsGal = full === 'partial' && typedGal == null && total == null;
  const switchMoney = (m: 'price' | 'total') => {
    if (m === moneyMode) return;
    // carry the number across when we can (price ↔ total via the gallons)
    const g = galForMath;
    const v = numValue(money);
    const next = v == null || g == null || g <= 0 ? null : m === 'total' ? v * g : v / g;
    setMoney(numEdit(next != null ? Math.round(next * 100) / 100 : m === 'price' ? prevPrice : null, 2));
    setMoneyMode(m);
    setActive('money');
  };
  const save = () => {
    if (partialNeedsGal) return;
    logbookStore.fill({
      at: Date.now(),
      gallons: typedGal, // untouched estimate = not entered (never self-calibrates)
      full: full === 'full',
      pricePerGal: price != null && price > 0 ? Math.round(price * 1000) / 1000 : null,
      total,
      odometer: !odo.fresh ? numValue(odo) : null, // the estimate isn't a reading
    });
    onClose();
  };

  return (
    <Sheet t={t} title="FILL-UP" width={1180} onClose={onClose}>
      <View style={{ flexDirection: 'row', gap: 28 }}>
        <View style={{ flex: 1, gap: 14 }}>
          <Segmented
            t={t}
            value={full}
            onChange={setFull}
            options={[
              { id: 'full', label: 'FILLED TO FULL' },
              { id: 'partial', label: 'PARTIAL' },
            ]}
          />
          <NumField
            t={t}
            label="GALLONS FROM THE PUMP"
            edit={gal}
            active={active === 'gal'}
            onFocus={() => setActive('gal')}
            suffix="gal"
            hint={
              gal.fresh
                ? gal.text
                  ? 'OUR GUESS · TYPE THE PUMP’S GALLONS (E.G. 17.5) ON THE KEYPAD'
                  : partialNeedsGal
                    ? 'NEEDED FOR A PARTIAL FILL'
                    : 'TYPE THE PUMP’S GALLONS ON THE KEYPAD'
                : 'FROM THE PUMP ✓'
            }
          />
          <View style={{ flexDirection: 'row', gap: 14 }}>
            <View style={{ flex: 1, gap: 8 }}>
              <Segmented
                t={t}
                value={moneyMode}
                onChange={switchMoney}
                options={[
                  { id: 'price', label: '$ / GAL' },
                  { id: 'total', label: 'TOTAL $' },
                ]}
              />
              <NumField
                t={t}
                label={moneyMode === 'price' ? 'PRICE PER GALLON' : 'TOTAL PAID'}
                edit={money}
                active={active === 'money'}
                onFocus={() => setActive('money')}
                prefix="$"
                hint={
                  moneyMode === 'price'
                    ? shownTotal != null
                      ? `= $${shownTotal.toFixed(2)} TOTAL`
                      : 'OPTIONAL'
                    : price != null
                      ? `= $${price.toFixed(3)} / GAL`
                      : 'OPTIONAL'
                }
              />
            </View>
            <View style={{ flex: 1.1 }}>
              <NumField
                t={t}
                label="ODOMETER"
                edit={odo}
                active={active === 'odo'}
                onFocus={() => setActive('odo')}
                suffix="mi"
                thousands
                hint={odo.fresh ? (odo.text ? 'ESTIMATE · TYPE THE DASH READING' : 'OPTIONAL · ENABLES SERVICE REMINDERS') : 'DASH READING ✓'}
              />
            </View>
          </View>
          <Press onPress={save} disabled={partialNeedsGal} style={[ls.big, { borderColor: t.accent, backgroundColor: t.panel, opacity: partialNeedsGal ? 0.4 : 1 }]}>
            <Text style={[ls.bigText, { color: t.accent }]}>SAVE FILL-UP</Text>
          </Press>
        </View>
        <NumPad t={t} onKey={onKey} decimals={active !== 'odo'} />
      </View>
    </Sheet>
  );
}

// ---- LOGBOOK (service + fuel) -----------------------------------------------------------
function LogbookSheet({ initialTab, initialType, onClose, onAddFill }: { initialTab: Tab; initialType?: string; onClose: () => void; onAddFill: () => void }) {
  const t = useTheme();
  const lb = useWholeLogbook();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [form, setForm] = useState<string[] | null>(initialType ? [initialType] : null);
  const [odoEdit, setOdoEdit] = useState<NumEdit | null>(null);
  const odo = odometerNow(lb);

  const tabs = (
    <View style={{ width: 420 }}>
      <Segmented
        t={t}
        value={tab}
        onChange={(v) => {
          setTab(v);
          setForm(null);
        }}
        options={[
          { id: 'service', label: 'SERVICE' },
          { id: 'fuel', label: 'FUEL' },
        ]}
      />
    </View>
  );

  return (
    <Sheet t={t} title="LOGBOOK" width={1500} onClose={onClose} right={tabs}>
      {/* odometer: the anchor for every mileage-based reminder */}
      <View style={[st.odoRow, { borderColor: t.hairline }]}>
        <Text style={[ls.label, { color: t.textFaint }]}>ODOMETER</Text>
        {odoEdit ? (
          <View style={{ flexDirection: 'row', gap: 20, alignItems: 'flex-start', flex: 1 }}>
            <View style={{ flex: 1, gap: 12 }}>
              <NumField t={t} label="DASH READING" edit={odoEdit} active onFocus={() => {}} suffix="mi" thousands />
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Press
                  onPress={() => {
                    const v = numValue(odoEdit);
                    if (v != null && v > 0) logbookStore.odometer(v);
                    setOdoEdit(null);
                  }}
                  style={[ls.big, { flex: 1, borderColor: t.accent }]}
                >
                  <Text style={[ls.bigText, { color: t.accent }]}>SAVE</Text>
                </Press>
                <Press onPress={() => setOdoEdit(null)} style={[ls.big, { flex: 1, borderColor: t.panelBorder }]}>
                  <Text style={[ls.bigText, { color: t.textDim }]}>CANCEL</Text>
                </Press>
              </View>
            </View>
            <NumPad t={t} decimals={false} onKey={(k) => setOdoEdit((e) => (e ? pressKey(e, k, 7) : e))} />
          </View>
        ) : (
          <>
            <Text style={[st.odoValue, { color: odo == null ? t.absent : t.text }]}>
              {odo == null ? 'NOT SET' : `≈ ${Math.round(odo).toLocaleString()} mi`}
            </Text>
            <Press onPress={() => setOdoEdit(numEdit(odo != null ? Math.round(odo) : null, 0))} style={[st.smallBtn, { borderColor: t.accent }]}>
              <Text style={[st.smallBtnText, { color: t.accent }]}>{odo == null ? 'SET' : 'UPDATE'}</Text>
            </Press>
          </>
        )}
      </View>

      {!odoEdit && tab === 'service' && (form ? <ServiceForm t={t} lb={lb} initialTypes={form} onDone={() => setForm(null)} /> : <ServiceTab t={t} lb={lb} onLog={(types) => setForm(types)} />)}
      {!odoEdit && tab === 'fuel' && <FuelTab t={t} lb={lb} onAddFill={onAddFill} />}
    </Sheet>
  );
}

const STATE_TEXT = { due: 'DUE', soon: 'SOON', ok: 'OK', never: 'NOT LOGGED', unknown: 'SET ODOMETER' } as const;

function ServiceTab({ t, lb, onLog }: { t: Theme; lb: Logbook; onLog: (types: string[]) => void }) {
  const status = serviceStatus(lb, Date.now());
  const [confirm, setConfirm] = useState<string | null>(null);
  const color = (s: keyof typeof STATE_TEXT) => (s === 'due' ? t.warn : s === 'soon' ? t.accent : s === 'ok' ? t.eco : t.textFaint);
  return (
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 16 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={[ls.hint, { color: t.textFaint, flex: 1 }]}>Tap an item to log it. Old service counts too — set its date with the arrows.</Text>
        <Press onPress={() => onLog([])} style={[st.smallBtn, { borderColor: t.accent }]}>
          <Text style={[st.smallBtnText, { color: t.accent }]}>+ LOG SERVICE</Text>
        </Press>
      </View>
      <View style={st.grid}>
        {status.map((r) => (
          <Press key={r.type.id} onPress={() => onLog([r.type.id])} style={[st.statusCard, { borderColor: r.state === 'due' ? t.warn : t.panelBorder, backgroundColor: t.panel }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[st.statusName, { color: t.text }]}>{r.type.label}</Text>
              <Text style={[st.chip, { color: color(r.state), borderColor: color(r.state) }]}>{STATE_TEXT[r.state]}</Text>
            </View>
            <Text style={[st.statusDue, { color: r.state === 'due' ? t.warn : t.textDim }]}>{dueText(r)}</Text>
            <Text style={[st.statusLast, { color: t.textFaint }]}>
              {r.last ? `LAST ${fmtDate(r.last.at)}${r.last.odometer != null ? ` · ${r.last.odometer.toLocaleString()} mi` : ''}` : 'NEVER LOGGED'}
            </Text>
          </Press>
        ))}
      </View>
      <Text style={[ls.label, { color: t.textFaint, marginTop: 6 }]}>HISTORY</Text>
      {lb.service.length === 0 ? (
        <Text style={[ls.hint, { color: t.absent }]}>— nothing logged yet</Text>
      ) : (
        [...lb.service].reverse().map((e) => (
          <View key={e.id} style={[st.histRow, { borderColor: t.hairline }]}>
            <Text style={[st.histDate, { color: t.textDim }]}>{fmtDate(e.at)}</Text>
            <Text style={[st.histOdo, { color: t.textDim }]}>{e.odometer != null ? `${e.odometer.toLocaleString()} mi` : '—'}</Text>
            <Text style={[st.histWhat, { color: t.text }]} numberOfLines={2}>
              {e.types.map((id) => SERVICE_TYPES.find((x) => x.id === id)?.label ?? id).join(' · ')}
              {e.note ? <Text style={{ color: t.textFaint }}>{`  — ${e.note}`}</Text> : null}
            </Text>
            <Text style={[st.histCost, { color: t.textDim }]}>{e.cost != null ? `$${e.cost.toFixed(0)}` : ''}</Text>
            <Press
              onPress={() => (confirm === e.id ? (logbookStore.deleteService(e.id), setConfirm(null)) : setConfirm(e.id))}
              style={[st.del, { borderColor: confirm === e.id ? t.warn : t.panelBorder }]}
            >
              <Text style={[st.delText, { color: confirm === e.id ? t.warn : t.textFaint }]}>{confirm === e.id ? 'DELETE?' : '✕'}</Text>
            </Press>
          </View>
        ))
      )}
    </ScrollView>
  );
}

type SvcField = 'odo' | 'cost';

function ServiceForm({ t, lb, initialTypes, onDone }: { t: Theme; lb: Logbook; initialTypes: string[]; onDone: () => void }) {
  const [at, setAt] = useState(Date.now());
  const [types, setTypes] = useState<string[]>(initialTypes);
  const [odo, setOdo] = useState<NumEdit>(() => numEdit(odometerNow(lb) != null ? Math.round(odometerNow(lb)!) : null, 0));
  const [cost, setCost] = useState<NumEdit>(numEdit(null));
  const [note, setNote] = useState('');
  const [active, setActive] = useState<SvcField>('odo');
  const isToday = Date.now() - at < 86_400_000;
  // an estimate is only right for TODAY; a back-dated entry needs its own reading
  const odoValue = odo.fresh && !isToday ? null : numValue(odo);
  const save = () => {
    if (!types.length) return;
    logbookStore.service({ at, odometer: odoValue, types, note, cost: numValue(cost) });
    onDone();
  };
  return (
    <View style={{ flexDirection: 'row', gap: 28, flexShrink: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 14 }}>
        <Text style={[ls.label, { color: t.textFaint }]}>WHAT WAS DONE</Text>
        <View style={st.types}>
          {SERVICE_TYPES.map((ty) => {
            const on = types.includes(ty.id);
            return (
              <Press
                key={ty.id}
                onPress={() => setTypes((cur) => (on ? cur.filter((x) => x !== ty.id) : [...cur, ty.id]))}
                style={[st.typeChip, { borderColor: on ? t.accent : t.panelBorder, backgroundColor: on ? t.panel : 'transparent' }]}
              >
                <Text style={[st.typeText, { color: on ? t.accent : t.textDim }]}>{ty.label}</Text>
              </Press>
            );
          })}
        </View>
        <Text style={[ls.label, { color: t.textFaint }]}>WHEN</Text>
        <DateSteps t={t} at={at} onChange={setAt} />
        <View style={{ flexDirection: 'row', gap: 14 }}>
          <View style={{ flex: 1.3 }}>
            <NumField
              t={t}
              label="ODOMETER"
              edit={odo}
              active={active === 'odo'}
              onFocus={() => setActive('odo')}
              suffix="mi"
              thousands
              hint={odo.fresh ? (isToday ? (odo.text ? 'ESTIMATE · TYPE THE DASH READING' : 'OPTIONAL') : 'TYPE THE READING FROM THAT DAY') : 'DASH READING'}
            />
          </View>
          <View style={{ flex: 1 }}>
            <NumField t={t} label="COST" edit={cost} active={active === 'cost'} onFocus={() => setActive('cost')} prefix="$" hint="OPTIONAL" />
          </View>
        </View>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Note (shop, parts, oil brand…) — optional"
          placeholderTextColor={t.textFaint}
          style={[st.note, { color: t.text, borderColor: t.panelBorder, backgroundColor: t.panel }]}
        />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Press onPress={save} disabled={!types.length} style={[ls.big, { flex: 2, borderColor: t.accent, opacity: types.length ? 1 : 0.4 }]}>
            <Text style={[ls.bigText, { color: t.accent }]}>SAVE SERVICE</Text>
          </Press>
          <Press onPress={onDone} style={[ls.big, { flex: 1, borderColor: t.panelBorder }]}>
            <Text style={[ls.bigText, { color: t.textDim }]}>CANCEL</Text>
          </Press>
        </View>
      </ScrollView>
      <NumPad
        t={t}
        decimals={active === 'cost'}
        onKey={(k) => (active === 'odo' ? setOdo((e) => pressKey(e, k, 7)) : setCost((e) => pressKey(e, k, 7)))}
      />
    </View>
  );
}

function FuelTab({ t, lb, onAddFill }: { t: Theme; lb: Logbook; onAddFill: () => void }) {
  const left = fuelLeft(lb);
  const honest = pumpMpgs(lb);
  const life = useMpgLog((log) => lifetimeMpg(log));
  const sp = spending(lb, Date.now(), life);
  const [confirm, setConfirm] = useState<string | null>(null);
  const money = (label: string, v: string | null) => (
    <View style={st.spend}>
      <Text style={[st.spendVal, { color: v ? t.text : t.absent }]}>{v ?? '—'}</Text>
      <Text style={[ls.label, { color: t.textFaint }]}>{label}</Text>
    </View>
  );
  return (
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 14 }}>
      {/* what driving actually costs — from the pump numbers you enter */}
      <View style={[st.spendRow, { borderColor: t.hairline }]}>
        {money('SPENT THIS MONTH', sp.costedFills ? `$${sp.month.toFixed(2)}` : null)}
        {money('LAST 30 DAYS', sp.costedFills ? `$${sp.last30.toFixed(2)}` : null)}
        {money('COST PER MILE', sp.perMile != null ? `$${sp.perMile.toFixed(2)}` : null)}
        {money('AVG PRICE', sp.avgPrice != null ? `$${sp.avgPrice.toFixed(2)}` : null)}
        {money(honest.length ? 'PUMP MPG' : 'EST MPG', sp.mpg != null ? sp.mpg.toFixed(1) : null)}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 20 }}>
        <Text style={[ls.hint, { color: t.textDim, flex: 1 }]}>
          {left ? `TANK ≈ ${left.gallons.toFixed(1)} gal (${Math.round(left.pct)}%)` : 'TANK — log a fill-up to start'}
          {lb.calib != null ? `   ·   PUMP CALIBRATION ×${lb.calib.toFixed(2)} (${lb.calibSamples.length} fill${lb.calibSamples.length === 1 ? '' : 's'})` : '   ·   two FULL fills with pump gallons calibrate the estimate'}
          {honest.length ? `   ·   PUMP MPG ${honest[0].mpg.toFixed(1)}` : ''}
        </Text>
        <Press onPress={onAddFill} style={[st.smallBtn, { borderColor: t.accent }]}>
          <Text style={[st.smallBtnText, { color: t.accent }]}>+ ADD FILL-UP</Text>
        </Press>
      </View>
      {lb.fills.length === 0 ? (
        <Text style={[ls.hint, { color: t.absent }]}>— no fill-ups yet</Text>
      ) : (
        [...lb.fills].reverse().map((f) => {
          const mpg = honest.find((h) => h.at === f.at)?.mpg;
          return (
            <View key={f.id} style={[st.histRow, { borderColor: t.hairline }]}>
              <Text style={[st.histDate, { color: t.textDim }]}>{fmtDate(f.at)}</Text>
              <Text style={[st.histOdo, { color: t.text }]}>{f.gallons != null ? `${f.gallons.toFixed(2)} gal` : 'gal —'}</Text>
              <Text style={[st.histWhat, { color: t.textDim }]}>
                {f.full ? 'FULL' : 'PARTIAL'}
                {f.pricePerGal != null ? `  ·  $${f.pricePerGal.toFixed(2)}/gal` : ''}
                {fillCost(f) != null ? `  ·  $${fillCost(f)!.toFixed(2)}` : ''}
                {f.miles > 0 ? `  ·  ${Math.round(f.miles)} mi since last` : ''}
              </Text>
              <Text style={[st.histCost, { color: mpg != null ? t.eco : t.textFaint }]}>{mpg != null ? `${mpg.toFixed(1)} mpg` : ''}</Text>
              <Press
                onPress={() => (confirm === f.id ? (logbookStore.deleteFill(f.id), setConfirm(null)) : setConfirm(f.id))}
                style={[st.del, { borderColor: confirm === f.id ? t.warn : t.panelBorder }]}
              >
                <Text style={[st.delText, { color: confirm === f.id ? t.warn : t.textFaint }]}>{confirm === f.id ? 'DELETE?' : '✕'}</Text>
              </Press>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  spendRow: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, paddingBottom: 14 },
  spend: { gap: 2 },
  spendVal: { fontFamily: 'Oxanium', fontSize: 40, fontWeight: '700' },
  odoRow: { flexDirection: 'row', alignItems: 'center', gap: 20, borderBottomWidth: 1, paddingBottom: 14, marginBottom: 14 },
  odoValue: { fontFamily: 'Oxanium', fontSize: 30, fontWeight: '700', flex: 1 },
  smallBtn: { minHeight: 64, borderWidth: 1, borderRadius: 8, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  smallBtnText: { fontFamily: 'Oxanium', fontSize: 18, fontWeight: '700', letterSpacing: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  statusCard: { width: 466, borderWidth: 1, borderRadius: 8, padding: 16, gap: 4 },
  statusName: { fontFamily: 'Oxanium', fontSize: 22, fontWeight: '700' },
  chip: { fontFamily: 'JetBrains Mono', fontSize: 14, letterSpacing: 2, borderWidth: 1, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2 },
  statusDue: { fontFamily: 'Oxanium', fontSize: 20, fontWeight: '600' },
  statusLast: { fontFamily: 'JetBrains Mono', fontSize: 14, letterSpacing: 1 },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 16, borderBottomWidth: 1, paddingVertical: 10 },
  histDate: { width: 150, fontFamily: 'JetBrains Mono', fontSize: 16 },
  histOdo: { width: 150, fontFamily: 'JetBrains Mono', fontSize: 16 },
  histWhat: { flex: 1, fontFamily: 'Oxanium', fontSize: 18, fontWeight: '600' },
  histCost: { width: 110, textAlign: 'right', fontFamily: 'JetBrains Mono', fontSize: 16 },
  del: { minWidth: 72, height: 56, borderWidth: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  delText: { fontFamily: 'JetBrains Mono', fontSize: 15, letterSpacing: 1 },
  types: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  typeChip: { minHeight: 64, borderWidth: 1, borderRadius: 8, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  typeText: { fontFamily: 'Oxanium', fontSize: 18, fontWeight: '700' },
  note: { minHeight: 64, borderWidth: 1, borderRadius: 8, paddingHorizontal: 16, fontFamily: 'JetBrains Mono', fontSize: 17 },
});
