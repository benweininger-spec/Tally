import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { shallowEqual, useTelemetry } from '../../data/DataSourceProvider';
import { ThemeOverride, useTheme } from '../../theme/ThemeProvider';
import { amberNightDim } from '../../theme/themes';
import { STAGE_H, STAGE_W } from '../../components/Stage';
import { Press } from '../../components/ui/Press';
import { SpeedRecord } from '../../components/viz/SpeedRecord';
import { GScope } from '../../components/viz/GScope';
import { clamp, gaugeProgress, gaugeTrack } from '../../lib/pulse';
import { clockTime } from '../../lib/format';
import { loadNightStyle, saveNightStyle, type NightStyle } from '../../data/settings';

const SPEED_FULL = 80;
const CX = STAGE_W / 2;
const CY = 520;
const R = 420;
const TRACK = gaugeTrack(CX, CY, R);
const HERO = 880; // RECORD / SCOPE instrument size
const HERO_TOP = 70;

/**
 * NIGHT — the dark-cab face, always the night palette at ~40% luminance
 * (`amberNightDim`), painting its own full-stage background. Three heroes, switched
 * from the face itself and remembered:
 *   RECORD — the Speed Record tachograph disc (Signal Library 06), clock in the hub
 *   SCOPE  — the Phosphor G-Scope (Signal Library 04)
 *   RING   — the original minimal speed ring + clock
 * Ground speed is always on screen. HomeScreen hides the header + ambient glow and
 * dims the shared dock while this face is active.
 */
export const NightFace = React.memo(function NightFace() {
  return (
    <ThemeOverride theme={amberNightDim}>
      <NightBody />
    </ThemeOverride>
  );
});

let cachedStyle: NightStyle | null = null; // survives face swaps without a reload flash

function useNightStyle(): [NightStyle | null, (s: NightStyle) => void] {
  const [style, setStyle] = useState<NightStyle | null>(cachedStyle);
  useEffect(() => {
    if (cachedStyle != null) return;
    let alive = true;
    loadNightStyle().then((s) => {
      cachedStyle = s;
      if (alive) setStyle(s);
    });
    return () => {
      alive = false;
    };
  }, []);
  const change = (s: NightStyle) => {
    cachedStyle = s;
    setStyle(s);
    void saveNightStyle(s);
  };
  return [style, change];
}

function NightBody() {
  const t = useTheme();
  const [style, setStyle] = useNightStyle();
  return (
    // the face layer is full-stage (top -92 inside the pager viewport), so 0,0 = stage origin
    <View style={[StyleSheet.absoluteFill, { backgroundColor: t.bg }]}>
      {style === 'ring' && <RingLayout />}
      {(style === 'record' || style === 'scope') && <HeroLayout style={style} />}
      {style != null && <StyleSwitch value={style} onChange={setStyle} />}
    </View>
  );
}

/** The original minimal night face: speed numeral inside a hairline ring, clock below. */
function RingLayout() {
  const t = useTheme();
  const { speed, frac, live } = useTelemetry((d) => {
    const s = d.motion.speedMph;
    const v = s.value ?? 0;
    return {
      live: s.status !== 'absent' && s.value != null,
      speed: Math.round(v),
      frac: Math.round(clamp(v / SPEED_FULL, 0, 1) * 300) / 300, // sub-pixel ring steps only
    };
  }, shallowEqual);
  const { time, ampm } = useTelemetry((d) => clockTime(d.system.now), shallowEqual);
  const progress = live ? gaugeProgress(CX, CY, R, frac) : null;
  return (
    <>
      <Svg style={StyleSheet.absoluteFill} width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}>
        <Path d={TRACK} stroke={t.hairline} strokeWidth={2} fill="none" strokeLinecap="round" />
        {progress && <Path d={progress} stroke={t.accent} strokeWidth={3} fill="none" strokeLinecap="round" />}
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <Text style={[styles.speed, { color: live ? t.accent : t.absent }]}>{live ? speed : '—'}</Text>
        <Text style={[styles.unit, { color: t.textFaint }]}>MPH</Text>
      </View>
      {/* clock sits in the open bottom of the ring */}
      <View style={styles.clockWrap} pointerEvents="none">
        <Text style={[styles.clock, { color: t.textDim }]}>
          {time}
          <Text style={[styles.ampm, { color: t.textFaint }]}> {ampm}</Text>
        </Text>
      </View>
    </>
  );
}

/** Speed left · instrument centre · clock right (the RECORD disc carries its own clock). */
function HeroLayout({ style }: { style: 'record' | 'scope' }) {
  const t = useTheme();
  const { speed, live } = useTelemetry((d) => {
    const s = d.motion.speedMph;
    return { live: s.status !== 'absent' && s.value != null, speed: Math.round(s.value ?? 0) };
  }, shallowEqual);
  const { time, ampm } = useTelemetry((d) => clockTime(d.system.now), shallowEqual);
  return (
    <>
      <View style={{ position: 'absolute', left: (STAGE_W - HERO) / 2, top: HERO_TOP }}>
        {style === 'record' ? <SpeedRecord size={HERO} /> : <GScope size={HERO} />}
      </View>
      <View style={styles.speedCol} pointerEvents="none">
        <Text style={[styles.heroSpeed, { color: live ? t.accent : t.absent }]}>{live ? speed : '—'}</Text>
        <Text style={[styles.unit, { color: t.textFaint }]}>MPH</Text>
      </View>
      {style === 'scope' && (
        <View style={styles.clockCol} pointerEvents="none">
          <Text style={[styles.clock, { color: t.textDim }]}>
            {time}
            <Text style={[styles.ampm, { color: t.textFaint }]}> {ampm}</Text>
          </Text>
        </View>
      )}
    </>
  );
}

const STYLES: { id: NightStyle; label: string }[] = [
  { id: 'record', label: 'RECORD' },
  { id: 'scope', label: 'SCOPE' },
  { id: 'ring', label: 'RING' },
];

function StyleSwitch({ value, onChange }: { value: NightStyle; onChange: (s: NightStyle) => void }) {
  const t = useTheme();
  return (
    <View style={styles.switch}>
      {STYLES.map((s) => {
        const active = s.id === value;
        return (
          <Press
            key={s.id}
            onPress={() => onChange(s.id)}
            style={[styles.seg, { borderColor: active ? t.accent : t.panelBorder, backgroundColor: active ? t.panel : 'transparent' }]}
          >
            <Text style={[styles.segText, { color: active ? t.accent : t.textFaint }]}>{s.label}</Text>
          </Press>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { position: 'absolute', left: 0, right: 0, top: CY - 250, alignItems: 'center' },
  speed: { fontFamily: 'Oxanium', fontSize: 400, fontWeight: '700', lineHeight: 430 },
  unit: { fontFamily: 'JetBrains Mono', fontSize: 22, letterSpacing: 8, marginTop: -8 },
  clockWrap: { position: 'absolute', left: 0, right: 0, top: CY + R * 0.74, alignItems: 'center' },
  clock: { fontFamily: 'Oxanium', fontSize: 64, fontWeight: '600', letterSpacing: 2 },
  ampm: { fontFamily: 'JetBrains Mono', fontSize: 22, letterSpacing: 3 },
  speedCol: { position: 'absolute', left: 40, width: 500, top: 330, alignItems: 'center' },
  heroSpeed: { fontFamily: 'Oxanium', fontSize: 240, fontWeight: '700', lineHeight: 260 },
  clockCol: { position: 'absolute', left: 1460, width: 480, top: 420, alignItems: 'center' },
  switch: { position: 'absolute', left: 1480, top: 860, flexDirection: 'row', gap: 10 },
  seg: { width: 140, height: 96, borderWidth: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  segText: { fontFamily: 'JetBrains Mono', fontSize: 18, letterSpacing: 3 },
});
