/**
 * THE SIGNATURE — Skia renderer (the head unit's hot path, milestone-2 port).
 *
 * Same display model (pulseModel.ts) and the SAME geometry (src/lib/pulse.ts — not
 * forked) as the SVG renderer, but the moving parts never go through React: the
 * ~25 fps loop writes path strings + head position into Reanimated shared values, and
 * Skia's own `processPath` worklet turns them into SkPaths on the UI thread. So the
 * ring, ticks, waveform and head dot update with ZERO React re-renders per frame —
 * the cost that pinned the Snapdragon 665 with react-native-svg (reconciling ~60 SVG
 * nodes per frame) is gone.
 *
 * The numerals (speed, RPM label, caption) are small RN Text overlays in the loaded
 * fonts; they re-render only when the displayed integer/string changes.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Canvas, Circle, DashPathEffect, Line, LinearGradient, Path, vec } from '@shopify/react-native-skia';
import { useSharedValue } from 'react-native-reanimated';
import { useDataSource } from '../../data/DataSourceProvider';
import { driveRecorder } from '../../data/driveRecorder';
import { useTheme } from '../../theme/ThemeProvider';
import { formatColor, parseColor } from '../../theme/themes';
import { gaugeProgress, gaugeRedline, gaugeTicks, gaugeTrack, type Tick } from '../../lib/pulse';
import { nowMs } from './sweepChannel';
import {
  LOOP_MS,
  captionFor,
  createPulseDisp,
  createTraceState,
  pulseLayout,
  redlineOpacityFor,
  stepPulse,
  stepTrace,
} from './pulseModel';

const EMPTY = 'M 0 0'; // a valid, invisible path — Skia throws on '' / malformed strings
const safe = (d: string | null | undefined) => (d && !/NaN|undefined|Infinity/.test(d) ? d : EMPTY);

/** "M x1 y1 L x2 y2 …" for a subset of ticks (lit/unlit × minor/major). */
function tickPath(ticks: Tick[], keep: (t: Tick) => boolean): string {
  let d = '';
  for (const tk of ticks) if (keep(tk)) d += `M ${tk.x1.toFixed(1)} ${tk.y1.toFixed(1)} L ${tk.x2.toFixed(1)} ${tk.y2.toFixed(1)} `;
  return safe(d.trim());
}

const withAlpha = (c: string, a: number) => {
  const p = parseColor(c);
  return p ? formatColor([p[0], p[1], p[2], a]) : c;
};

interface Texts {
  rpm: string;
  caption: string;
  speed: string;
}

export const PulseTach = React.memo(function PulseTach({ size = 720 }: { size?: number }) {
  const source = useDataSource();
  const t = useTheme();
  const disp = useRef(createPulseDisp()).current;
  const traceSt = useRef(createTraceState()).current;
  const L = useMemo(() => pulseLayout(size), [size]);
  const { cx, cy, rArc } = L;

  // ---- per-frame state lives in shared values (written by the loop, read by Skia) ----
  const progress = useSharedValue(EMPTY);
  const waveLine = useSharedValue(EMPTY);
  const waveFill = useSharedValue(EMPTY);
  const litMinor = useSharedValue(EMPTY);
  const litMajor = useSharedValue(EMPTY);
  const headX = useSharedValue(L.wave.x);
  const headY = useSharedValue(L.wave.y + L.wave.height);
  const redlineOpacity = useSharedValue(0);

  // ---- slow state: tick layout flips with OBD; numerals live in <Numerals> ----
  const [obdLive, setObdLive] = useState(false);
  const textsRef = useRef<Texts>({ rpm: 'RING · SPEED', caption: captionFor(disp), speed: '0' });
  const pushTexts = useRef<((t: Texts) => void) | null>(null);

  const track = useMemo(() => safe(gaugeTrack(cx, cy, rArc)), [cx, cy, rArc]);
  const redline = useMemo(() => safe(gaugeRedline(cx, cy, rArc, L.redFrac)), [cx, cy, rArc, L.redFrac]);
  const ticks = useMemo(() => gaugeTicks(L.ticks(obdLive)), [L, obdLive]);
  const unlitMinor = useMemo(() => tickPath(ticks, (k) => !k.major), [ticks]);
  const unlitMajor = useMemo(() => tickPath(ticks, (k) => k.major), [ticks]);
  const ticksRef = useRef(ticks);
  ticksRef.current = ticks;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let last = 0;
    let sig = '';
    let litCount = -1;
    let litTicks: Tick[] | null = null;
    let obd = disp.obdLive;
    const step = () => {
      const now = nowMs();
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.033;
      last = now;
      const next = stepPulse(disp, source.getSnapshot(), now, dt);
      // the speed trace has its own change detection (recorder version + curve string)
      if (stepTrace(traceSt, driveRecorder, L.wave) && traceSt.trace) {
        waveLine.value = safe(traceSt.trace.line);
        waveFill.value = safe(traceSt.trace.fill);
        headX.value = traceSt.trace.head.x;
        headY.value = traceSt.trace.head.y;
      }
      if (next !== sig) {
        sig = next;
        // geometry → shared values (UI thread rebuilds the SkPaths; no React render)
        progress.value = safe(gaugeProgress(cx, cy, rArc, disp.frac));
        redlineOpacity.value = disp.obdLive ? redlineOpacityFor(disp) : 0;

        if (disp.obdLive !== obd) {
          obd = disp.obdLive;
          setObdLive(obd); // tick count changes (40 ↔ 55): rare React render
        }
        // lit ticks only change when another tick crosses the needle (or the layout flips)
        const tk = ticksRef.current;
        let lit = 0;
        for (const k of tk) if (k.frac <= disp.frac) lit++;
        if (lit !== litCount || tk !== litTicks) {
          litCount = lit;
          litTicks = tk;
          litMinor.value = tickPath(tk, (k) => !k.major && k.frac <= disp.frac);
          litMajor.value = tickPath(tk, (k) => k.major && k.frac <= disp.frac);
        }

        // numerals: a React render of <Numerals> only, and only when the text changes
        const nt: Texts = {
          // 50-rpm steps: a readable tach number that doesn't re-render every frame
          rpm: disp.obdLive ? `${Math.round(disp.rpm / 50) * 50} RPM` : 'RING · SPEED',
          caption: captionFor(disp),
          speed: String(Math.round(disp.speed)),
        };
        const cur = textsRef.current;
        if (nt.rpm !== cur.rpm || nt.caption !== cur.caption || nt.speed !== cur.speed) {
          textsRef.current = nt;
          pushTexts.current?.(nt);
        }
      }
      timer = setTimeout(step, LOOP_MS);
    };
    step();
    return () => clearTimeout(timer);
    // shared values are stable; geometry inputs (size) restart the loop
  }, [source, disp, traceSt, cx, cy, rArc, L]);

  const sw = t.stroke; // day theme thickens the ring for direct sun
  const gradient = useMemo(() => [withAlpha(t.accent, 0.32), withAlpha(t.accent, 0.03)], [t.accent]);
  const baseline = L.wave.y + L.wave.height; // zero line under the speed trace

  return (
    <View style={{ width: size, height: size }}>
      <Canvas style={{ width: size, height: size }}>
        {/* dim full track */}
        <Path path={track} style="stroke" strokeWidth={10 * sw} strokeCap="round" color={t.panelBorder} />
        {/* redline zone — ignites with OBD (connect moment animates its opacity) */}
        <Path path={redline} style="stroke" strokeWidth={10 * sw} strokeCap="round" color={t.warn} opacity={redlineOpacity} />
        {/* lit progress: soft underglow + crisp top */}
        <Path path={progress} style="stroke" strokeWidth={22 * sw} strokeCap="round" color={t.accent} opacity={0.22} />
        <Path path={progress} style="stroke" strokeWidth={9 * sw} strokeCap="round" color={t.accent} />
        {/* ticks: unlit base, lit overlay */}
        <Path path={unlitMinor} style="stroke" strokeWidth={1.4 * sw} color={t.panelBorder} opacity={0.6} />
        <Path path={unlitMajor} style="stroke" strokeWidth={3 * sw} color={t.panelBorder} opacity={0.95} />
        <Path path={litMinor} style="stroke" strokeWidth={1.4 * sw} color={t.accent} opacity={0.6} />
        <Path path={litMajor} style="stroke" strokeWidth={3 * sw} color={t.accent} opacity={0.95} />
        {/* zero line under the speed trace */}
        <Line p1={vec(L.wave.x, baseline)} p2={vec(L.wave.x + L.wave.width, baseline)} color={t.hairline} strokeWidth={1} style="stroke">
          <DashPathEffect intervals={[2, 6]} />
        </Line>
        {/* speed trace (smooth spline) */}
        <Path path={waveFill} style="fill">
          <LinearGradient
            start={vec(0, L.wave.y)}
            end={vec(0, L.wave.y + L.wave.height)}
            colors={gradient}
            positions={[0, 1]}
          />
        </Path>
        <Path path={waveLine} style="stroke" strokeWidth={3 * sw} strokeJoin="round" strokeCap="round" color={t.accent} />
        {/* leading-edge glow dot */}
        <Circle cx={headX} cy={headY} r={9} color={t.accent} opacity={0.25} />
        <Circle cx={headX} cy={headY} r={4.5} color={t.accent} />
      </Canvas>

      <Numerals size={size} L={L} obdLive={obdLive} initial={textsRef.current} register={pushTexts} />
    </View>
  );
});

/** RN text in the loaded fonts, baselines matched to the SVG renderer. */
function Numerals({
  size,
  L,
  obdLive,
  initial,
  register,
}: {
  size: number;
  L: ReturnType<typeof pulseLayout>;
  obdLive: boolean;
  initial: Texts;
  register: React.MutableRefObject<((t: Texts) => void) | null>;
}) {
  const t = useTheme();
  const [texts, setTexts] = useState(initial);
  useEffect(() => {
    register.current = setTexts;
    return () => {
      register.current = null;
    };
  }, [register]);
  return (
    <>
      <Label y={L.rpmY} size={size * 0.034} mono spacing={3} color={obdLive ? t.accentSoft : t.absent} width={size}>
        {texts.rpm}
      </Label>
      <Label y={L.captionY} size={size * 0.026} mono spacing={4} color={t.textFaint} width={size}>
        {texts.caption}
      </Label>
      <Label y={L.speedY} size={size * 0.205} color={t.accent} width={size}>
        {texts.speed}
      </Label>
      <Label y={L.unitY} size={size * 0.03} mono spacing={4} color={t.textFaint} width={size}>
        MPH · GROUND SPEED
      </Label>
    </>
  );
}

// font vertical metrics (hhea, per em): Oxanium asc .79 / content 1.0; JetBrains Mono
// asc 1.02 / content 1.32. With lineHeight = content height, baseline = top + asc.
const OXANIUM = { asc: 0.79, lh: 1.0 };
const MONO = { asc: 1.02, lh: 1.32 };

function Label({
  y,
  size,
  mono,
  spacing = 0,
  color,
  width,
  children,
}: {
  y: number;
  size: number;
  mono?: boolean;
  spacing?: number;
  color: string;
  width: number;
  children: React.ReactNode;
}) {
  const m = mono ? MONO : OXANIUM;
  return (
    <Text allowFontScaling={false}
      numberOfLines={1}
      style={[
        styles.label,
        {
          top: y - size * m.asc,
          width,
          fontSize: size,
          lineHeight: Math.round(size * m.lh),
          letterSpacing: spacing,
          color,
          fontFamily: mono ? 'JetBrains Mono' : 'Oxanium',
          fontWeight: mono ? undefined : '700',
        },
      ]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  label: {
    position: 'absolute',
    left: 0,
    textAlign: 'center',
    pointerEvents: 'none',
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
  },
});
