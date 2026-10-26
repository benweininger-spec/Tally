import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Press } from './ui/Press';
import { shallowEqual, useSourceControls, useTelemetry } from '../data/DataSourceProvider';
import type { NowPlaying } from '../data/types';
import { useTheme } from '../theme/ThemeProvider';
import { has } from '../data/types';
import { useRadio, type Band, type RadioControls, type RadioState } from '../radio/RadioProvider';
import type { LiveControls } from '../data/live/LiveDataSource';
import type { RadioPreset } from '../data/live/mediaBridge';

type MediaSource = 'bt' | 'radio';
type NpView = { title: string; artist: string; source: string; isPlaying: boolean; artUri: string | null } | null;

/** `presets` = show the radio's favourite tiles (HOME has the height; DRIVE's rail doesn't). */
export const MediaWidget = React.memo(function MediaWidget({ presets = true }: { presets?: boolean }) {
  const t = useTheme();
  const radio = useRadio();
  const { live } = useSourceControls();
  const [source, setSource] = useState<MediaSource>('bt');
  // select only the display fields — NOT positionMs/durationMs, which advance every
  // tick — so the media card wakes on track/play change, not 30x/sec.
  const np = useTelemetry<NpView>((d) => {
    const v = has(d.media.nowPlaying) ? d.media.nowPlaying.value : null;
    return v ? { title: v.title, artist: v.artist, source: v.source, isPlaying: v.isPlaying, artUri: v.artUri } : null;
  }, shallowEqual);

  return (
    <View style={[styles.card, { borderColor: t.panelBorder, backgroundColor: t.panel }]}>
      {/* BLUETOOTH / RADIO source toggle */}
      <View style={styles.sourceRow}>
        {(['bt', 'radio'] as MediaSource[]).map((s) => {
          const active = source === s;
          return (
            <Press
              key={s}
              onPress={() => setSource(s)}
              style={[styles.srcTab, { borderColor: active ? t.accent : t.panelBorder, backgroundColor: active ? t.panel : 'transparent' }]}
            >
              <Text allowFontScaling={false} style={[styles.srcText, { color: active ? t.accent : t.textDim }]}>
                {s === 'bt' ? 'BLUETOOTH' : 'RADIO'}
              </Text>
            </Press>
          );
        })}
      </View>

      {source === 'bt' ? (
        <BluetoothNowPlaying np={np} t={t} live={live} />
      ) : live ? (
        <LiveRadio t={t} live={live} launch={radio.controls.launchFactory} showPresets={presets} />
      ) : (
        <RadioTuner state={radio.state} controls={radio.controls} t={t} />
      )}
    </View>
  );
});

// ---- Bluetooth now-playing (unchanged behavior) ----------------------------
function BluetoothNowPlaying({ np, t, live }: { np: NpView; t: ReturnType<typeof useTheme>; live: LiveControls | null }) {
  return (
    <>
      <Text allowFontScaling={false} style={[styles.label, { color: t.textFaint }]}>
        {np ? `NOW PLAYING · ${np.source}` : 'NOW PLAYING · NO SOURCE'}
      </Text>
      <View style={styles.row}>
        <Art uri={np?.artUri ?? null} t={t} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text allowFontScaling={false} numberOfLines={1} style={[styles.title, { color: t.text }]}>
            {np ? np.title : 'Nothing playing'}
          </Text>
          <Text allowFontScaling={false} numberOfLines={1} style={[styles.artist, { color: t.textDim }]}>
            {np ? np.artist : 'Connect Bluetooth'}
          </Text>
        </View>
      </View>
      <View style={styles.transport}>
        <Btn label="‹‹" theme={t} onPress={() => live?.mediaPrevious()} />
        <Btn label={np?.isPlaying ? '❚❚' : '▶'} theme={t} primary onPress={() => live?.mediaToggle()} />
        <Btn label="››" theme={t} onPress={() => live?.mediaNext()} />
      </View>
    </>
  );
}

/** Album art when the source sends it (apps on the unit usually do; plain Bluetooth
 *  AVRCP mostly doesn't), else the placeholder tile. */
function Art({ uri, t }: { uri: string | null; t: ReturnType<typeof useTheme> }) {
  return uri ? (
    <Image source={{ uri }} style={[styles.art, { borderColor: t.panelBorder }]} resizeMode="cover" />
  ) : (
    <View style={[styles.art, { borderColor: t.panelBorder }]}>
      <Text allowFontScaling={false} style={[styles.artText, { color: t.textFaint }]}>ART</Text>
    </View>
  );
}

/**
 * RADIO on the unit: the FM/AM tuner publishes a media session (FACT, 2026-10-21 — the
 * stock launcher owns it: title = frequency, artist = RDS text, album = band), so we show
 * it and map ‹‹ / ›› to its skip actions (= seek on this unit). Tuning by frequency still
 * has no API, so the factory app stays one tap away.
 */
function samePresets(a: RadioPreset[], b: RadioPreset[]) {
  return (
    a.length === b.length &&
    a.every((p, i) => p.id === b[i].id && p.title === b[i].title && p.active === b[i].active && (p.art?.length ?? 0) === (b[i].art?.length ?? 0))
  );
}

function LiveRadio({
  t,
  live,
  launch,
  showPresets,
}: {
  t: ReturnType<typeof useTheme>;
  live: LiveControls;
  launch: () => void;
  showPresets: boolean;
}) {
  const [r, setR] = useState<NowPlaying | null>(null);
  const [presets, setPresets] = useState<RadioPreset[]>([]);
  const [saved, setSaved] = useState<'idle' | 'ok' | 'no'>('idle');
  const refreshPresets = React.useCallback(
    () =>
      live
        .getRadioPresets()
        .then((p) => setPresets((cur) => (samePresets(cur, p) ? cur : p)))
        .catch(() => {}),
    [live]
  );
  useEffect(() => {
    let alive = true;
    const tick = () => live.getRadio().then((v) => alive && setR(v)).catch(() => {});
    tick();
    void refreshPresets();
    const id = setInterval(tick, 2000);
    const id2 = setInterval(() => void refreshPresets(), 8000); // favourites rarely change
    return () => {
      alive = false;
      clearInterval(id);
      clearInterval(id2);
    };
  }, [live, refreshPresets]);
  const band = (r?.album || 'FM').toUpperCase();
  const soon = () => setTimeout(() => {
    live.getRadio().then(setR).catch(() => {});
    void refreshPresets();
  }, 600); // reflect play / tune / save quickly
  const toggle = () => {
    live.radioToggle();
    soon();
  };
  const save = async () => {
    const ok = await live.radioFavorite();
    setSaved(ok ? 'ok' : 'no');
    setTimeout(() => setSaved('idle'), 1800);
    soon();
  };
  return (
    <>
      <View style={styles.liveHead}>
        <Text allowFontScaling={false} style={[styles.label, { color: t.textFaint, marginBottom: 0 }]}>
          {r ? `TUNER · ${band} · ${r.isPlaying ? 'ON AIR' : 'PAUSED'}` : 'TUNER · NOT PLAYING'}
        </Text>
        <Pressable onPress={launch} hitSlop={10}>
          <Text allowFontScaling={false} style={[styles.launchLink, { color: t.textFaint, marginTop: 0 }]}>RADIO APP ↗</Text>
        </Pressable>
      </View>
      <View style={[styles.row, { marginTop: 14 }]}>
        <Art uri={r?.artUri ?? null} t={t} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text allowFontScaling={false} style={[styles.freq, { color: r ? t.accent : t.absent }]}>
            {r ? r.title : '— · —'}
            <Text allowFontScaling={false} style={{ fontSize: 22, color: t.textDim }}> {band === 'AM' ? 'kHz' : 'MHz'}</Text>
          </Text>
          <Text allowFontScaling={false} numberOfLines={2} style={[styles.station, { color: r ? t.text : t.textFaint }]}>
            {saved === 'ok' ? '★ SAVED TO FAVOURITES' : saved === 'no' ? 'COULD NOT SAVE' : r ? r.artist || 'NO RDS TEXT' : 'Start the radio on the unit'}
          </Text>
        </View>
      </View>
      <View style={styles.transport}>
        {/* SEEK = next station on air (MCU); − / + = one 0.2 MHz step — browse without favourites */}
        <Btn label="SEEK ‹" theme={t} onPress={() => { live.radioSeek(-1); soon(); }} />
        <Btn label="−" theme={t} onPress={() => { live.radioTune(-1); soon(); }} />
        <Btn label={r?.isPlaying ? '❚❚' : '▶ FM'} theme={t} primary onPress={toggle} />
        <Btn label="+" theme={t} onPress={() => { live.radioTune(1); soon(); }} />
        <Btn label="› SEEK" theme={t} onPress={() => { live.radioSeek(1); soon(); }} />
        <Btn label="☆" theme={t} onPress={save} />
      </View>
      {showPresets && presets.length > 0 && (
        <View style={styles.favRow}>
          {presets.slice(0, 5).map((p) => (
            <Press
              key={p.id}
              onPress={() => {
                live.radioPlayPreset(p.id);
                soon();
              }}
              style={[styles.fav, { borderColor: p.active ? t.accent : t.hairline }]}
            >
              {p.art ? (
                <Image source={{ uri: p.art }} style={styles.favArt} resizeMode="contain" />
              ) : (
                <Text allowFontScaling={false} style={[styles.favFreq, { color: p.active ? t.accent : t.text }]} numberOfLines={1}>
                  {p.title}
                </Text>
              )}
              <Text allowFontScaling={false} numberOfLines={1} style={[styles.favName, { color: p.active ? t.accent : t.textDim }]}>
                {p.art ? p.title : p.subtitle || ' '}
              </Text>
            </Press>
          ))}
        </View>
      )}
    </>
  );
}

// ---- Radio tuner -----------------------------------------------------------
const fmtFreq = (khz: number, band: Band) => (band === 'FM' ? (khz / 1000).toFixed(1) : String(khz));

function RadioTuner({ state, controls, t }: { state: RadioState; controls: RadioControls; t: ReturnType<typeof useTheme> }) {
  const live = state.controllable;
  const accent = live ? t.accent : t.absent;
  const bars = Math.round((state.signalPct / 100) * 6);

  return (
    <>
      {/* band + signal */}
      <View style={styles.tunerHead}>
        <View style={styles.bandRow}>
          {(['FM', 'AM'] as Band[]).map((b) => {
            const active = state.band === b;
            return (
              <Press
                key={b}
                onPress={() => controls.setBand(b)}
                disabled={!live}
                style={[styles.bandTab, { borderColor: active ? t.accent : t.panelBorder }]}
              >
                <Text allowFontScaling={false} style={[styles.bandText, { color: active ? t.accent : t.textDim }]}>{b}</Text>
              </Press>
            );
          })}
        </View>
        <View style={styles.signal}>
          {Array.from({ length: 6 }).map((_, i) => (
            <View
              key={i}
              style={[styles.sigBar, { height: 6 + i * 3, backgroundColor: live && i < bars ? t.accent : t.absent }]}
            />
          ))}
        </View>
      </View>

      {/* frequency + station */}
      <View style={styles.freqRow}>
        <Text allowFontScaling={false} style={[styles.freq, { color: accent }]}>
          {live ? fmtFreq(state.frequencyKhz, state.band) : '— · —'}
          <Text allowFontScaling={false} style={{ fontSize: 22, color: t.textDim }}> {state.band === 'FM' ? 'MHz' : 'kHz'}</Text>
        </Text>
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.station, { color: live ? t.text : t.textFaint }]}>
          {live ? state.stationName : 'TUNER NOT AVAILABLE'}
        </Text>
      </View>

      {live ? (
        <>
          <View style={styles.transport}>
            <Btn label="SEEK ‹" theme={t} onPress={() => controls.seek(-1)} />
            <Btn label="−" theme={t} onPress={() => controls.step(-1)} />
            <Btn label="+" theme={t} onPress={() => controls.step(1)} />
            <Btn label="› SEEK" theme={t} onPress={() => controls.seek(1)} />
          </View>
          <View style={styles.presets}>
            {state.presets.map((khz) => (
              <Press
                key={khz}
                onPress={() => controls.recallPreset(khz)}
                style={[styles.preset, { borderColor: state.frequencyKhz === khz ? t.accent : t.hairline }]}
              >
                <Text allowFontScaling={false} style={[styles.presetText, { color: state.frequencyKhz === khz ? t.accent : t.textDim }]}>
                  {fmtFreq(khz, state.band)}
                </Text>
              </Press>
            ))}
          </View>
          <Press onPress={controls.launchFactory} hitSlop={6}>
            <Text allowFontScaling={false} style={[styles.launchLink, { color: t.textFaint }]}>OPEN FACTORY RADIO APP ↗</Text>
          </Press>
        </>
      ) : (
        <>
          <Press onPress={controls.launchFactory} style={[styles.launchBtn, { borderColor: t.accent, backgroundColor: t.panel }]}>
            <Text allowFontScaling={false} style={[styles.launchText, { color: t.accent }]}>LAUNCH FACTORY RADIO</Text>
          </Press>
          <Text allowFontScaling={false} style={[styles.tunerNote, { color: t.textFaint }]}>
            Live tuning runs in the unit's factory radio app (no tuner API on this hardware).
          </Text>
        </>
      )}
    </>
  );
}

function Btn({ label, theme, primary, onPress }: { label: string; theme: ReturnType<typeof useTheme>; primary?: boolean; onPress?: () => void }) {
  return (
    <Press
      onPress={onPress}
      style={[styles.btn, { borderColor: primary ? theme.accent : theme.panelBorder, flex: primary ? 1.6 : 1 }]}
    >
      <Text allowFontScaling={false} style={{ color: primary ? theme.accent : theme.textDim, fontSize: 18, fontFamily: 'Oxanium', fontWeight: '600' }}>
        {label}
      </Text>
    </Press>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 8, padding: 24 },
  sourceRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  srcTab: { flex: 1, borderWidth: 1, borderRadius: 5, paddingVertical: 8, alignItems: 'center' },
  srcText: { fontFamily: 'JetBrains Mono', fontSize: 16, letterSpacing: 2 },
  label: { fontFamily: 'JetBrains Mono', fontSize: 17, letterSpacing: 4, marginBottom: 16 },
  row: { flexDirection: 'row', gap: 18, alignItems: 'center' },
  art: { width: 104, height: 104, borderWidth: 1, alignItems: 'center', justifyContent: 'flex-end', padding: 7 },
  artText: { fontFamily: 'JetBrains Mono', fontSize: 15 },
  title: { fontFamily: 'Oxanium', fontSize: 26, fontWeight: '600' },
  artist: { fontSize: 17, marginTop: 2 },
  transport: { flexDirection: 'row', gap: 14, marginTop: 20 },
  btn: { height: 64, borderWidth: 1, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  // tuner
  tunerHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bandRow: { flexDirection: 'row', gap: 8 },
  bandTab: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 14, paddingVertical: 6 },
  bandText: { fontFamily: 'JetBrains Mono', fontSize: 17, letterSpacing: 2 },
  signal: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 24 },
  sigBar: { width: 6, borderRadius: 1 },
  freqRow: { marginTop: 12, marginBottom: 4 },
  freq: { fontFamily: 'Oxanium', fontSize: 52, fontWeight: '700', lineHeight: 56 },
  station: { fontFamily: 'JetBrains Mono', fontSize: 19, letterSpacing: 2, marginTop: 2 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  preset: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 8 },
  presetText: { fontFamily: 'JetBrains Mono', fontSize: 17 },
  launchLink: { fontFamily: 'JetBrains Mono', fontSize: 15, letterSpacing: 2, marginTop: 14 },
  liveHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  favRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  fav: { flex: 1, height: 84, borderWidth: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, gap: 4 },
  favArt: { width: 48, height: 48, borderRadius: 4 },
  favFreq: { fontFamily: 'Oxanium', fontSize: 26, fontWeight: '700' },
  favName: { fontFamily: 'JetBrains Mono', fontSize: 15, letterSpacing: 1 },
  launchBtn: { borderWidth: 1, borderRadius: 6, paddingVertical: 18, alignItems: 'center', marginTop: 18 },
  launchText: { fontFamily: 'Oxanium', fontSize: 20, fontWeight: '700', letterSpacing: 1 },
  tunerNote: { fontFamily: 'JetBrains Mono', fontSize: 15, lineHeight: 18, marginTop: 12 },
});
