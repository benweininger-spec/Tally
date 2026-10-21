/**
 * Horizontal pager for the mode faces. No gesture-handler / reanimated dependency: a
 * PanResponder (capture phase, horizontal-dominant moves only, so taps and vertical
 * drags still reach the widgets) drives ONE Animated value — the pager position in
 * stage px — and every face is translated off it (transform only, native driver).
 *
 * Only the active face is mounted at rest; the neighbor in the drag direction mounts
 * when a drag starts and the old face unmounts once the swipe settles. Faces are
 * memoized, so an unmounted face costs nothing.
 *
 * Faces are full-stage layers (2000×1200 coordinates) positioned inside a viewport
 * that spans only the face area (header bottom → dock top), so swipes that start on
 * the header or dock never page.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Platform, StyleSheet, View } from 'react-native';
import { STAGE_H, STAGE_W, useStageScale } from '../components/Stage';

export const FACE_TOP = 92; // header bottom
export const FACE_BOTTOM = 1000; // just above the dock (top 1018)

const SWIPE_PX = 180; // stage px past which a release commits
const FLICK = 0.5; // stage px/ms that commits regardless of distance
const NATIVE = Platform.OS !== 'web';

export interface FaceDef {
  id: string;
  Comp: React.ComponentType;
}

export function FacePager({
  faces,
  index,
  onIndexChange,
}: {
  faces: FaceDef[];
  index: number;
  onIndexChange: (i: number) => void;
}) {
  const scale = useStageScale();
  const n = faces.length;
  const pos = useRef(new Animated.Value(-index * STAGE_W)).current;
  const indexRef = useRef(index);
  const dirRef = useRef<0 | -1 | 1>(0);
  const animating = useRef(false);
  const [dragDir, setDragDir] = useState<0 | -1 | 1>(0);
  const cb = useRef({ onIndexChange, scale, n });
  cb.current = { onIndexChange, scale, n };

  // an index change from outside (dots, night suggestion) jumps without animating
  useEffect(() => {
    if (indexRef.current === index) return;
    pos.stopAnimation();
    indexRef.current = index;
    dirRef.current = 0;
    setDragDir(0);
    pos.setValue(-index * STAGE_W);
  }, [index, pos]);

  // one translateX per face: pager position + the face's slot
  const offsets = useMemo(
    () => Array.from({ length: n }, (_, i) => Animated.add(pos, i * STAGE_W)),
    [n, pos]
  );

  const pan = useMemo(() => {
    const settle = (dxWin: number, vxWin: number) => {
      const { scale: s, n: count } = cb.current;
      const i = indexRef.current;
      const dx = dxWin / (s || 1);
      const vx = vxWin / (s || 1);
      let target = i;
      if ((dx <= -SWIPE_PX || (vx <= -FLICK && dx < 0)) && i < count - 1) target = i + 1;
      else if ((dx >= SWIPE_PX || (vx >= FLICK && dx > 0)) && i > 0) target = i - 1;
      animating.current = true;
      Animated.timing(pos, {
        toValue: -target * STAGE_W,
        duration: target === i ? 200 : 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: NATIVE,
      }).start(() => {
        animating.current = false;
        dirRef.current = 0;
        if (target !== i) {
          indexRef.current = target;
          cb.current.onIndexChange(target);
        }
        setDragDir(0); // unmount the face that slid away (batched with the index change)
      });
    };

    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) =>
        !animating.current && Math.abs(g.dx) > 18 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
      onPanResponderGrant: () => pos.stopAnimation(),
      onPanResponderMove: (_, g) => {
        const { scale: s, n: count } = cb.current;
        const i = indexRef.current;
        let dx = g.dx / (s || 1);
        const dir: -1 | 1 = dx < 0 ? 1 : -1; // swipe left reveals the next face
        const hasNeighbor = i + dir >= 0 && i + dir < count;
        if (!hasNeighbor) dx *= 0.22; // rubber-band at the ends
        else if (dirRef.current !== dir) {
          dirRef.current = dir;
          setDragDir(dir);
        }
        pos.setValue(-i * STAGE_W + dx);
      },
      onPanResponderRelease: (_, g) => settle(g.dx, g.vx),
      onPanResponderTerminate: (_, g) => settle(g.dx, g.vx),
      onPanResponderTerminationRequest: () => false,
    });
  }, [pos]);

  const neighbor = dragDir !== 0 && index + dragDir >= 0 && index + dragDir < n ? index + dragDir : -1;

  return (
    <View style={styles.viewport} {...pan.panHandlers}>
      {faces.map((f, i) =>
        i === index || i === neighbor ? (
          <Animated.View key={f.id} style={[styles.layer, { transform: [{ translateX: offsets[i] }] }]}>
            <f.Comp />
          </Animated.View>
        ) : null
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: {
    position: 'absolute',
    left: 0,
    top: FACE_TOP,
    width: STAGE_W,
    height: FACE_BOTTOM - FACE_TOP,
  },
  // full-stage layer so faces keep stage coordinates
  // (box-none: empty areas fall through to the viewport / header beneath)
  layer: { position: 'absolute', left: 0, top: -FACE_TOP, width: STAGE_W, height: STAGE_H, pointerEvents: 'box-none' },
});
