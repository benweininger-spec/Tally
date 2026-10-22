/**
 * Skia renderer for VizSurface (the unit's hot path). The channel's path strings and
 * rotation land in shared values; each layer's `path` is a derived value that Skia's
 * own processPath worklet turns into an SkPath on the UI thread. A push therefore
 * costs zero React renders.
 */
import React, { useEffect } from 'react';
import { Canvas, DashPathEffect, Group, Path, vec } from '@shopify/react-native-skia';
import { useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { EMPTY_PATH, type VizLayer, type VizSurfaceProps } from './vizTypes';

function SkiaLayer({ l, paths }: { l: VizLayer; paths: SharedValue<Record<string, string>> }) {
  const id = l.id;
  const fixed = l.d;
  const d = useDerivedValue(() => {
    const v = fixed ?? paths.value[id];
    return v && v.length > 4 ? v : EMPTY_PATH;
  });
  const op = l.opacity ?? 1;
  if (l.fill) return <Path path={d} style="fill" color={l.fill} opacity={op} />;
  const w = l.width ?? 1;
  const dash = l.dash ? <DashPathEffect intervals={l.dash} /> : null;
  const stroke = (width: number, opacity: number) => (
    <Path path={d} style="stroke" strokeWidth={width} strokeCap="round" strokeJoin="round" color={l.stroke} opacity={opacity}>
      {dash}
    </Path>
  );
  if (!l.glow) return stroke(w, op);
  return (
    <>
      {stroke(w * 5, op * 0.13)}
      {stroke(w * 2.2, op * 0.3)}
      {stroke(w, op)}
    </>
  );
}

export function VizSurface({ width, height, layers, channel, origin }: VizSurfaceProps) {
  const init = channel.get();
  const paths = useSharedValue<Record<string, string>>(init.paths);
  const rot = useSharedValue(init.rotation);
  useEffect(() => {
    let last = init.paths;
    return channel.subscribe(() => {
      const f = channel.get();
      // a rotation-only push must not make every layer re-parse its path
      if (f.paths !== last) {
        last = f.paths;
        paths.value = f.paths;
      }
      rot.value = f.rotation;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, paths, rot]);
  const spin = useDerivedValue(() => [{ rotate: rot.value }]);
  const [ox, oy] = origin ?? [width / 2, height / 2];
  const spun = layers.filter((l) => l.spin);
  return (
    <Canvas style={{ width, height }}>
      {layers.map((l) => (l.spin ? null : <SkiaLayer key={l.id} l={l} paths={paths} />))}
      {spun.length > 0 && (
        <Group transform={spin} origin={vec(ox, oy)}>
          {spun.map((l) => (
            <SkiaLayer key={l.id} l={l} paths={paths} />
          ))}
        </Group>
      )}
    </Canvas>
  );
}
