/**
 * SVG renderer for VizSurface — the web renderer and the native fallback. Re-renders
 * on every channel push (fine on web; on the unit this only runs if Skia failed).
 */
import React, { useEffect, useState } from 'react';
import Svg, { G, Path } from 'react-native-svg';
import { safePath, type VizLayer, type VizSurfaceProps } from './vizTypes';

function SvgLayer({ l, d }: { l: VizLayer; d: string }) {
  const op = l.opacity ?? 1;
  if (l.fill) return <Path d={d} fill={l.fill} fillOpacity={op} />;
  const common = {
    d,
    stroke: l.stroke,
    fill: 'none',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeDasharray: l.dash ? `${l.dash[0]} ${l.dash[1]}` : undefined,
  };
  const w = l.width ?? 1;
  if (!l.glow) return <Path {...common} strokeWidth={w} strokeOpacity={op} />;
  return (
    <>
      <Path {...common} strokeWidth={w * 5} strokeOpacity={op * 0.13} />
      <Path {...common} strokeWidth={w * 2.2} strokeOpacity={op * 0.3} />
      <Path {...common} strokeWidth={w} strokeOpacity={op} />
    </>
  );
}

export function VizSurface({ width, height, layers, channel, origin }: VizSurfaceProps) {
  const [frame, setFrame] = useState(channel.get());
  useEffect(() => channel.subscribe(() => setFrame(channel.get())), [channel]);
  const d = (l: VizLayer) => safePath(l.d ?? frame.paths[l.id]);
  const spun = layers.filter((l) => l.spin);
  const [ox, oy] = origin ?? [width / 2, height / 2];
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {layers.map((l) => (l.spin ? null : <SvgLayer key={l.id} l={l} d={d(l)} />))}
      {spun.length > 0 && (
        <G rotation={(frame.rotation * 180) / Math.PI} originX={ox} originY={oy}>
          {spun.map((l) => (
            <SvgLayer key={l.id} l={l} d={d(l)} />
          ))}
        </G>
      )}
    </Svg>
  );
}
