import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Press } from '../components/ui/Press';
import { Stage } from '../components/Stage';
import { Header } from '../components/Header';
import { ReactiveBackground } from '../components/ReactiveBackground';
import { Dock } from '../components/Dock';
import { AppDrawer } from './AppDrawer';
import { BootSweep } from '../components/BootSweep';
import { FacePager, type FaceDef } from './FacePager';
import { HomeFace } from './faces/HomeFace';
import { DriveFace } from './faces/DriveFace';
import { TrailFace } from './faces/TrailFace';
import { NightFace } from './faces/NightFace';
import { useTelemetry } from '../data/DataSourceProvider';
import { ThemeOverride, useTheme } from '../theme/ThemeProvider';
import { amberNightDim } from '../theme/themes';
import { FACE_IDS, loadFace, saveFace, type FaceId } from '../data/settings';

const FACES: FaceDef[] = [
  { id: 'home', Comp: HomeFace },
  { id: 'drive', Comp: DriveFace },
  { id: 'trail', Comp: TrailFace },
  { id: 'night', Comp: NightFace },
];
const NIGHT = FACE_IDS.indexOf('night');

/**
 * The launcher surface every HOME press returns to. Shared chrome (ambient glow,
 * header, dock, face dots, app drawer) wraps a horizontal pager of mode faces:
 * HOME (calm default) · DRIVE (dense instruments) · TRAIL (inclinometer) · NIGHT
 * (speed + clock, dimmed). The last face is persisted. Designed at 2000x1200.
 */
export function HomeScreen() {
  const [index, setIndex] = useState(0);
  const [faceReady, setFaceReady] = useState(false);
  const userMoved = useRef(false);

  useEffect(() => {
    let alive = true;
    loadFace().then((f) => {
      if (!alive) return;
      if (!userMoved.current) setIndex(Math.max(0, FACE_IDS.indexOf(f)));
      setFaceReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const go = useCallback((i: number) => {
    userMoved.current = true;
    setIndex(i);
    void saveFace(FACE_IDS[i]);
  }, []);

  const night = index === NIGHT;

  return (
    <Stage>
      {/* backmost ambient layer — peripheral, speed/g-reactive, nothing when parked */}
      {!night && <ReactiveBackground />}

      {!night && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
          <Header />
        </View>
      )}

      <FacePager faces={FACES} index={index} onIndexChange={go} />

      {/* shared dock + face dots (dimmed with the night face) */}
      <MaybeNight night={night}>
        <View style={{ position: 'absolute', left: 48, right: 48, bottom: 50 }}>
          <Dock />
        </View>
        <FaceDots index={index} onPick={go} />
      </MaybeNight>

      {faceReady && <NightSuggest onNightFace={night} onAccept={() => go(NIGHT)} />}

      {/* cold-start power-up veil (once per process; PulseTach plays the sweep) */}
      <BootSweep />

      {/* full-stage app drawer (renders nothing while closed) */}
      <AppDrawer />
    </Stage>
  );
}

function MaybeNight({ night, children }: { night: boolean; children: React.ReactNode }) {
  return night ? <ThemeOverride theme={amberNightDim}>{children}</ThemeOverride> : <>{children}</>;
}

/** Small page dots, bottom-center under the dock. Tap one to jump. */
const FaceDots = React.memo(function FaceDots({ index, onPick }: { index: number; onPick: (i: number) => void }) {
  const t = useTheme();
  return (
    <View style={styles.dots}>
      {FACES.map((f, i) => (
        <Pressable key={f.id} onPress={() => onPick(i)} hitSlop={{ top: 14, bottom: 14, left: 10, right: 10 }} style={styles.dotHit}>
          <View style={[styles.dot, { backgroundColor: i === index ? t.accent : t.panelBorder }]} />
        </Pressable>
      ))}
      <Text style={[styles.faceName, { color: t.textFaint }]}>{FACES[index].id.toUpperCase()}</Text>
    </View>
  );
});

/**
 * When it gets dark, SUGGEST the night face — once per dusk, never auto-switch (a
 * face changing under the driver's eyes is worse than a too-bright one).
 */
const NightSuggest = React.memo(function NightSuggest({
  onNightFace,
  onAccept,
}: {
  onNightFace: boolean;
  onAccept: () => void;
}) {
  const t = useTheme();
  const isDaylight = useTelemetry((d) => d.system.isDaylight);
  const [show, setShow] = useState(false);
  const suggested = useRef(false);

  useEffect(() => {
    if (isDaylight) suggested.current = false; // re-arm for the next dusk
  }, [isDaylight]);

  useEffect(() => {
    if (onNightFace) {
      suggested.current = true;
      setShow(false);
      return;
    }
    if (isDaylight || suggested.current) return;
    suggested.current = true;
    setShow(true);
  }, [isDaylight, onNightFace]);

  useEffect(() => {
    if (!show) return;
    const id = setTimeout(() => setShow(false), 10000);
    return () => clearTimeout(id);
  }, [show]);

  if (!show) return null;
  return (
    <Press
      radius={8}
      onPress={() => {
        setShow(false);
        onAccept();
      }}
      hitSlop={12}
      style={[styles.suggest, { borderColor: t.accent, backgroundColor: t.bg }]}
    >
      <Text style={[styles.suggestTitle, { color: t.accent }]}>NIGHT FACE ↗</Text>
      <Text style={[styles.suggestSub, { color: t.textFaint }]}>IT'S DARK · TAP TO DIM</Text>
    </Press>
  );
});

const styles = StyleSheet.create({
  dots: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  dotHit: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  faceName: { position: 'absolute', left: 1080, fontFamily: 'JetBrains Mono', fontSize: 12, letterSpacing: 3 },
  // lives in the empty middle of the header bar, so it never covers an instrument
  suggest: {
    position: 'absolute',
    top: 10,
    left: 640,
    width: 720,
    height: 72,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  suggestTitle: { fontFamily: 'Oxanium', fontSize: 26, fontWeight: '700', letterSpacing: 2 },
  suggestSub: { fontFamily: 'JetBrains Mono', fontSize: 13, letterSpacing: 2 },
});
