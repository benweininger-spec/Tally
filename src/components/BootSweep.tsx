/**
 * Cold-start "instruments powering up" — once per process start. A full-stage veil in
 * the theme background fades out (native driver, opacity only) while PulseTach plays
 * the boot sweep from the shared sweep channel: ring 0 → 100% → onto live, ticks
 * lighting in sequence, numerals counting up, caption typing in. The numeral is live
 * speed by BOOT_LIVE_BY_MS (950 ms) and everything is over by BOOT_MS (1.2 s) — it
 * never holds back the first real readout. Skipped entirely with SET → MOTION → REDUCED.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useMotionPref } from '../settings/MotionPref';
import { startSweep } from './signature/sweepChannel';

const VEIL_MS = 320;
const NATIVE = Platform.OS !== 'web';

// module-level: the launcher process lives across HOME presses / remounts, so this
// plays on a real cold start only
let played = false;

export function BootSweep() {
  const t = useTheme();
  const { reduced } = useMotionPref();
  const [show, setShow] = useState(!played);
  const veil = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!show || reduced == null) return; // wait for the stored preference
    played = true;
    if (reduced) {
      setShow(false);
      return;
    }
    startSweep('boot');
    const anim = Animated.timing(veil, {
      toValue: 0,
      duration: VEIL_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: NATIVE,
    });
    anim.start(() => setShow(false));
    return () => anim.stop();
  }, [show, reduced, veil]);

  if (!show) return null;
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { backgroundColor: t.bg, opacity: veil, pointerEvents: 'none' }]}
    />
  );
}
