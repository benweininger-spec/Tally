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
import { Press } from '../components/ui/Press';
import { useTheme, useThemeMode } from '../theme/ThemeProvider';
import { shallowEqual, useDataSource, useSourceControls, useTelemetry } from '../data/DataSourceProvider';
import { SimulatedDataSource } from '../data/SimulatedDataSource';
import type { SignalStatus } from '../data/types';
import type { ObdDevice } from '../data/live/obd/transport';
import type { LiveControls, LiveStatus } from '../data/live/LiveDataSource';
import type { ObdDiagnostics } from '../data/live/obd/ObdManager';
import { PID_FEEDS, hexPid, type PidHealth } from '../lib/obdDiag';
import { useDock } from '../dock/DockConfig';
import { useAppDrawer } from '../apps/AppsProvider';
import { useLogbookUI } from '../logbook/LogbookUI';
import { MAX_DOCK_TILES, type DockTile } from '../dock/defaults';
import type { ThemeMode } from '../data/settings';
import { Btn, Section } from './parts';
import { QuickControls } from './QuickControls';
import { useMotionPref } from './MotionPref';
import { ThemePreview } from './ThemePreview';

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
  const { openLog } = useLogbookUI();
  const { mode: themeMode, setMode: setThemeMode } = useThemeMode();
  const { reduced: reducedMotion, setReduced: setReducedMotion } = useMotionPref();
  const [preview, setPreview] = useState(false);
  const { tiles, setTiles, reset: resetDock } = useDock();
  const { setOpen: setDrawerOpen } = useAppDrawer();
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
  const addLinkTile = () =>
    setTiles([...tiles, { id: `tile-${Date.now()}-${tiles.length}`, label: 'LINK', url: '' }]);
  const pickApps = () => {
    onClose();
    setDrawerOpen(true);
  };

  const [devices, setDevices] = useState<ObdDevice[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setNote(null);
      setBusy(null);
      setPreview(false);
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
      {/* No Pressable may sit ABOVE the ScrollView in the touch chain: on the unit a
          real finger-drag was being swallowed as a tap (FACT, 2026-10-21). The scrim
          tap-to-close is a sibling underneath the sheet, and the sheet is a plain View. */}
      <View style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: t.bg, borderColor: t.panelBorder }]}>
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: t.accent }]}>SETTINGS</Text>
            <Press hitSlop={16} onPress={onClose}>
              <Text style={[styles.close, { color: t.textDim }]}>CLOSE ✕</Text>
            </Press>
          </View>

          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 18 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {/* system quick controls first — the thing reached for most while driving */}
            <Section t={t} title="QUICK CONTROLS">
              <QuickControls t={t} visible={visible} />
            </Section>

            {/* fill-ups + service history (the truck's logbook) */}
            <Section t={t} title="LOGBOOK">
              <View style={styles.toggleRow}>
                <Btn t={t} label="SERVICE + MAINTENANCE" onPress={() => { onClose(); openLog('service'); }} />
                <Btn t={t} label="FUEL + FILL-UPS" onPress={() => { onClose(); openLog('fuel'); }} />
              </View>
            </Section>

            {/* source mode */}
            <Section t={t} title="DATA SOURCE">
              <View style={styles.toggleRow}>
                {(['sim', 'live'] as const).map((m) => {
                  const active = mode === m;
                  return (
                    <Press
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
                    </Press>
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
                    <Press
                      key={m}
                      onPress={() => setThemeMode(m)}
                      style={[
                        styles.toggle,
                        { borderColor: active ? t.accent : t.panelBorder, backgroundColor: active ? t.panel : 'transparent' },
                      ]}
                    >
                      <Text style={[styles.toggleText, { color: active ? t.accent : t.textDim }]}>{m.toUpperCase()}</Text>
                    </Press>
                  );
                })}
              </View>
              <Text style={[styles.hint, { color: t.textFaint }]}>
                AUTO follows your headlights (then daylight) with a slow 30 s fade. LIGHT and DARK override it.
              </Text>
              <View style={styles.btnRow}>
                <Btn t={t} label={preview ? 'HIDE SPLIT PREVIEW' : 'SHOW DAY / NIGHT SPLIT'} onPress={() => setPreview((v) => !v)} />
              </View>
              {preview && <ThemePreview />}
            </Section>

            {/* motion: full / reduced (gates the decorative moments only) */}
            <Section t={t} title="MOTION">
              <View style={styles.toggleRow}>
                {([false, true] as const).map((r) => {
                  const active = !!reducedMotion === r;
                  return (
                    <Press
                      key={String(r)}
                      onPress={() => setReducedMotion(r)}
                      style={[
                        styles.toggle,
                        { borderColor: active ? t.accent : t.panelBorder, backgroundColor: active ? t.panel : 'transparent' },
                      ]}
                    >
                      <Text style={[styles.toggleText, { color: active ? t.accent : t.textDim }]}>
                        {r ? 'REDUCED' : 'FULL'}
                      </Text>
                    </Press>
                  );
                })}
              </View>
              <Text style={[styles.hint, { color: t.textFaint }]}>
                REDUCED skips the startup sweep and the OBD-connect animation. Instruments are unaffected.
              </Text>
            </Section>

            {/* sim-only knobs: exercise the dusk crossfade + OBD-connect moment without hardware */}
            {mode === 'sim' && <SimSection t={t} obdConnected={status.obdConnected} onClose={onClose} />}

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
                CarPlay, APPS and SET are pinned. To add an app, open APPS and hold its tile. Link
                tiles open a deep link instead (waze://, geo:0,0, …). Up to {MAX_DOCK_TILES} tiles.
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
                  {tile.package ? (
                    <Text numberOfLines={1} style={[styles.pkg, { color: t.textFaint }]}>
                      {tile.package}
                      {tile.url ? `  ·  ${tile.url}` : ''}
                    </Text>
                  ) : (
                    <TextInput
                      value={tile.url ?? ''}
                      onChangeText={(v) => updateTile(i, { url: v })}
                      placeholder="deep link, e.g. waze://"
                      placeholderTextColor={t.absent}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={[styles.input, { flex: 1, color: t.textDim, borderColor: t.hairline }]}
                    />
                  )}
                  <Press onPress={() => moveTile(i, -1)} style={styles.iconBtn} hitSlop={6}>
                    <Text style={[styles.icon, { color: i === 0 ? t.absent : t.textDim }]}>▲</Text>
                  </Press>
                  <Press onPress={() => moveTile(i, 1)} style={styles.iconBtn} hitSlop={6}>
                    <Text style={[styles.icon, { color: i === tiles.length - 1 ? t.absent : t.textDim }]}>▼</Text>
                  </Press>
                  <Press onPress={() => removeTile(i)} style={styles.iconBtn} hitSlop={6}>
                    <Text style={[styles.icon, { color: t.warn }]}>✕</Text>
                  </Press>
                </View>
              ))}
              <View style={styles.btnRow}>
                <Btn t={t} label="PICK APPS…" onPress={pickApps} />
                {tiles.length < MAX_DOCK_TILES && <Btn t={t} label="+ LINK TILE" onPress={addLinkTile} />}
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
                  <ObdAutoLine t={t} live={live} />
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
                        <Press
                          key={d.address}
                          disabled={!!busy}
                          onPress={() => run('connect', () => live.connectObd(d.address), `✓ ${d.name}`)}
                          style={[styles.deviceRow, { borderColor: t.hairline }]}
                        >
                          <Text style={[styles.deviceName, { color: t.text }]}>{d.name || '(unnamed)'}</Text>
                          <Text style={[styles.deviceMac, { color: t.textFaint }]}>{d.address}</Text>
                        </Press>
                      ))}
                      <Text style={[styles.hint, { color: t.textFaint }]}>
                        Pair the dongle once in Android Bluetooth settings, then Connect once. After
                        that it's remembered and reconnects by itself whenever the truck starts.
                      </Text>
                    </>
                  ) : (
                    <>
                      <Btn t={t} label="DISCONNECT OBD" onPress={() => live.disconnectObd()} />
                      <Text style={[styles.hint, { color: t.textFaint }]}>
                        Disconnecting pauses auto-connect until you tap Connect or the next ignition-on.
                      </Text>
                    </>
                  )}
                </Section>

                <Section t={t} title="OBD DIAGNOSTICS">
                  <ObdDiagnosticsView t={t} live={live} />
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
        </View>
      </View>
    </Modal>
  );
}

function SimSection({
  t,
  obdConnected,
  onClose,
}: {
  t: ReturnType<typeof useTheme>;
  obdConnected: boolean;
  onClose: () => void;
}) {
  const source = useDataSource();
  const sim = source instanceof SimulatedDataSource ? source : null;
  const [daylight, setDaylight] = useState<boolean | null>(sim?.getDaylightOverride() ?? null);
  if (!sim) return null;
  return (
    <Section t={t} title="SIMULATOR">
      <Text style={[styles.hint, { color: t.textFaint }]}>DAYLIGHT (drives THEME → AUTO and the night-face suggestion)</Text>
      <View style={styles.toggleRow}>
        {([null, true, false] as const).map((v) => (
          <Toggle
            t={t}
            key={String(v)}
            label={v == null ? 'CLOCK' : v ? 'DAY' : 'NIGHT'}
            active={daylight === v}
            onPress={() => {
              sim.setDaylightOverride(v);
              setDaylight(v);
            }}
          />
        ))}
      </View>
      <Text style={[styles.hint, { color: t.textFaint }]}>OBD DONGLE (plays the connect moment)</Text>
      <View style={styles.toggleRow}>
        <Toggle
          t={t}
          label="OBD ON"
          active={obdConnected}
          onPress={() => {
            // close the sheet first so the connect moment plays where you can see it
            onClose();
            setTimeout(() => sim.setObdConnected(true), 450);
          }}
        />
        <Toggle t={t} label="OBD OFF" active={!obdConnected} onPress={() => sim.setObdConnected(false)} />
      </View>
    </Section>
  );
}

function Toggle({
  t,
  label,
  active,
  onPress,
}: {
  t: ReturnType<typeof useTheme>;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Press
      onPress={onPress}
      style={[styles.toggle, { borderColor: active ? t.accent : t.panelBorder, backgroundColor: active ? t.panel : 'transparent' }]}
    >
      <Text style={[styles.toggleText, { color: active ? t.accent : t.textDim }]}>{label}</Text>
    </Press>
  );
}

/**
 * One line of OBD auto-connect state. Polls `live.getStatus()` once a second, and only
 * while the SET sheet is open — nothing here touches the telemetry stream.
 */
function ObdAutoLine({ t, live }: { t: ReturnType<typeof useTheme>; live: LiveControls }) {
  const [st, setSt] = useState<LiveStatus>(() => live.getStatus());
  useEffect(() => {
    const id = setInterval(() => setSt(live.getStatus()), 1000);
    return () => clearInterval(id);
  }, [live]);
  const secs = st.obdRetryInMs != null ? Math.ceil(st.obdRetryInMs / 1000) : null;
  const target = st.obdAdapterName ?? st.obdSavedMac ?? 'first paired OBD adapter';
  const line =
    st.obdAuto === 'connected'
      ? `AUTO-CONNECT · LINKED · ${target}`
      : st.obdAuto === 'connecting'
        ? `AUTO-CONNECT · DIALING ${target}…`
        : st.obdAuto === 'off'
          ? 'AUTO-CONNECT · PAUSED (tap CONNECT)'
          : st.obdAuto === 'no-adapter'
            ? `AUTO-CONNECT · NO PAIRED ADAPTER${secs != null ? ` · retry in ${secs}s` : ''}`
            : st.obdAuto === 'no-permission'
              ? 'AUTO-CONNECT · NEEDS BLUETOOTH PERMISSION (tap CONNECT once)'
              : `AUTO-CONNECT · WAITING FOR ${target}${secs != null ? ` · retry in ${secs}s` : ''}`;
  const color = st.obdAuto === 'connected' ? t.accent : st.obdAuto === 'off' ? t.textFaint : t.textDim;
  return (
    <View style={{ gap: 4 }}>
      <Text style={[styles.hint, { color }]}>{line}</Text>
      {st.obdAuto !== 'connected' && st.obdAuto !== 'off' && st.obdLastError ? (
        <Text numberOfLines={2} style={[styles.hint, { color: t.textFaint }]}>
          last try: {st.obdLastError}
        </Text>
      ) : null}
    </View>
  );
}

const HEALTH_TEXT: Record<PidHealth, string> = {
  ok: 'OK',
  slow: 'NOT RECENT',
  'no-data': 'NO DATA',
  unsupported: 'NOT ON THIS TRUCK',
  waiting: 'WAITING',
};

/**
 * What the truck answers, PID by PID: value + age when it works, "NOT ON THIS TRUCK" when
 * the ECU's support list leaves it out, "NO DATA" when it's listed but silent. Polls
 * `live.getObdDiagnostics()` once a second while SET is open only.
 */
function ObdDiagnosticsView({ t, live }: { t: ReturnType<typeof useTheme>; live: LiveControls }) {
  const [d, setD] = useState<ObdDiagnostics | null>(() => live.getObdDiagnostics());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      setD(live.getObdDiagnostics());
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [live]);
  if (!d) {
    return <Text style={[styles.hint, { color: t.textFaint }]}>No OBD link yet — shows each value once the dongle connects.</Text>;
  }
  const color = (h: PidHealth) => (h === 'ok' ? t.accent : h === 'unsupported' ? t.textFaint : h === 'waiting' ? t.textDim : t.warn);
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.hint, { color: t.textDim }]}>
        {d.adapter ?? 'adapter ?'} · protocol {d.protocol ?? '?'} · {d.pollHz} replies/s{d.fastReplies ? ' (fast mode)' : ''} · ECU{' '}
        {d.ecuAwake ? 'awake' : 'asleep (key off?)'}
      </Text>
      {d.rows.map((r) => (
        <View key={r.pid} style={[styles.diagRow, { borderColor: t.hairline }]}>
          <Text style={[styles.diagPid, { color: t.textFaint }]}>{hexPid(r.pid)}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.diagName, { color: t.text }]}>{r.label}</Text>
            {PID_FEEDS[r.pid] ? <Text style={[styles.diagFeeds, { color: t.textFaint }]}>{PID_FEEDS[r.pid]}</Text> : null}
          </View>
          <Text style={[styles.diagVal, { color: t.textDim }]}>
            {r.lastValue != null && r.lastAt != null ? `${Math.round(r.lastValue * 100) / 100} · ${Math.round((now - r.lastAt) / 1000)}s ago` : ''}
          </Text>
          <Text style={[styles.diagHealth, { color: color(r.health) }]}>{HEALTH_TEXT[r.health]}</Text>
        </View>
      ))}
      <Text style={[styles.hint, { color: t.textFaint }]}>
        Truck reports support for:{' '}
        {d.supportKnown ? d.supported.map(hexPid).join(' ') : 'unknown — the support query got no answer (key off when it connected?)'}
      </Text>
      <Text style={[styles.hint, { color: t.textFaint }]}>
        Transmission temp probe: {d.transProbe ? `answering (${d.transProbe})` : d.ecuAwake ? 'no answer yet' : 'waits for the engine'}
      </Text>
      <Text style={[styles.hint, { color: t.textFaint }]}>
        Fuel level (gauge cluster) probe: {d.fuelProbe ? `answering (${d.fuelProbe})` : d.ecuAwake ? 'no answer yet' : 'waits for the engine'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  diagRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, paddingVertical: 6 },
  diagPid: { width: 30, fontFamily: 'JetBrains Mono', fontSize: 16 },
  diagName: { fontFamily: 'Oxanium', fontSize: 19, fontWeight: '600' },
  diagFeeds: { fontFamily: 'JetBrains Mono', fontSize: 15, letterSpacing: 1 },
  diagVal: { width: 170, textAlign: 'right', fontFamily: 'JetBrains Mono', fontSize: 16 },
  diagHealth: { width: 170, textAlign: 'right', fontFamily: 'JetBrains Mono', fontSize: 16, letterSpacing: 1 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  sheet: { width: 920, maxWidth: '92%', maxHeight: '94%', borderWidth: 1, borderRadius: 10, padding: 32 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontFamily: 'Oxanium', fontSize: 30, fontWeight: '800', letterSpacing: 2 },
  close: { fontFamily: 'JetBrains Mono', fontSize: 18, letterSpacing: 2 },
  toggleRow: { flexDirection: 'row', gap: 16 },
  toggle: { flex: 1, borderWidth: 1, borderRadius: 6, paddingVertical: 18, alignItems: 'center' },
  toggleText: { fontFamily: 'Oxanium', fontSize: 20, fontWeight: '700', letterSpacing: 2 },
  hint: { fontFamily: 'JetBrains Mono', fontSize: 16, lineHeight: 19 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  statusLabel: { fontFamily: 'JetBrains Mono', fontSize: 18, letterSpacing: 1, width: 150 },
  statusDetail: { fontFamily: 'JetBrains Mono', fontSize: 16, flex: 1 },
  statusValue: { fontFamily: 'JetBrains Mono', fontSize: 17, letterSpacing: 1 },
  btnRow: { flexDirection: 'row', gap: 16 },
  deviceRow: { borderWidth: 1, borderRadius: 6, padding: 14 },
  deviceName: { fontFamily: 'Oxanium', fontSize: 17, fontWeight: '600' },
  deviceMac: { fontFamily: 'JetBrains Mono', fontSize: 15, marginTop: 2 },
  note: { fontFamily: 'JetBrains Mono', fontSize: 17, marginTop: 4 },
  dockRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: {
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'JetBrains Mono',
    fontSize: 18,
  },
  labelInput: { width: 170, letterSpacing: 2 },
  pkg: { flex: 1, fontFamily: 'JetBrains Mono', fontSize: 17, paddingHorizontal: 4 },
  iconBtn: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
  icon: { fontFamily: 'JetBrains Mono', fontSize: 18 },
});
