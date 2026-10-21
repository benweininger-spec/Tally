/**
 * THE SIGNATURE — SVG renderer. Oscilloscope pulse (longitudinal-g history) wrapped
 * by a radial gauge that reads RPM when OBD is live, ground speed before. Modeled on
 * the Tesla Model S energy graph.
 *
 * This is the WEB renderer (PulseTach.web.tsx) and the native FALLBACK if Skia is
 * unavailable; on the head unit the hot path is PulseTachSkia. Both share the display
 * model (pulseModel.ts) and the geometry (src/lib/pulse.ts).
 *
 * Perf + feel (post-audit):
 *  - Decoupled from the React render tree: it reads the source directly and runs
 *    its OWN throttled loop (~25fps cap) instead of re-rendering on every data
 *    tick. When nothing visible changes (parked) it stops rendering entirely.
 *  - Smooth, not jumpy: a critically-damped follower glides the ring/number/arc
 *    between the discrete GPS/OBD samples (which arrive 2–5Hz) so it never snaps.
 *  - Waveform decimated (240→~100 pts) and scaled to real longitudinal g (±0.40g).
 *  - "Moments" (cold-start sweep, OBD-connect sweep) play inside the same loop.
 */
import React, { useEffect, useMemo, useReducer, useRef } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import { useDataSource } from '../../data/DataSourceProvider';
import { useTheme } from '../../theme/ThemeProvider';
import { buildWaveform, gaugeProgress, gaugeRedline, gaugeTicks, gaugeTrack } from '../../lib/pulse';
import { nowMs } from './sweepChannel';
import {
  LOOP_MS,
  WAVE_RANGE_G,
  WAVE_SAMPLES,
  captionFor,
  createPulseDisp,
  decimate,
  pulseLayout,
  redlineOpacityFor,
  stepPulse,
} from './pulseModel';

export const PulseTach = React.memo(function PulseTach({ size = 720 }: { size?: number }) {
  const source = useDataSource();
  const t = useTheme();
  const [, force] = useReducer((c: number) => (c + 1) % 1_000_000, 0);
  // smoothed display values, mutated by the loop (never trigger a render themselves)
  const disp = useRef(createPulseDisp()).current;
  const sigRef = useRef('');
  const L = useMemo(() => pulseLayout(size), [size]);

  // own animation loop: advance the follower toward the latest target each frame,
  // render only when a quantized signature changes (so idle ≈ zero renders/CPU).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let last = 0;
    const step = () => {
      const now = nowMs();
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.033;
      last = now;
      const sig = stepPulse(disp, source.getSnapshot(), source.getHistory().longG, now, dt);
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        force();
      }
      timer = setTimeout(step, LOOP_MS);
    };
    step();
    return () => clearTimeout(timer);
  }, [source, disp]);

  const { cx, cy, rArc } = L;
  // static geometry — recomputed only when size / gauge-mode changes, not per frame
  const track = useMemo(() => gaugeTrack(cx, cy, rArc), [cx, cy, rArc]);
  const redline = useMemo(() => gaugeRedline(cx, cy, rArc, L.redFrac), [cx, cy, rArc, L.redFrac]);
  const obdLive = disp.obdLive;
  const ticks = useMemo(() => gaugeTicks(L.ticks(obdLive)), [L, obdLive]);

  const rpm = Math.round(disp.rpm);
  const speed = Math.round(disp.speed);
  const frac = disp.frac;

  const wave = buildWaveform({
    samples: decimate(source.getHistory().longG, WAVE_SAMPLES),
    ...L.wave,
    range: WAVE_RANGE_G,
  });

  const progress = gaugeProgress(cx, cy, rArc, frac);
  const sw = t.stroke; // day theme thickens the ring for direct sun
  const headColor = disp.longG >= 0 ? t.accent : t.warn;
  const redlineOpacity = redlineOpacityFor(disp);
  const caption = captionFor(disp);

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Defs>
          <LinearGradient id="waveFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={t.accent} stopOpacity={0.28} />
            <Stop offset="0.5" stopColor={t.accent} stopOpacity={0.06} />
            <Stop offset="1" stopColor={t.accent} stopOpacity={0.28} />
          </LinearGradient>
        </Defs>

        {/* dim full track */}
        <Path d={track} stroke={t.panelBorder} strokeWidth={10 * sw} fill="none" strokeLinecap="round" />

        {/* redline zone (only meaningful with OBD/RPM) */}
        {obdLive && redlineOpacity > 0.01 && (
          <Path d={redline} stroke={t.warn} strokeOpacity={redlineOpacity} strokeWidth={10 * sw} fill="none" strokeLinecap="round" />
        )}

        {/* lit progress: soft underglow + crisp top */}
        {progress && (
          <>
            <Path d={progress} stroke={t.accent} strokeOpacity={0.22} strokeWidth={22 * sw} fill="none" strokeLinecap="round" />
            <Path d={progress} stroke={t.accent} strokeWidth={9 * sw} fill="none" strokeLinecap="round" />
          </>
        )}

        {/* ticks */}
        {ticks.map((tk, i) => (
          <Line
            key={i}
            x1={tk.x1}
            y1={tk.y1}
            x2={tk.x2}
            y2={tk.y2}
            stroke={tk.frac <= frac ? t.accent : t.panelBorder}
            strokeWidth={(tk.major ? 3 : 1.4) * sw}
            opacity={tk.major ? 0.95 : 0.6}
          />
        ))}

        {/* zero baseline for the scope */}
        <Line
          x1={L.wave.x}
          y1={wave.baseline}
          x2={L.wave.x + L.wave.width}
          y2={wave.baseline}
          stroke={t.hairline}
          strokeWidth={1}
          strokeDasharray="2 6"
        />

        {/* waveform */}
        <Path d={wave.fill} fill="url(#waveFill)" />
        <Path d={wave.line} stroke={t.accent} strokeWidth={3 * sw} fill="none" strokeLinejoin="round" />
        {/* leading-edge glow dot */}
        <Circle cx={wave.head.x} cy={wave.head.y} r={9} fill={headColor} opacity={0.25} />
        <Circle cx={wave.head.x} cy={wave.head.y} r={4.5} fill={headColor} />

        {/* RPM indicator at the very top of the ring — only meaningful with OBD */}
        <SvgText
          x={cx}
          y={L.rpmY}
          fill={obdLive ? t.accentSoft : t.absent}
          fontSize={size * 0.03}
          fontFamily={t.fontMono}
          textAnchor="middle"
          letterSpacing={3}
        >
          {obdLive ? `${rpm} RPM` : 'RING · SPEED'}
        </SvgText>

        {/* signature caption — sits just above the waveform */}
        <SvgText
          x={cx}
          y={L.captionY}
          fill={t.textFaint}
          fontSize={size * 0.022}
          fontFamily={t.fontMono}
          textAnchor="middle"
          letterSpacing={5}
        >
          {caption}
        </SvgText>

        {/* center readout — always ground speed, in the LOWER half below the wave */}
        <SvgText
          x={cx}
          y={L.speedY}
          fill={t.accent}
          fontSize={size * 0.205}
          fontFamily={t.fontDisplay}
          fontWeight="700"
          textAnchor="middle"
        >
          {speed}
        </SvgText>
        <SvgText
          x={cx}
          y={L.unitY}
          fill={t.textFaint}
          fontSize={size * 0.026}
          fontFamily={t.fontMono}
          textAnchor="middle"
          letterSpacing={4}
        >
          MPH · GROUND SPEED
        </SvgText>
      </Svg>
    </View>
  );
});
