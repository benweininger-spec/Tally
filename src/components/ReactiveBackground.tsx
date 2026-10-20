/**
 * Reactive ambient field — a peripheral amber glow that rises from the bottom as
 * ground speed climbs and leans left/right with lateral g, so the whole surface feels
 * calm parked and alive at speed. DELIBERATELY RESTRAINED: capped at low opacity,
 * anchored below the instruments, and it renders NOTHING when parked — legibility in
 * direct sun is a hard constraint (design-brief §2), so this must never fight a readout.
 *
 * Perf: coarsely quantized (speed 5mph / latG 0.05g), so it only re-renders on real
 * change, not per frame; a single full-bleed gradient rect, GPU-cheap and static
 * between steps. (The continuous-motion version is the Skia milestone.)
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { shallowEqual, useTelemetry } from '../data/DataSourceProvider';
import { useTheme } from '../theme/ThemeProvider';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const MAX_OPACITY = 0.16;

export const ReactiveBackground = React.memo(function ReactiveBackground() {
  const t = useTheme();
  const { speed, latG } = useTelemetry(
    (d) => ({
      speed: Math.round((d.motion.speedMph.value ?? 0) / 5) * 5,
      latG: Math.round((d.motion.latG.value ?? 0) / 0.05) * 0.05,
    }),
    shallowEqual
  );

  const intensity = clamp(speed / 75, 0, 1); // 0 parked → full at ~75mph
  const op = MAX_OPACITY * intensity;
  if (op < 0.004) return null; // parked: draw nothing at all

  const lean = clamp(latG / 0.6, -1, 1);
  const glowX = 1000 + lean * 460; // center, shifting into the corner you're loading

  return (
    <Svg
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      width={2000}
      height={1200}
      viewBox="0 0 2000 1200"
    >
      <Defs>
        <RadialGradient id="ambientGlow" cx={glowX} cy={1240} r={1180} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={t.accent} stopOpacity={op} />
          <Stop offset="0.55" stopColor={t.accent} stopOpacity={op * 0.28} />
          <Stop offset="1" stopColor={t.accent} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={2000} height={1200} fill="url(#ambientGlow)" />
    </Svg>
  );
});
