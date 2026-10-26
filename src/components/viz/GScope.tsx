/**
 * Phosphor G-Scope (Signal Library 04): lateral × longitudinal g as a glowing beam
 * with a decaying phosphor trail, inside rings at 0.2 / 0.4 / 0.6 / 0.8 g, plus the
 * session GRIP ENVELOPE (dashed): the peak |g| you've reached in each direction,
 * fading slowly. Hold to reset the peaks.
 *
 * Reads the always-on drive recorder in its own ~25 fps loop and only pushes geometry
 * when the recorder moved; renders through VizSurface (Skia on the unit). Labels are
 * RN text that re-renders at most ~10×/s, and only when the shown value changes.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { driveRecorder } from '../../data/driveRecorder';
import { resetEnvelope } from '../../lib/driveRecorder';
import { SCOPE_RINGS, TRAIL_BANDS, envelopePeak, gscopeFrame, gscopeGrid } from '../../lib/gscope';
import { VizSurface } from './VizSurface';
import { VizLabel, useVizLoop } from './common';
import { createVizChannel, dot, type VizLayer } from './vizTypes';

/** Readouts drawn by the host instead (small cards): receives { g, peak } on change. */
export type GReadout = { g: string; peak: string };

export const GScope = React.memo(function GScope({ size, onReadout }: { size: number; onReadout?: (r: GReadout) => void }) {
  const t = useTheme();
  const channel = useMemo(createVizChannel, []);
  const cx = size / 2;
  const cy = size / 2;
  const S = (size * 0.36) / 0.8; // px per g; the 0.8 g ring at 0.36·size
  const k = Math.max(1, size / 400); // stroke/label scale vs the 400 px study
  const grid = useMemo(() => gscopeGrid(cx, cy, S), [cx, cy, S]);

  const layers = useMemo<VizLayer[]>(
    () => [
      { id: 'inner', d: grid.inner, stroke: t.accent, opacity: 0.14, width: k },
      { id: 'outer', d: grid.outer, stroke: t.accent, opacity: 0.34, width: k },
      { id: 'cross', d: grid.cross, stroke: t.accent, opacity: 0.14, width: k },
      { id: 'envFill', fill: t.accentAlt, opacity: 0.06 },
      { id: 'env', stroke: t.accentAlt, opacity: 0.6, width: 1.2 * k, dash: [3 * k, 4 * k] },
      ...Array.from({ length: TRAIL_BANDS }, (_, b): VizLayer => {
        const a = (b + 1) / TRAIL_BANDS;
        return { id: `b${b}`, stroke: t.accent, opacity: a * a * 0.9, width: (1 + a * 1.6) * k };
      }),
      { id: 'halo', fill: t.accent, opacity: 0.18 },
      { id: 'beam', fill: t.text },
    ],
    [grid, t.accent, t.accentAlt, t.text, k]
  );

  const [readout, setReadout] = useState({ g: '—', peak: '0.00' });
  const lastReadout = useRef(readout);
  const seen = useRef(-1);
  const lastText = useRef(0);

  useVizLoop(
    (now) => {
      const r = driveRecorder;
      if (r.version === seen.current) return;
      seen.current = r.version;
      const fr = gscopeFrame({
        cx,
        cy,
        S,
        trail: r.trail.map((p) => [p[0], p[1]] as [number, number]),
        env: r.env,
        lat: r.lat,
        long: r.long,
      });
      const paths: Record<string, string> = { env: fr.envelope, envFill: fr.envelope };
      fr.bands.forEach((d, i) => (paths[`b${i}`] = d));
      if (r.gLive) {
        paths.halo = dot(fr.beam.x, fr.beam.y, 14 * k);
        paths.beam = dot(fr.beam.x, fr.beam.y, 4 * k);
      }
      channel.set(paths);

      if (now - lastText.current > 0.1) {
        lastText.current = now;
        const g = r.gLive ? Math.hypot(r.lat, r.long).toFixed(2) : '—';
        const peak = envelopePeak(r.env).toFixed(2);
        const cur = lastReadout.current;
        if (cur.g !== g || cur.peak !== peak) {
          const next = { g, peak };
          lastReadout.current = next;
          setReadout(next);
          onReadout?.(next); // from the loop, not a state updater (no cross-render update)
        }
      }
    },
    [channel, cx, cy, S, k, onReadout]
  );

  const fs = Math.max(15, 12 * k);
  const dim = t.textFaint;
  const edge = SCOPE_RINGS[SCOPE_RINGS.length - 1] * S;
  return (
    <Pressable onLongPress={() => resetEnvelope(driveRecorder)} delayLongPress={700} style={{ width: size, height: size }}>
      <View style={{ width: size, height: size }}>
        <VizSurface width={size} height={size} layers={layers} channel={channel} />
        {SCOPE_RINGS.map((g) => (
          // just INSIDE each ring, so the 0.8 label never collides with ACCEL above it
          <VizLabel key={g} x={cx + 4 * k} y={cy - g * S + fs * 0.25} size={fs * 0.9} color={t.textFaint}>
            {g.toFixed(1)}
          </VizLabel>
        ))}
        <VizLabel x={cx} y={cy - edge - fs * 2.2} size={fs} color={dim} align="center">ACCEL</VizLabel>
        <VizLabel x={cx} y={cy + edge + fs * 0.6} size={fs} color={dim} align="center">BRAKE</VizLabel>
        <VizLabel x={cx - edge - fs * 1.2} y={cy - fs * 0.7} size={fs} color={dim} align="center">L</VizLabel>
        <VizLabel x={cx + edge + fs * 1.2} y={cy - fs * 0.7} size={fs} color={dim} align="center">R</VizLabel>
        {/* readouts in the top corners (full-size scope); a small host card shows them
            in its own title row instead — at 300 px they can't clear ACCEL / BRAKE */}
        {!onReadout && (
          <>
            <VizLabel x={0} y={fs * 0.2} size={fs} color={dim}>
              PEAK {readout.peak}G
            </VizLabel>
            <VizLabel x={size} y={0} size={fs * 2} color={t.text} align="right" mono={false}>
              {readout.g === '—' ? '—' : `${readout.g}g`}
            </VizLabel>
          </>
        )}
      </View>
    </Pressable>
  );
});
