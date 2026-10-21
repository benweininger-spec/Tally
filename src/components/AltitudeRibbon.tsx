/**
 * Altitude profile (last ~5 mi, distance-sampled) + live road grade. Terrain-style
 * filled area built with the signature's own waveform geometry (src/lib/pulse.ts,
 * `floor` fill), vertical range = the rolling max of the visible window with a floor
 * so a flat road doesn't amplify GPS noise into mountains. The last 0.1 mi — the
 * window the grade is measured over — is drawn in the grade color.
 *
 * Perf: like PulseTach it reads History directly and runs its own 2 Hz poll, waking
 * only when the profile actually changed (a new sample lands every 0.02 mi ≈ 1.8 s at
 * 40 mph). Parked, it never re-renders.
 */
import React, { useEffect, useReducer, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { useDataSource } from '../data/DataSourceProvider';
import { useTheme } from '../theme/ThemeProvider';
import { buildWaveform } from '../lib/pulse';
import { ALT_SAMPLE_MI, gradePct } from '../lib/derive';

const GRADE_WARN = 10; // % — steeper reads in the warn color
const MIN_HALF_FT = 25; // vertical scale floor (± ft around the window's middle)
const GRADE_WINDOW = Math.round(0.1 / ALT_SAMPLE_MI); // samples in the grade window

export const AltitudeRibbon = React.memo(function AltitudeRibbon({
  width,
  height,
  compact = false,
}: {
  width: number;
  height: number;
  /** strip cell: smaller numerals, no altitude/distance captions */
  compact?: boolean;
}) {
  const source = useDataSource();
  const t = useTheme();
  const [, force] = useReducer((c: number) => (c + 1) % 1_000_000, 0);
  const sigRef = useRef('');

  useEffect(() => {
    const step = () => {
      const a = source.getHistory().altitude;
      let sum = 0;
      for (const v of a) sum += v;
      const sig = `${a.length}|${Math.round(sum)}|${Math.round(a[a.length - 1] ?? 0)}`;
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        force();
      }
    };
    step();
    const id = setInterval(step, 500);
    return () => clearInterval(id);
  }, [source]);

  const alt = source.getHistory().altitude;
  const n = alt.length;
  const grade = gradePct(alt);
  const steep = grade != null && Math.abs(grade) > GRADE_WARN;
  const gradeColor = grade == null ? t.absent : steep ? t.warn : t.accent;

  const numW = compact ? 150 : 300;
  const chartW = Math.max(40, width - numW - (compact ? 12 : 32));
  const chartH = height;
  const pad = compact ? 6 : 10;

  let line = '';
  let fill = '';
  let tail = '';
  let head = { x: chartW, y: chartH / 2 };
  if (n >= 2) {
    let min = Infinity;
    let max = -Infinity;
    for (const v of alt) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const mid = (min + max) / 2;
    const half = Math.max(MIN_HALF_FT, (max - min) / 2);
    const rel = alt.map((v) => v - mid);
    const geom = { x: 0, y: pad, width: chartW, height: chartH - 2 * pad, range: half };
    const w = buildWaveform({ ...geom, samples: rel, floor: true });
    line = w.line;
    fill = w.fill;
    head = w.head;
    const k = Math.min(GRADE_WINDOW, n - 1);
    const tailW = buildWaveform({
      ...geom,
      samples: rel.slice(-(k + 1)),
      x: ((n - 1 - k) / (n - 1)) * chartW,
      width: (k / (n - 1)) * chartW,
    });
    tail = tailW.line;
  }

  const spanMi = Math.max(0, (n - 1) * ALT_SAMPLE_MI);
  const gradeText = grade == null ? '—' : `${grade >= 0 ? '+' : '−'}${Math.abs(grade).toFixed(1)}`;
  const gradientId = compact ? 'altFillC' : 'altFill';

  return (
    <View style={[styles.row, { width, height }]}>
      <View style={{ width: chartW, height: chartH }}>
        <Svg width={chartW} height={chartH} viewBox={`0 0 ${chartW} ${chartH}`}>
          <Defs>
            <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={t.accent} stopOpacity={0.26} />
              <Stop offset="1" stopColor={t.accent} stopOpacity={0.02} />
            </LinearGradient>
          </Defs>
          {n >= 2 ? (
            <>
              <Path d={fill} fill={`url(#${gradientId})`} />
              <Path d={line} stroke={t.accentSoft} strokeWidth={compact ? 1.5 : 2} fill="none" strokeLinejoin="round" />
              <Path d={tail} stroke={gradeColor} strokeWidth={compact ? 3 : 4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              <Circle cx={head.x - 3} cy={head.y} r={compact ? 4 : 6} fill={gradeColor} />
            </>
          ) : (
            <Path d={`M 0 ${chartH / 2} L ${chartW} ${chartH / 2}`} stroke={t.hairline} strokeWidth={1} strokeDasharray="2 6" />
          )}
        </Svg>
        {!compact && (
          <Text style={[styles.caption, { color: t.textFaint }]}>
            {n >= 2 ? `ALTITUDE · LAST ${spanMi.toFixed(1)} MI` : 'ALTITUDE · AWAITING GPS'}
          </Text>
        )}
      </View>

      <View style={[styles.numBlock, { width: numW }]}>
        <Text style={[styles.label, { color: t.textFaint, fontSize: compact ? 12 : 14 }]}>GRADE</Text>
        <Text style={[styles.grade, { color: gradeColor, fontSize: compact ? 30 : 72, lineHeight: compact ? 36 : 80 }]}>
          {gradeText}
          <Text style={{ fontSize: compact ? 16 : 30, color: t.textDim }}> %</Text>
        </Text>
        {!compact && (
          <Text style={[styles.alt, { color: t.textDim }]}>
            {n >= 1 ? `${Math.round(alt[n - 1]).toLocaleString()} ft` : '— ft'}
          </Text>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  caption: { position: 'absolute', left: 0, top: 0, fontFamily: 'JetBrains Mono', fontSize: 13, letterSpacing: 3 },
  numBlock: { alignItems: 'flex-end', justifyContent: 'center' },
  label: { fontFamily: 'JetBrains Mono', letterSpacing: 3 },
  grade: { fontFamily: 'Oxanium', fontWeight: '700' },
  alt: { fontFamily: 'JetBrains Mono', fontSize: 16, letterSpacing: 2, marginTop: 2 },
});
