/**
 * SET → QUICK CONTROLS: brightness, media volume, Bluetooth / Wi-Fi status (deep-link
 * to toggle — apps can't flip radios on API 33), and screen-off timeout, so Android
 * Settings is rarely needed. Backed by modules/sys-controls; on web (or a dev client
 * without the module) everything renders disabled.
 *
 * Reads system state when the sheet opens and again whenever the app returns to the
 * foreground (e.g. back from the "Modify system settings" grant or the BT page).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { Press } from '../components/ui/Press';
import {
  TIMEOUT_NEVER,
  getSysState,
  openBluetoothSettings,
  openWifiSettings,
  requestWriteSettings,
  setBrightness,
  setFontScale,
  setScreenTimeout,
  setVolume,
  sysControlsAvailable,
  type SysState,
} from '../../modules/sys-controls';
import { Slider } from '../components/ui/Slider';
import { Btn } from './parts';
import type { Theme } from '../theme/themes';

const TEXT_SIZES: { label: string; scale: number }[] = [
  { label: 'NORMAL', scale: 1.0 },
  { label: 'LARGE', scale: 1.15 },
  { label: 'X-LARGE', scale: 1.3 },
];

const TIMEOUTS: { label: string; ms: number }[] = [
  { label: '1 MIN', ms: 60_000 },
  { label: '5 MIN', ms: 300_000 },
  { label: '30 MIN', ms: 1_800_000 },
  { label: 'NEVER', ms: TIMEOUT_NEVER },
];

export function QuickControls({ t, visible }: { t: Theme; visible: boolean }) {
  const [s, setS] = useState<SysState | null>(null);
  const [bright, setBright] = useState(0.5);
  const [vol, setVol] = useState(0.5);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const next = getSysState();
    setS(next);
    if (next) {
      setBright(next.brightness);
      setVol(next.volume);
    }
  }, []);

  useEffect(() => {
    if (visible) refresh();
  }, [visible, refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const guard = (fn: () => void) => {
    try {
      fn();
      setNote(null);
    } catch (e: any) {
      setNote(`✗ ${e?.message ?? String(e)}`);
      refresh();
    }
  };

  const avail = sysControlsAvailable && s != null;
  const canWrite = avail && s!.canWriteSettings;
  const steps = s?.volumeSteps ?? 15;

  return (
    <>
      {!sysControlsAvailable && (
        <Text allowFontScaling={false} style={[styles.hint, { color: t.textFaint }]}>
          System controls run on the head unit — shown disabled in this preview.
        </Text>
      )}

      <ControlRow t={t} label="BRIGHTNESS" value={avail ? `${Math.round(bright * 100)}%` : '—'}>
        <Slider
          t={t}
          value={bright}
          disabled={!canWrite}
          onChange={(v) => {
            setBright(v);
            guard(() => setBrightness(v));
          }}
        />
      </ControlRow>
      {avail && !canWrite && (
        <View style={styles.btnRow}>
          <Btn t={t} label="ALLOW BRIGHTNESS, TEXT SIZE + TIMEOUT" onPress={requestWriteSettings} />
        </View>
      )}

      <ControlRow t={t} label="VOLUME" value={avail ? `${Math.round(vol * steps)} / ${steps}` : '—'}>
        <Slider
          t={t}
          value={vol}
          disabled={!avail}
          onChange={(v) => {
            // snap to the stream's real steps so the readout never lies
            const snapped = Math.round(v * steps) / steps;
            if (snapped === vol) return;
            setVol(snapped);
            guard(() => setVolume(snapped));
          }}
        />
      </ControlRow>

      <RadioRow t={t} label="BLUETOOTH" on={avail ? s!.bluetoothOn : null} disabled={!avail} onOpen={() => void openBluetoothSettings().catch(() => {})} />
      <RadioRow t={t} label="WI-FI" on={avail ? s!.wifiOn : null} disabled={!avail} onOpen={() => void openWifiSettings().catch(() => {})} />

      <Text allowFontScaling={false} style={[styles.rowLabel, { color: t.text, marginTop: 4 }]}>ANDROID TEXT SIZE</Text>
      <Text allowFontScaling={false} style={[styles.hint, { color: t.textFaint }]}>
        Other Android screens only — the dash is laid out at fixed sizes and ignores this (it used to push
        things off the cards). Set NORMAL to undo a change.
      </Text>
      <View style={styles.chips}>
        {TEXT_SIZES.map((o) => {
          const active = avail && Math.abs((s!.fontScale ?? 1) - o.scale) < 0.03;
          return (
            <Press
              key={o.label}
              disabled={!avail}
              onPress={() =>
                // not granted yet → the tap opens Android's "Modify system settings" page
                // (they used to sit greyed out with no hint why — 2026-10-26)
                !canWrite
                  ? requestWriteSettings()
                  : guard(() => {
                      setFontScale(o.scale);
                      setS((cur) => (cur ? { ...cur, fontScale: o.scale } : cur));
                    })
              }
              style={[
                styles.chip,
                {
                  borderColor: active ? t.accent : t.panelBorder,
                  backgroundColor: active ? t.panel : 'transparent',
                  opacity: canWrite ? 1 : avail ? 0.6 : 0.4,
                },
              ]}
            >
              <Text allowFontScaling={false} style={[styles.chipText, { color: active ? t.accent : t.textDim }]}>{o.label}</Text>
            </Press>
          );
        })}
      </View>

      <Text allowFontScaling={false} style={[styles.rowLabel, { color: t.text, marginTop: 4 }]}>SCREEN TIMEOUT</Text>
      <View style={styles.chips}>
        {TIMEOUTS.map((o) => {
          const active = avail && s!.screenTimeoutMs === o.ms;
          return (
            <Press
              key={o.label}
              disabled={!avail}
              onPress={() =>
                !canWrite
                  ? requestWriteSettings()
                  : guard(() => {
                      setScreenTimeout(o.ms);
                      setS((cur) => (cur ? { ...cur, screenTimeoutMs: o.ms } : cur));
                    })
              }
              style={[
                styles.chip,
                {
                  borderColor: active ? t.accent : t.panelBorder,
                  backgroundColor: active ? t.panel : 'transparent',
                  opacity: canWrite ? 1 : avail ? 0.6 : 0.4,
                },
              ]}
            >
              <Text allowFontScaling={false} style={[styles.chipText, { color: active ? t.accent : t.textDim }]}>{o.label}</Text>
            </Press>
          );
        })}
      </View>

      {note && <Text allowFontScaling={false} style={[styles.hint, { color: t.warn }]}>{note}</Text>}
    </>
  );
}

function ControlRow({ t, label, value, children }: { t: Theme; label: string; value: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.rowHead}>
        <Text allowFontScaling={false} style={[styles.rowLabel, { color: t.text }]}>{label}</Text>
        <Text allowFontScaling={false} style={[styles.rowValue, { color: t.accent }]}>{value}</Text>
      </View>
      {children}
    </View>
  );
}

function RadioRow({
  t,
  label,
  on,
  disabled,
  onOpen,
}: {
  t: Theme;
  label: string;
  on: boolean | null;
  disabled: boolean;
  onOpen: () => void;
}) {
  const color = on == null ? t.absent : on ? t.accent : t.textFaint;
  return (
    <View style={styles.radioRow}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text allowFontScaling={false} style={[styles.rowLabel, { color: t.text, flex: 1 }]}>{label}</Text>
      <Text allowFontScaling={false} style={[styles.radioState, { color }]}>{on == null ? '—' : on ? 'ON' : 'OFF'}</Text>
      <Btn t={t} label="OPEN ↗" onPress={onOpen} disabled={disabled} grow={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { fontFamily: 'JetBrains Mono', fontSize: 16, lineHeight: 23 },
  btnRow: { flexDirection: 'row', gap: 16 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  rowLabel: { fontFamily: 'JetBrains Mono', fontSize: 18, letterSpacing: 2 },
  rowValue: { fontFamily: 'Oxanium', fontSize: 24, fontWeight: '700' },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 72 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  radioState: { fontFamily: 'JetBrains Mono', fontSize: 18, letterSpacing: 2, width: 60, textAlign: 'right' },
  chips: { flexDirection: 'row', gap: 12 },
  chip: { flex: 1, height: 72, borderWidth: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontFamily: 'Oxanium', fontSize: 18, fontWeight: '700', letterSpacing: 1 },
});
