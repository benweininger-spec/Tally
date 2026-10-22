/**
 * Attitude Mesh (Signal Library 07) with the owner's truck: a wireframe 3rd-gen
 * Tacoma Access Cab (src/lib/tacoma.ts, built from Toyota's published dimensions) on
 * scrolling terrain, tilted by live pitch / roll — EXAGGERATED ×1.8 so a few degrees
 * of camber still read, and labelled as such; the true angles sit beside it on the
 * Trail face. The accent up-vector against the dashed true vertical IS the lean.
 *
 * Own ~25 fps loop: recomputes only when the (quantized) attitude or the travelled
 * distance changes, so a parked truck costs nothing. Renders through VizSurface.
 */
import React, { useMemo, useRef } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { useDataSource } from '../../data/DataSourceProvider';
import { GRID_ALPHAS, MESH_TILT_GAIN, meshFrame } from '../../lib/mesh';
import { TACOMA_ACCESS_CAB } from '../../lib/tacoma';
import { VizSurface } from './VizSurface';
import { VizLabel, useVizLoop } from './common';
import { createVizChannel, type VizLayer } from './vizTypes';

export const AttitudeMesh = React.memo(function AttitudeMesh({ width, height }: { width: number; height: number }) {
  const t = useTheme();
  const source = useDataSource();
  const channel = useMemo(createVizChannel, []);
  const k = Math.max(1, height / 400);

  const layers = useMemo<VizLayer[]>(
    () => [
      ...GRID_ALPHAS.map((a, i): VizLayer => ({ id: `g${i}`, stroke: t.accent, opacity: a, width: k * 0.9 })),
      { id: 'shadowBg', fill: t.bg, opacity: 0.85 },
      { id: 'shadow', fill: t.accent, opacity: 0.07 },
      { id: 'vertical', stroke: t.text, opacity: 0.35, width: k, dash: [3 * k, 4 * k] },
      { id: 'detail', stroke: t.accent, opacity: 0.5, width: k * 0.9 },
      { id: 'wheels', stroke: t.accent, width: k, glow: true },
      { id: 'body', stroke: t.accent, width: 1.3 * k, glow: true },
      { id: 'up', stroke: t.accentAlt, width: 1.4 * k, glow: true },
    ],
    [t.accent, t.accentAlt, t.text, t.bg, k]
  );

  const state = useRef({ distM: 0, sig: '' }).current;

  useVizLoop(
    (_now, dt) => {
      const s = source.getSnapshot();
      const p = s.motion.pitchDeg;
      const r = s.motion.rollDeg;
      // no sensors → the truck sits level (never a broken/blank instrument)
      const hasAtt = (p.status !== 'absent' && p.value != null) || (r.status !== 'absent' && r.value != null);
      const pitch = hasAtt ? p.value ?? 0 : 0;
      const roll = hasAtt ? r.value ?? 0 : 0;
      state.distM += (s.motion.speedMph.value ?? 0) * 0.44704 * dt;
      const sig = `${Math.round(pitch * 10)}|${Math.round(roll * 10)}|${Math.round(state.distM * 20)}`;
      if (sig === state.sig) return;
      state.sig = sig;
      const m = meshFrame({ w: width, h: height, distM: state.distM, pitchDeg: pitch, rollDeg: roll, model: TACOMA_ACCESS_CAB });
      const paths: Record<string, string> = {
        shadowBg: m.shadow,
        shadow: m.shadow,
        vertical: m.vertical,
        detail: m.detail,
        wheels: m.wheels,
        body: m.body,
        up: m.up,
      };
      m.grid.forEach((d, i) => (paths[`g${i}`] = d));
      channel.set(paths);
    },
    [source, channel, width, height]
  );

  const fs = Math.max(12, 10 * k);
  return (
    <View style={{ width, height }}>
      <VizSurface width={width} height={height} layers={layers} channel={channel} />
      <VizLabel x={fs} y={fs} size={fs} color={t.textFaint}>
        ATTITUDE · TILT ×{MESH_TILT_GAIN}
      </VizLabel>
      <VizLabel x={fs} y={fs * 2.6} size={fs * 0.85} color={t.absent}>
        TACOMA · ACCESS CAB · 6.1 FT BED
      </VizLabel>
    </View>
  );
});
