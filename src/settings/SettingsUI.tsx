/**
 * Settings overlay — mounted at the app level (a sibling of HomeScreen), NOT inside
 * any data-rendering component, so swapping the data source still touches zero
 * components. Toggles source mode (sim ↔ live), shows per-tier connection status
 * read straight off the Signal statuses, and exposes the live-only controls:
 * IMU calibration, OBD connect, and the media notification-access grant.
 *
 * Opened via useOpenSettings() (the Dock's SET tile calls it).
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme, useThemeMode } from '../theme/ThemeProvider';
import { shallowEqual, useSourceControls, useTelemetry } from '../data/DataSourceProvider';
import type { SignalStatus } from '../data/types';
import type { ObdDevice } from '../data/live/obd/transport';
import { useDock } from '../dock/DockConfig';
import { MAX_DOCK_TILES, type DockTile } from '../dock/defaults';
import type { ThemeMode } from '../data/settings';

const SettingsUIContext = createContext<{ open: () => void }>({ open: () => {} });
export const useOpenSettings = () => useContext(SettingsUIContext).open;

export function SettingsUIProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  return (
    <SettingsUIContext.Provider value={{ open: () => setVisible(true) }}>
      {children}
      <SettingsSheet visible={visible} onClose={() => setVisible(false)} />
    </SettingsUIContext.Provider>
  );
}

function statusColor(s: SignalStatus, t: ReturnType<typeof useTheme>): string {
  return s === 'live' ? t.accent : s === 'stale' ? t.textDim : t.absent;
}
const statusLabel = (s: SignalStatus) => (s === 'live' ? 'LIVE' : s === 'stale' ? 'STALE' : 'ABSENT');

function SettingsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  // select ONLY the slow status values — the sheet must not reconcile 30x/sec under
  // the scroll gesture (that was the "SET scroll is janky" cause; see the audit).
  const status = useTelemetry(
    (d) => ({
      gpsFix: d.system.gpsFix,
      sensorsOnline: d.system.sensorsOnline,
      obdConnected: d.obd.connected,
      speedStatus: d.motion.speedMph.status,
      gStatus: d.motion.longG.status,
      rpmStatus: d.obd.rpm.status,
      mediaStatus: d.media.nowPlaying.status,
    }),
    shallowEqual
  );
  const { mode, setMode, live } = useSourceControls();
  const { mode: themeMode, setMode: setThemeMode } = useThemeMode();
  const { tiles, setTiles, reset: resetDock } = useDock();
  const isWeb = Platform.OS === 'web';

  const updateTile = (i: number, patch: Partial<DockTile>) =>
    setTiles(tiles.map((tile, idx) => (idx === i ? { ...tile, ...patch } : tile)));
  const moveTile = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= tiles.length) return;
    const next = tiles.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setTiles(next);
  };
  const removeTile = (i: number) => setTiles(tiles.filter((_, idx) => idx !== i));
  const addTile = () =>
    setTiles([...tiles, { id: `tile-${Date.now()}-${tiles.length}`, label: 'APP', url: '' }]);

  const [devices, setDevices] = useState<ObdDevice[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setNote(null);
      setBusy(null);
    }
  }, [visible]);

  const run = async (key: string, fn: () => Promise<void>, okMsg?: string) => {
    setBusy(key);
    setNote(null);
    try {
      await fn();
      if (okMsg) setNote(okMsg);
    } catch (e: any) {
      setNote(`✗ ${e?.message ?? String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const tierRows: { label: string; status: SignalStatus; detail: string }[] = [
    {
      label: 'GPS / MOTION',
      status: status.speedStatus,
      detail: status.gpsFix ? 'fix acquired' : 'no fix',
    },
    {
      label: 'SENSORS (G)',
      status: status.gStatus,
      detail: status.sensorsOnline ? 'online' : 'offline',
    },
    {
      label: 'OBD2',
      status: status.rpmStatus,
      detail: status.obdConnected ? 'connected' : 'not connected',
    },
    {
      label: 'MEDIA (BT)',
      status: status.mediaStatus,
      detail: live ? (live.hasMediaAccess() ? 'access granted' : 'needs access') : 'simulated',
    },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: t.bg, borderColor: t.panelBorder }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: t.accent }]}>SETTINGS</Text>
            <Pressable hitSlop={16} onPress={onClose}>
              <Text style={[styles.close, { color: t.textDim }]}>CLOSE ✕</Text>
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 820 }} contentContainerStyle={{ gap: 18 }}>
            {/* source mode */}
            <Section t={t} title="DATA SOURCE">
              <View style={styles.toggleRow}>
                {(['sim', 'live'] as const).map((m) => {
                  const active = mode === m;
                  return (
                    <Pressable
                      key={m}
                      onPress={() => setMode(m)}
                      style={[
                        styles.toggle,
                        { borderColor: active ? t.accent : t.panelBorder, backgroundColor: active ? t.panel : 'transparent' },
                      ]}
                    >
                      <Text style={[styles.toggleText, { color: active ? t.accent : t.textDim }]}>
                        {m === 'sim' ? 'SIMULATOR' : 'LIVE'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {isWeb && (
                <Text style={[styles.hint, { color: t.textFaint }]}>
                  Live mode needs a device dev build — on web it stays simulated.
                </Text>
              )}
            </Section>

            {/* theme: light / auto / dark */}
            <Section t={t} title="THEME">
              <View style={styles.toggleRow}>
                {(['light', 'auto', 'dark'] as ThemeMode[]).map((m) => {
                  const active = themeMode === m;
                  return (
                    <Pressable
                      key={m}
                      onPress={() => setThemeMode(m)}
                      style={[
                        styles.toggle,
                        { borderColor: active ? t.accent : t.panelBorder, backgroundColor: active ? t.panel : 'transparent' },
                      ]}
                    >
                      <Text style={[styles.toggleText, { color: active ? t.accent : t.textDim }]}>{m.toUpperCase()}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={[styles.hint, { color: t.textFaint }]}>
                AUTO follows daylight (sunrise/sunset). LIGHT and DARK override it.
              </Text>
            </Section>

            {/* per-tier status */}
            <Section t={t} title="CONNECTION STATUS">
              {tierRows.map((r) => (
                <View key={r.label} style={styles.statusRow}>
                  <View style={[styles.dot, { backgroundColor: statusColor(r.status, t) }]} />
                  <Text style={[styles.statusLabel, { color: t.text }]}>{r.label}</Text>
                  <Text style={[styles.statusDetail, { color: t.textFaint }]}>{r.detail}</Text>
                  <Text style={[styles.statusValue, { color: statusColor(r.status, t) }]}>
                    {statusLabel(r.status)}
                  </Text>
                </View>
              ))}
            </Section>

            {/* dock customization */}
            <Section t={t} title="DOCK">
              <Text style={[styles.hint, { color: t.textFaint }]}>
                CarPlay and SET are pinned. Edit the app tiles — label + a launch link (deep-link /
                scheme, e.g. waze://, spotify://, geo:0,0). Tap a tile on the home screen to open it.
              </Text>
              {tiles.map((tile, i) => (
                <View key={tile.id} style={styles.dockRow}>
                  <TextInput
                    value={tile.label}
                    onChangeText={(v) => updateTile(i, { label: v.toUpperCase() })}
                    placeholder="LABEL"
                    placeholderTextColor={t.absent}
                    style={[styles.input, styles.labelInput, { color: t.text, borderColor: t.hairline }]}
                  />
                  <TextInput
                    value={tile.url}
                    onChangeText={(v) => updateTile(i, { url: v })}
                    placeholder="launch link (optional)"
                    placeholderTextColor={t.absent}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.input, { flex: 1, color: t.textDim, borderColor: t.hairline }]}
                  />
                  <Pressable onPress={() => moveTile(i, -1)} style={styles.iconBtn} hitSlop={6}>
                    <Text style={[styles.icon, { color: i === 0 ? t.absent : t.textDim }]}>▲</Text>
                  </Pressable>
                  <Pressable onPress={() => moveTile(i, 1)} style={styles.iconBtn} hitSlop={6}>
                    <Text style={[styles.icon, { color: i === tiles.length - 1 ? t.absent : t.textDim }]}>▼</Text>
                  </Pressable>
                  <Pressable onPress={() => removeTile(i)} style={styles.iconBtn} hitSlop={6}>
                    <Text style={[styles.icon, { color: t.warn }]}>✕</Text>
                  </Pressable>
                </View>
              ))}
              <View style={styles.btnRow}>
                {tiles.length < MAX_DOCK_TILES && <Btn t={t} label="+ ADD TILE" onPress={addTile} />}
                <Btn t={t} label="RESET DOCK" onPress={resetDock} />
              </View>
            </Section>

            {/* live-only controls */}
            {live && (
              <>
                <Section t={t} title="G-SENSOR CALIBRATION">
                  <Text style={[styles.hint, { color: t.textFaint }]}>
                    1) Park level, tap Calibrate Level. 2) On an open road, tap Forward and
                    accelerate straight for ~2s.
                  </Text>
                  <View style={styles.btnRow}>
                    <Btn
                      t={t}
                      label={busy === 'level' ? 'CAPTURING…' : 'CALIBRATE LEVEL'}
                      disabled={!!busy}
                      onPress={() => run('level', () => live.calibrateLevel(), '✓ level captured')}
                    />
                    <Btn
                      t={t}
                      label={busy === 'fwd' ? 'CAPTURING…' : 'FORWARD'}
                      disabled={!!busy}
                      onPress={() => run('fwd', () => live.calibrateForward(), '✓ forward captured')}
                    />
                  </View>
                </Section>

                <Section t={t} title="OBD2 ADAPTER">
                  {!status.obdConnected ? (
                    <>
                      <View style={styles.btnRow}>
                        <Btn
                          t={t}
                          label={busy === 'scan' ? 'SCANNING…' : 'FIND PAIRED'}
                          disabled={!!busy}
                          onPress={() =>
                            run('scan', async () => {
                              setDevices(await live.listObdDevices());
                            })
                          }
                        />
                        <Btn
                          t={t}
                          label={busy === 'connect' ? 'CONNECTING…' : 'CONNECT'}
                          disabled={!!busy}
                          onPress={() => run('connect', () => live.connectObd(), '✓ OBD connected')}
                        />
                      </View>
                      {devices.map((d) => (
                        <Pressable
                          key={d.address}
                          disabled={!!busy}
                          onPress={() => run('connect', () => live.connectObd(d.address), `✓ ${d.name}`)}
                          style={[styles.deviceRow, { borderColor: t.hairline }]}
                        >
                          <Text style={[styles.deviceName, { color: t.text }]}>{d.name || '(unnamed)'}</Text>
                          <Text style={[styles.deviceMac, { color: t.textFaint }]}>{d.address}</Text>
                        </Pressable>
                      ))}
                      <Text style={[styles.hint, { color: t.textFaint }]}>
                        Pair the dongle once in Android Bluetooth settings first, then Connect.
                      </Text>
                    </>
                  ) : (
                    <Btn t={t} label="DISCONNECT OBD" onPress={() => live.disconnectObd()} />
                  )}
                </Section>

                <Section t={t} title="MEDIA ACCESS">
                  <Text style={[styles.hint, { color: t.textFaint }]}>
                    Now-playing needs Notification access. If sideloaded, first allow restricted
                    settings for this app, then enable it here.
                  </Text>
                  <View style={styles.btnRow}>
                    <Btn t={t} label="GRANT ACCESS" onPress={() => live.openMediaSettings()} />
                    <Btn
                      t={t}
                      label={busy === 'media' ? '…' : 'REFRESH'}
                      disabled={!!busy}
                      onPress={() => run('media', () => live.refreshMedia(), '✓ refreshed')}
                    />
                  </View>
                </Section>
              </>
            )}

            {note && <Text style={[styles.note, { color: t.text }]}>{note}</Text>}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Section({ t, title, children }: { t: ReturnType<typeof useTheme>; title: string; children: React.ReactNode }) {
  return (
    <View style={[styles.section, { borderColor: t.hairline }]}>
      <Text style={[styles.sectionTitle, { color: t.textDim }]}>{title}</Text>
      <View style={{ gap: 12 }}>{children}</View>
    </View>
  );
}

function Btn({
  t,
  label,
  onPress,
  disabled,
}: {
  t: ReturnType<typeof useTheme>;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.btn, { borderColor: t.accent, opacity: disabled ? 0.4 : 1 }]}
    >
      <Text style={[styles.btnText, { color: t.accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  sheet: { width: 920, maxWidth: '92%', borderWidth: 1, borderRadius: 10, padding: 32 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontFamily: 'Oxanium', fontSize: 30, fontWeight: '800', letterSpacing: 2 },
  close: { fontFamily: 'JetBrains Mono', fontSize: 15, letterSpacing: 2 },
  section: { borderTopWidth: 1, paddingTop: 16 },
  sectionTitle: { fontFamily: 'JetBrains Mono', fontSize: 13, letterSpacing: 3, marginBottom: 12 },
  toggleRow: { flexDirection: 'row', gap: 16 },
  toggle: { flex: 1, borderWidth: 1, borderRadius: 6, paddingVertical: 18, alignItems: 'center' },
  toggleText: { fontFamily: 'Oxanium', fontSize: 20, fontWeight: '700', letterSpacing: 2 },
  hint: { fontFamily: 'JetBrains Mono', fontSize: 13, lineHeight: 19 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  statusLabel: { fontFamily: 'JetBrains Mono', fontSize: 15, letterSpacing: 1, width: 150 },
  statusDetail: { fontFamily: 'JetBrains Mono', fontSize: 13, flex: 1 },
  statusValue: { fontFamily: 'JetBrains Mono', fontSize: 14, letterSpacing: 1 },
  btnRow: { flexDirection: 'row', gap: 16 },
  btn: { flex: 1, borderWidth: 1, borderRadius: 6, paddingVertical: 16, alignItems: 'center' },
  btnText: { fontFamily: 'Oxanium', fontSize: 17, fontWeight: '700', letterSpacing: 1 },
  deviceRow: { borderWidth: 1, borderRadius: 6, padding: 14 },
  deviceName: { fontFamily: 'Oxanium', fontSize: 17, fontWeight: '600' },
  deviceMac: { fontFamily: 'JetBrains Mono', fontSize: 12, marginTop: 2 },
  note: { fontFamily: 'JetBrains Mono', fontSize: 14, marginTop: 4 },
  dockRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: {
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'JetBrains Mono',
    fontSize: 15,
  },
  labelInput: { width: 130, letterSpacing: 2 },
  iconBtn: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
  icon: { fontFamily: 'JetBrains Mono', fontSize: 18 },
});
