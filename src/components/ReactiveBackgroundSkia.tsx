/**
 * Reactive ambient field — Skia, continuous motion (milestone-2 port). Same selectors
 * and caps as the SVG version (speed in 5 mph steps, lateral g in 0.05 g steps, theme
 * `ambientMax`), but instead of jumping between steps, the glow's opacity and lean
 * GLIDE to each new target on the UI thread (Reanimated withTiming → Skia props), so
 * the field breathes with the drive with zero React work per frame. Still restrained:
 * anchored below the instruments, and unmounted entirely once it has faded out parked.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Canvas, RadialGradient, Rect, vec } from '@shopify/react-native-skia';
import { Easing, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { shallowEqual, useTelemetry } from '../data/DataSourceProvider';
import { useTheme } from '../theme/ThemeProvider';
import { formatColor, parseColor } from '../theme/themes';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const GLIDE_MS = 900;
const VISIBLE = 0.004;

export const ReactiveBackground = React.memo(function ReactiveBackground() {
  const t = useTheme();
  const { speed, latG } = useTelemetry(
    (d) => ({
      speed: Math.round((d.motion.speedMph.value ?? 0) / 5) * 5,
      latG: Math.round((d.motion.latG.value ?? 0) / 0.05) * 0.05,
    }),
    shallowEqual
  );

  const targetOp = t.ambientMax * clamp(speed / 75, 0, 1); // 0 parked → cap at ~75 mph
  const targetX = 1000 + clamp(latG / 0.6, -1, 1) * 460; // leans into the corner you're loading

  const op = useSharedValue(0);
  const gx = useSharedValue(targetX);
  const [mounted, setMounted] = useState(targetOp >= VISIBLE);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (targetOp >= VISIBLE) setMounted(true);
    const cfg = { duration: GLIDE_MS, easing: Easing.inOut(Easing.quad) };
    op.value = withTiming(targetOp, cfg);
    gx.value = withTiming(targetX, cfg);
    // parked: drop the full-bleed canvas once the fade-out has finished
    if (targetOp < VISIBLE) hideTimer.current = setTimeout(() => setMounted(false), GLIDE_MS + 50);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [targetOp, targetX, op, gx]);

  const center = useDerivedValue(() => vec(gx.value, 1240));
  const colors = useMemo(() => {
    const p = parseColor(t.accent) ?? [255, 180, 84, 1];
    return [formatColor([p[0], p[1], p[2], 1]), formatColor([p[0], p[1], p[2], 0.28]), formatColor([p[0], p[1], p[2], 0])];
  }, [t.accent]);

  if (!mounted) return null;
  return (
    <Canvas style={styles.fill}>
      <Rect x={0} y={0} width={2000} height={1200} opacity={op}>
        <RadialGradient c={center} r={1180} colors={colors} positions={[0, 0.55, 1]} />
      </Rect>
    </Canvas>
  );
});

const styles = StyleSheet.create({
  fill: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, pointerEvents: 'none' },
});
