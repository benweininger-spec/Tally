/** Shared bits for the Signal Library instruments: the render loop + text labels. */
import React, { useEffect, useRef } from 'react';
import { Platform, StyleSheet, Text } from 'react-native';

export const LOOP_MS = 40; // ~25 fps, same cap as PulseTach

export const nowS = () => {
  const p = (globalThis as any).performance;
  return (p && typeof p.now === 'function' ? p.now() : Date.now()) / 1000;
};

/**
 * The instrument's own loop (PulseTach's pattern): `step(t, dt)` runs every ~40 ms
 * and decides for itself whether anything changed. No React state involved.
 */
export function useVizLoop(step: (t: number, dt: number) => void, deps: React.DependencyList) {
  const ref = useRef(step);
  ref.current = step;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let last = 0;
    const tick = () => {
      const t = nowS();
      const dt = last ? Math.min(0.1, t - last) : LOOP_MS / 1000;
      last = t;
      ref.current(t, dt);
      timer = setTimeout(tick, LOOP_MS);
    };
    tick();
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Absolutely positioned label. `x` is the left edge, or the centre / right edge per `align`. */
export function VizLabel({
  x,
  y,
  size,
  color,
  align = 'left',
  mono = true,
  weight,
  spacing,
  children,
}: {
  x: number;
  y: number;
  size: number;
  color: string;
  align?: 'left' | 'center' | 'right';
  mono?: boolean;
  weight?: '500' | '600' | '700';
  spacing?: number;
  children: React.ReactNode;
}) {
  const W = 400;
  const left = align === 'left' ? x : align === 'center' ? x - W / 2 : x - W;
  return (
    <Text
      numberOfLines={1}
      style={[
        styles.label,
        {
          left,
          top: y,
          width: W,
          textAlign: align,
          fontSize: size,
          lineHeight: Math.round(size * (mono ? 1.32 : 1.05)),
          color,
          fontFamily: mono ? 'JetBrains Mono' : 'Oxanium',
          fontWeight: weight ?? (mono ? '500' : '700'),
          letterSpacing: spacing ?? (mono ? size * 0.18 : 0),
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
    pointerEvents: 'none',
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
  },
});
