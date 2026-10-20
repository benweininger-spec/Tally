/**
 * THE SIGNATURE. Oscilloscope pulse (longitudinal-g history) wrapped by a radial
 * gauge that reads RPM when OBD is live, ground speed before. Modeled on the
 * Tesla Model S energy graph. Rendered in SVG for milestone 1 (runs everywhere);
 * the hot path ports to Skia for the Snapdragon 665 in milestone 2 — the geometry
 * already lives in src/lib/pulse.ts, so that swap won't touch this data wiring.
 *
 * Perf + feel (post-audit):
 *  - Decoupled from the React render tree: it reads the source directly and runs
 *    its OWN throttled loop (~25fps cap) instead of re-rendering on every 30fps
 *    data tick. When nothing visible changes (parked) it stops rendering entirely.
 *  - Smooth, not jumpy: a critically-damped follower glides the ring/number/arc
 *    between the discrete GPS/OBD samples (which arrive 2–5Hz) so it never snaps.
 *  - Waveform decimated (240→~100 pts) and scaled to real longitudinal g (±0.40g),
 *    so gentle street driving actually deflects the trace instead of reading flat.
 */
import React, { useEffect, useMemo, useReducer, useRef } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import { useDataSource } from '../../data/DataSourceProvider';
import { useTheme } from '../../theme/ThemeProvider';
import {
  buildWaveform,
  clamp,
  gaugeProgress,
  gaugeRedline,
  gaugeTicks,
  gaugeTrack,
} from '../../lib/pulse';

const RPM_FULL = 5500;
const REDLINE_RPM = 4700;
const SPEED_FULL = 80;
const WAVE_RANGE_G = 0.4; // real 2TR-FE street g fills the trace; was 0.55 (sim-tuned)
const WAVE_SAMPLES = 100; // decimated from HISTORY_LEN=240 — visually identical at ~720px

const nowMs = () => {
  const p = (globalThis as any).performance;
  return p && typeof p.now === 'function' ? p.now() : Date.now();
};

/** Even-sample a buffer down to `target` points, always keeping first + newest. */
function decimate(arr: number[], target: number): number[] {
  const n = arr.length;
  if (n <= target) return arr;
  const out: number[] = [];
  const stepF = (n - 1) / (target - 1);
  for (let i = 0; i < target; i++) out.push(arr[Math.round(i * stepF)]);
  return out;
}

export const PulseTach = React.memo(function PulseTach({ size = 720 }: { size?: number }) {
  const source = useDataSource();
  const t = useTheme();
  const [, force] = useReducer((c: number) => (c + 1) % 1_000_000, 0);
  // smoothed display values, mutated by the loop (never trigger a render themselves)
  const disp = useRef({ speed: 0, rpm: 0, frac: 0, longG: 0 }).current;
  const sigRef = useRef('');
  const obdRef = useRef(false);

  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size * 0.47;
  const rArc = rOuter - 26;
  const redFrac = REDLINE_RPM / RPM_FULL;

  // own animation loop: advance the follower toward the latest target each frame,
  // render only when a quantized signature changes (so idle ≈ zero renders/CPU).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let last = 0;
    const step = () => {
      const now = nowMs();
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.033;
      last = now;

      const s = source.getSnapshot();
      const obdLive = s.obd.connected && s.obd.rpm.status !== 'absent' && s.obd.rpm.value != null;
      const speedT = s.motion.speedMph.value ?? 0;
      const rpmT = obdLive ? (s.obd.rpm.value as number) : 0;
      const fracT = obdLive ? clamp(rpmT / RPM_FULL, 0, 1) : clamp(speedT / SPEED_FULL, 0, 1);
      const longGT = s.motion.longG.value ?? 0;

      // critically-damped follower: k = 1 - e^(-dt/τ)
      disp.speed += (speedT - disp.speed) * (1 - Math.exp(-dt / 0.18));
      disp.rpm += (rpmT - disp.rpm) * (1 - Math.exp(-dt / 0.12));
      disp.frac += (fracT - disp.frac) * (1 - Math.exp(-dt / 0.18));
      disp.longG += (longGT - disp.longG) * (1 - Math.exp(-dt / 0.08));
      obdRef.current = obdLive;

      const hist = source.getHistory().longG;
      const newest = hist.length ? hist[hist.length - 1] : 0;
      const sig =
        `${obdLive ? 1 : 0}|${Math.round(disp.speed)}|${Math.round(disp.rpm / 20)}` +
        `|${Math.round(disp.frac * 400)}|${Math.round(disp.longG * 200)}|${Math.round(newest * 200)}`;
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        force();
      }
      timer = setTimeout(step, 40); // ~25fps cap
    };
    step();
    return () => clearTimeout(timer);
  }, [source, disp]);

  // static geometry — recomputed only when size / gauge-mode changes, not per frame
  const track = useMemo(() => gaugeTrack(cx, cy, rArc), [cx, cy, rArc]);
  const redline = useMemo(() => gaugeRedline(cx, cy, rArc, redFrac), [cx, cy, rArc, redFrac]);
  const obdLive = obdRef.current;
  const ticks = useMemo(
    () =>
      gaugeTicks({
        cx,
        cy,
        rOuter: rArc + 14,
        minorLen: 10,
        majorLen: 22,
        count: obdLive ? 55 : 40,
        majorEvery: obdLive ? 5 : 4,
      }),
    [cx, cy, rArc, obdLive]
  );

  const rpm = Math.round(disp.rpm);
  const speed = Math.round(disp.speed);
  const frac = disp.frac;

  const wave = buildWaveform({
    samples: decimate(source.getHistory().longG, WAVE_SAMPLES),
    x: cx - rArc * 0.78,
    y: cy - size * 0.205,
    width: rArc * 1.56,
    height: size * 0.15,
    range: WAVE_RANGE_G,
  });

  const progress = gaugeProgress(cx, cy, rArc, frac);
  const headColor = disp.longG >= 0 ? t.accent : t.warn;

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
        <Path d={track} stroke={t.panelBorder} strokeWidth={10} fill="none" strokeLinecap="round" />

        {/* redline zone (only meaningful with OBD/RPM) */}
        {obdLive && (
          <Path d={redline} stroke={t.warn} strokeOpacity={0.5} strokeWidth={10} fill="none" strokeLinecap="round" />
        )}

        {/* lit progress: soft underglow + crisp top */}
        {progress && (
          <>
            <Path d={progress} stroke={t.accent} strokeOpacity={0.22} strokeWidth={22} fill="none" strokeLinecap="round" />
            <Path d={progress} stroke={t.accent} strokeWidth={9} fill="none" strokeLinecap="round" />
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
            strokeWidth={tk.major ? 3 : 1.4}
            opacity={tk.major ? 0.95 : 0.6}
          />
        ))}

        {/* zero baseline for the scope */}
        <Line
          x1={cx - rArc * 0.78}
          y1={wave.baseline}
          x2={cx + rArc * 0.78}
          y2={wave.baseline}
          stroke={t.hairline}
          strokeWidth={1}
          strokeDasharray="2 6"
        />

        {/* waveform */}
        <Path d={wave.fill} fill="url(#waveFill)" />
        <Path d={wave.line} stroke={t.accent} strokeWidth={3} fill="none" strokeLinejoin="round" />
        {/* leading-edge glow dot */}
        <Circle cx={wave.head.x} cy={wave.head.y} r={9} fill={headColor} opacity={0.25} />
        <Circle cx={wave.head.x} cy={wave.head.y} r={4.5} fill={headColor} />

        {/* RPM indicator at the very top of the ring — only meaningful with OBD */}
        <SvgText
          x={cx}
          y={cy - size * 0.3}
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
          y={cy - size * 0.235}
          fill={t.textFaint}
          fontSize={size * 0.022}
          fontFamily={t.fontMono}
          textAnchor="middle"
          letterSpacing={5}
        >
          DRIVE PULSE · LONGITUDINAL G
        </SvgText>

        {/* center readout — always ground speed, in the LOWER half below the wave */}
        <SvgText
          x={cx}
          y={cy + size * 0.16}
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
          y={cy + size * 0.215}
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
