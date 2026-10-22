/**
 * Speed Record (Signal Library 06): a tachograph disc — the last 90 s of ground speed
 * inked radially (faster = further out), newest at the 12 o'clock pen and receding
 * counter-clockwise; the newest 10 s glows, time spokes turn with the disc, and an
 * inner track carries RPM once OBD is live. The clock sits in the hub, as on a real
 * tachograph.
 *
 * Reads the always-on drive recorder (so the record is already 90 s deep when you
 * swipe here). Geometry is rebuilt only when a new sample lands (20 Hz); the spokes
 * spin from the loop as a rotation-only push. Renders through VizSurface.
 */
import React, { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { useTelemetry, shallowEqual } from '../../data/DataSourceProvider';
import { driveRecorder } from '../../data/driveRecorder';
import { RECORDER_SLOTS, readRecord } from '../../lib/driveRecorder';
import { HUB_FRAC, RECORD_SPAN_S, recordFrame, recordGrid, recordSpokes, speedRadius } from '../../lib/speedRecord';
import { clockTime } from '../../lib/format';
import { VizSurface } from './VizSurface';
import { VizLabel, useVizLoop } from './common';
import { createVizChannel, dot, type VizLayer } from './vizTypes';

export const SpeedRecord = React.memo(function SpeedRecord({ size }: { size: number }) {
  const t = useTheme();
  const channel = useMemo(createVizChannel, []);
  const cx = size / 2;
  const cy = size / 2;
  const R1 = size * 0.46;
  const R0 = R1 * 0.36;
  const k = Math.max(1, size / 400);

  const grid = useMemo(() => recordGrid(cx, cy, R0, R1), [cx, cy, R0, R1]);
  const spokes = useMemo(() => recordSpokes(cx, cy, R0, R1, 0), [cx, cy, R0, R1]);
  const hub = useMemo(() => {
    const r = R0 * HUB_FRAC;
    return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
  }, [cx, cy, R0]);

  const layers = useMemo<VizLayer[]>(
    () => [
      { id: 'minor', d: grid.minor, stroke: t.accent, opacity: 0.09, width: k },
      { id: 'major', d: grid.major, stroke: t.accent, opacity: 0.22, width: k },
      { id: 'spokeMajor', d: spokes.major, stroke: t.accent, opacity: 0.12, width: k, spin: true },
      { id: 'spokeMinor', d: spokes.minor, stroke: t.accent, opacity: 0.35, width: k, spin: true },
      { id: 'area', fill: t.accent, opacity: 0.07 },
      { id: 'line', stroke: t.accent, opacity: 0.6, width: 1.2 * k },
      { id: 'fresh', stroke: t.accent, width: 1.6 * k, glow: true },
      { id: 'rpm', stroke: t.accentAlt, opacity: 0.7, width: k },
      { id: 'hub', d: hub, stroke: t.accent, opacity: 0.3, width: k },
      { id: 'pen', d: grid.pen, stroke: t.text, opacity: 0.75, width: k },
      { id: 'head', fill: t.text },
    ],
    [grid, spokes, hub, t.accent, t.accentAlt, t.text, k]
  );

  // reusable buffers: no per-frame allocation for the 1800-sample copy
  const buf = useRef({ s: new Float32Array(RECORDER_SLOTS), r: new Float32Array(RECORDER_SLOTS) }).current;
  const seen = useRef(-1);
  const paths = useRef<Record<string, string>>({});
  const t0 = useRef<number | null>(null);

  useVizLoop(
    (now) => {
      if (t0.current == null) t0.current = now;
      const rot = -(((now - t0.current) / RECORD_SPAN_S) * Math.PI * 2);
      const r = driveRecorder;
      if (r.version !== seen.current) {
        seen.current = r.version;
        const n = readRecord(r, buf.s, buf.r);
        const fr = recordFrame({ cx, cy, R0, R1, speeds: buf.s.subarray(0, n), rpms: buf.r.subarray(0, n) });
        paths.current = {
          area: fr.area,
          line: fr.line,
          fresh: fr.fresh,
          rpm: fr.rpm,
          head: fr.head ? dot(fr.head.x, fr.head.y, 3.5 * k) : '',
        };
      }
      channel.set(paths.current, rot); // same paths object when only the spokes moved
    },
    [channel, cx, cy, R0, R1, k]
  );

  const { time, ampm } = useTelemetry((d) => clockTime(d.system.now), shallowEqual);
  const fs = Math.max(11, 9 * k);
  return (
    <View style={{ width: size, height: size }}>
      <VizSurface width={size} height={size} layers={layers} channel={channel} origin={[cx, cy]} />
      {[20, 40, 60].map((v) => (
        <VizLabel key={v} x={cx + 5 * k} y={cy - speedRadius(v, R0, R1) - fs * 1.5} size={fs} color={t.textFaint}>
          {v}
        </VizLabel>
      ))}
      <VizLabel x={cx} y={cy - R0 * 0.36} size={R0 * 0.34} color={t.text} align="center" mono={false} weight="600">
        {time}
      </VizLabel>
      <VizLabel x={cx} y={cy + R0 * 0.06} size={Math.max(11, R0 * 0.1)} color={t.textFaint} align="center">
        {ampm} · 90 S
      </VizLabel>
    </View>
  );
});
