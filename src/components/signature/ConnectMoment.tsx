/**
 * The "OBD connected" moment. Mounted over a PulseTach (same box); on the obd.connected
 * false → true EDGE it starts the shared connect sweep — PulseTach sweeps the ring once,
 * re-labels RING · SPEED → RPM and ignites the redline (src/lib/sweep.ts) — and fades a
 * mono ticker into the open bottom of the ring: `OBD LINK · ELM327 · <adapter>`.
 *
 * Edge-triggered only: mounting while already connected (app start, swiping onto a
 * face later) plays nothing. REDUCED motion keeps the ticker but skips the sweep.
 * Ticker opacity runs on the native driver; nothing here re-renders per frame.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet } from 'react-native';
import { useSourceControls, useTelemetry } from '../../data/DataSourceProvider';
import { useTheme } from '../../theme/ThemeProvider';
import { useMotionPref } from '../../settings/MotionPref';
import { startSweep } from './sweepChannel';

const NATIVE = Platform.OS !== 'web';

export const ConnectMoment = React.memo(function ConnectMoment({ size }: { size: number }) {
  const t = useTheme();
  const connected = useTelemetry((d) => d.obd.connected);
  const { live, mode } = useSourceControls();
  const { reduced } = useMotionPref();
  const prev = useRef(connected);
  const [ticker, setTicker] = useState<string | null>(null);
  const op = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const was = prev.current;
    prev.current = connected;
    if (!connected || was) return;
    if (!reduced) startSweep('connect');
    const name = live?.getStatus().obdAdapterName || (mode === 'sim' ? 'SIMULATED' : 'ADAPTER');
    setTicker(`OBD LINK · ELM327 · ${name.toUpperCase()}`);
    op.setValue(0);
    const anim = Animated.sequence([
      Animated.timing(op, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }),
      Animated.delay(2400),
      Animated.timing(op, { toValue: 0, duration: 900, easing: Easing.in(Easing.quad), useNativeDriver: NATIVE }),
    ]);
    anim.start(() => setTicker(null)); // finished, or stopped by a quick disconnect
    return () => anim.stop();
    // live/mode/reduced are read at the edge only; re-running on them would replay it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, op]);

  if (!ticker) return null;
  return (
    <Animated.Text
      numberOfLines={1}
      style={[
        styles.ticker,
        { top: size * 0.885, width: size, fontSize: Math.max(16, size * 0.025), color: t.accentSoft, opacity: op },
      ]}
    >
      {ticker}
    </Animated.Text>
  );
});

const styles = StyleSheet.create({
  ticker: {
    position: 'absolute',
    left: 0,
    textAlign: 'center',
    fontFamily: 'JetBrains Mono',
    letterSpacing: 4,
    pointerEvents: 'none',
  },
});
