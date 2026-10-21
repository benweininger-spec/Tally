/**
 * Big-thumb horizontal slider (96 px thumb — a gloved-finger target), 0..1. No native
 * dependency: a PanResponder on the track. Touches always land on the track (the fill
 * and thumb are pointerEvents:none), so locationX is track-relative. It refuses to
 * hand the gesture to an enclosing ScrollView mid-drag.
 *
 * `onChange` fires while dragging (for live feedback like brightness); `onCommit` once
 * on release.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import type { Theme } from '../../theme/themes';

export const THUMB = 96;
const TRACK_H = 14;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function Slider({
  value,
  onChange,
  onCommit,
  disabled,
  t,
}: {
  value: number;
  onChange?: (v: number) => void;
  onCommit?: (v: number) => void;
  disabled?: boolean;
  t: Theme;
}) {
  const [width, setWidth] = useState(0);
  const [local, setLocal] = useState(clamp01(value));
  const dragging = useRef(false);
  const live = useRef({ width, local, disabled, onChange, onCommit });
  live.current = { width, local, disabled, onChange, onCommit };
  const startV = useRef(0);

  // follow the external value except mid-drag (the user's finger wins)
  useEffect(() => {
    if (!dragging.current) setLocal(clamp01(value));
  }, [value]);

  const pan = useMemo(() => {
    const travel = () => Math.max(1, live.current.width - THUMB);
    const set = (v: number) => {
      if (v === live.current.local) return;
      live.current.local = v;
      setLocal(v);
      live.current.onChange?.(v);
    };
    const end = () => {
      if (!dragging.current) return;
      dragging.current = false;
      live.current.onCommit?.(live.current.local);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !live.current.disabled,
      onMoveShouldSetPanResponder: () => !live.current.disabled,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        dragging.current = true;
        const v = clamp01((e.nativeEvent.locationX - THUMB / 2) / travel());
        startV.current = v;
        set(v);
      },
      onPanResponderMove: (_, g) => set(clamp01(startV.current + g.dx / travel())),
      onPanResponderRelease: end,
      onPanResponderTerminate: end,
    });
  }, []);

  const x = local * Math.max(0, width - THUMB);
  const color = disabled ? t.absent : t.accent;
  return (
    <View
      style={[styles.hit, { opacity: disabled ? 0.45 : 1 }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      {...pan.panHandlers}
    >
      <View style={[styles.track, { backgroundColor: t.panelBorder }]} />
      <View style={[styles.fill, { width: x + THUMB / 2, backgroundColor: color }]} />
      <View style={[styles.thumb, { left: x, borderColor: color, backgroundColor: t.bg }]}>
        <View style={[styles.grip, { backgroundColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { height: THUMB, justifyContent: 'center' },
  // children never take the touch: locationX must stay relative to the track
  track: { position: 'absolute', top: (THUMB - TRACK_H) / 2, left: 0, right: 0, height: TRACK_H, borderRadius: TRACK_H / 2, pointerEvents: 'none' },
  fill: { position: 'absolute', top: (THUMB - TRACK_H) / 2, left: 0, height: TRACK_H, borderRadius: TRACK_H / 2, pointerEvents: 'none' },
  thumb: {
    position: 'absolute',
    top: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  grip: { width: 22, height: 22, borderRadius: 11 },
});
