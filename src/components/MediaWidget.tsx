import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Press } from './ui/Press';
import { shallowEqual, useSourceControls, useTelemetry } from '../data/DataSourceProvider';
import type { NowPlaying } from '../data/types';
import { useTheme } from '../theme/ThemeProvider';
import { has } from '../data/types';
import { useRadio, type Band, type RadioControls, type RadioState } from '../radio/RadioProvider';
import type { LiveControls } from '../data/live/LiveDataSource';

type MediaSource = 'bt' | 'radio';
type NpView = { title: string; artist: string; source: string; isPlaying: boolean; artUri: string | null } | null;

export const MediaWidget = React.memo(function MediaWidget() {
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
              <Text style={[styles.srcText, { color: active ? t.accent : t.textDim }]}>
                {s === 'bt' ? 'BLUETOOTH' : 'RADIO'}
              </Text>
            </Press>
          );
        })}
      </View>

      {source === 'bt' ? (
        <BluetoothNowPlaying np={np} t={t} live={live} />
      ) : live ? (
        <LiveRadio t={t} live={live} launch={radio.controls.launchFactory} />
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
      <Text style={[styles.label, { color: t.textFaint }]}>
        {np ? `NOW PLAYING · ${np.source}` : 'NOW PLAYING · NO SOURCE'}
      </Text>
      <View style={styles.row}>
        <Art uri={np?.artUri ?? null} t={t} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[styles.title, { color: t.text }]}>
            {np ? np.title : 'Nothing playing'}
          </Text>
          <Text numberOfLines={1} style={[styles.artist, { color: t.textDim }]}>
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
      <Text style={[styles.artText, { color: t.textFaint }]}>ART</Text>
    </View>
  );
}

/**
 * RADIO on the unit: the FM/AM tuner publishes a media session (FACT, 2026-10-21 — the
 * stock launcher owns it: title = frequency, artist = RDS text, album = band), so we show
 * it and map ‹‹ / ›› to its skip actions (= seek on this unit). Tuning by frequency still
 * has no API, so the factory app stays one tap away.
 */
function LiveRadio({ t, live, launch }: { t: ReturnType<typeof useTheme>; live: LiveControls; launch: () => void }) {
  const [r, setR] = useState<NowPlaying | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () => live.getRadio().then((v) => alive && setR(v)).catch(() => {});
    tick();
    const id = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [live]);
  const band = (r?.album || 'FM').toUpperCase();
  return (
    <>
      <Text style={[styles.label, { color: t.textFaint }]}>{r ? `TUNER · ${band}` : 'TUNER · NOT PLAYING'}</Text>
      <View style={styles.freqRow}>
        <Text style={[styles.freq, { color: r ? t.accent : t.absent }]}>
          {r ? r.title : '— · —'}
          <Text style={{ fontSize: 22, color: t.textDim }}> {band === 'AM' ? 'kHz' : 'MHz'}</Text>
        </Text>
        <Text numberOfLines={2} style={[styles.station, { color: r ? t.text : t.textFaint }]}>
          {r ? r.artist || 'NO RDS TEXT' : 'Start the radio on the unit'}
        </Text>
      </View>
      <View style={styles.transport}>
        <Btn label="SEEK ‹" theme={t} onPress={() => live.radioSeek(-1)} />
        <Btn label="› SEEK" theme={t} onPress={() => live.radioSeek(1)} />
      </View>
      <Pressable onPress={launch} hitSlop={6}>
        <Text style={[styles.launchLink, { color: t.textFaint }]}>OPEN FACTORY RADIO APP ↗</Text>
      </Pressable>
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
                <Text style={[styles.bandText, { color: active ? t.accent : t.textDim }]}>{b}</Text>
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
        <Text style={[styles.freq, { color: accent }]}>
          {live ? fmtFreq(state.frequencyKhz, state.band) : '— · —'}
          <Text style={{ fontSize: 22, color: t.textDim }}> {state.band === 'FM' ? 'MHz' : 'kHz'}</Text>
        </Text>
        <Text numberOfLines={1} style={[styles.station, { color: live ? t.text : t.textFaint }]}>
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
                <Text style={[styles.presetText, { color: state.frequencyKhz === khz ? t.accent : t.textDim }]}>
                  {fmtFreq(khz, state.band)}
                </Text>
              </Press>
            ))}
          </View>
          <Press onPress={controls.launchFactory} hitSlop={6}>
            <Text style={[styles.launchLink, { color: t.textFaint }]}>OPEN FACTORY RADIO APP ↗</Text>
          </Press>
        </>
      ) : (
        <>
          <Press onPress={controls.launchFactory} style={[styles.launchBtn, { borderColor: t.accent, backgroundColor: t.panel }]}>
            <Text style={[styles.launchText, { color: t.accent }]}>LAUNCH FACTORY RADIO</Text>
          </Press>
          <Text style={[styles.tunerNote, { color: t.textFaint }]}>
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
      <Text style={{ color: primary ? theme.accent : theme.textDim, fontSize: 18, fontFamily: 'Oxanium', fontWeight: '600' }}>
        {label}
      </Text>
    </Press>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 8, padding: 24 },
  sourceRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  srcTab: { flex: 1, borderWidth: 1, borderRadius: 5, paddingVertical: 8, alignItems: 'center' },
  srcText: { fontFamily: 'JetBrains Mono', fontSize: 13, letterSpacing: 2 },
  label: { fontFamily: 'JetBrains Mono', fontSize: 14, letterSpacing: 4, marginBottom: 16 },
  row: { flexDirection: 'row', gap: 18, alignItems: 'center' },
  art: { width: 104, height: 104, borderWidth: 1, alignItems: 'center', justifyContent: 'flex-end', padding: 7 },
  artText: { fontFamily: 'JetBrains Mono', fontSize: 10 },
  title: { fontFamily: 'Oxanium', fontSize: 26, fontWeight: '600' },
  artist: { fontSize: 17, marginTop: 2 },
  transport: { flexDirection: 'row', gap: 14, marginTop: 20 },
  btn: { height: 64, borderWidth: 1, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  // tuner
  tunerHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bandRow: { flexDirection: 'row', gap: 8 },
  bandTab: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 14, paddingVertical: 6 },
  bandText: { fontFamily: 'JetBrains Mono', fontSize: 14, letterSpacing: 2 },
  signal: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 24 },
  sigBar: { width: 6, borderRadius: 1 },
  freqRow: { marginTop: 12, marginBottom: 4 },
  freq: { fontFamily: 'Oxanium', fontSize: 52, fontWeight: '700', lineHeight: 56 },
  station: { fontFamily: 'JetBrains Mono', fontSize: 16, letterSpacing: 2, marginTop: 2 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  preset: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 8 },
  presetText: { fontFamily: 'JetBrains Mono', fontSize: 14 },
  launchLink: { fontFamily: 'JetBrains Mono', fontSize: 12, letterSpacing: 2, marginTop: 14 },
  launchBtn: { borderWidth: 1, borderRadius: 6, paddingVertical: 18, alignItems: 'center', marginTop: 18 },
  launchText: { fontFamily: 'Oxanium', fontSize: 20, fontWeight: '700', letterSpacing: 1 },
  tunerNote: { fontFamily: 'JetBrains Mono', fontSize: 12, lineHeight: 18, marginTop: 12 },
});
