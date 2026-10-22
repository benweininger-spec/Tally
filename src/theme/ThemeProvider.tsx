import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import type { Theme } from './themes';
import { amberDay, amberNight, lerpTheme, selectTheme } from './themes';
import { useTelemetry } from '../data/DataSourceProvider';
import { loadThemeMode, saveThemeMode, type ThemeMode } from '../data/settings';

const ThemeContext = createContext<Theme>(selectTheme(false));
const ThemeModeContext = createContext<{ mode: ThemeMode; setMode: (m: ThemeMode) => void }>({
  mode: 'auto',
  setMode: () => {},
});

/** AUTO's dusk/dawn flip fades over 30 s — slow enough the driver never sees a jump. */
export const AUTO_FADE_MS = 30_000;
/** A tap on LIGHT / DARK answers promptly instead. */
const MANUAL_FADE_MS = 500;
/** Published blend steps per fade: consumers re-render at most this many times. */
const FADE_STEPS = 60;

/**
 * Selects the amber night/day theme. `auto` (default) follows the live daylight
 * flag; `light`/`dark` are manual overrides set from the SET sheet and persisted.
 *
 * Changes crossfade instead of snapping: a JS-driven Animated value (it only ticks
 * DURING a fade) is quantized to FADE_STEPS and each step publishes one blended theme
 * (lerpTheme), so the whole tree re-renders ≤ 60 times per fade and never after. A
 * change mid-fade restarts from whatever is on screen, so it never jumps. The stored
 * mode arriving at startup snaps (no fade on boot).
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // AUTO: the headlight line wins when the unit reports it (CarPlay behaviour);
  // lights OFF falls back to the clock so a dark driveway stays dark.
  const isDaylight = useTelemetry((d) => d.system.headlights !== true && d.system.isDaylight);
  const [mode, setModeState] = useState<ThemeMode>('auto');
  const [loaded, setLoaded] = useState(false);
  // don't let the async load clobber a choice the user made during the load window
  const userSet = useRef(false);
  // when the user last tapped LIGHT/AUTO/DARK: a target change right after a tap is
  // theirs (fast fade); any other change is the sun (slow fade)
  const tappedAt = useRef(0);

  useEffect(() => {
    let alive = true;
    loadThemeMode().then((m) => {
      if (!alive) return;
      if (!userSet.current) setModeState(m);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const setMode = (m: ThemeMode) => {
    userSet.current = true;
    tappedAt.current = Date.now();
    setModeState(m);
    void saveThemeMode(m);
  };

  const target = mode === 'light' ? amberDay : mode === 'dark' ? amberNight : selectTheme(isDaylight);
  const shown = useCrossfade(target, loaded, tappedAt);

  const modeValue = useMemo(() => ({ mode, setMode }), [mode]);
  return (
    <ThemeModeContext.Provider value={modeValue}>
      <ThemeContext.Provider value={shown}>{children}</ThemeContext.Provider>
    </ThemeModeContext.Provider>
  );
}

/** Published theme that fades toward `target` (snaps until `ready`). */
function useCrossfade(target: Theme, ready: boolean, tappedAt: React.MutableRefObject<number>): Theme {
  const [shown, setShown] = useState<Theme>(target);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const anim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (target === shownRef.current) return;
    if (!ready) {
      setShown(target); // initial / stored-mode resolution: no fade on boot
      return;
    }
    const from = shownRef.current;
    const duration = Date.now() - tappedAt.current < 1000 ? MANUAL_FADE_MS : AUTO_FADE_MS;
    let step = 0;
    anim.stopAnimation();
    anim.setValue(0);
    const id = anim.addListener(({ value }) => {
      const q = Math.round(value * FADE_STEPS);
      if (q === step) return;
      step = q;
      setShown(q >= FADE_STEPS ? target : lerpTheme(from, target, q / FADE_STEPS));
    });
    Animated.timing(anim, {
      toValue: 1,
      duration,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: false, // JS value: we read it to build the blended tokens
    }).start(({ finished }) => {
      anim.removeListener(id);
      if (finished) setShown(target);
    });
    return () => {
      anim.removeListener(id);
      anim.stopAnimation();
    };
  }, [target, ready, anim, tappedAt]);

  return shown;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/** Force a palette for a subtree (e.g. the Night face's dimmed tokens). */
export function ThemeOverride({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/** Theme-mode control (light / auto / dark) for the settings sheet. */
export function useThemeMode(): { mode: ThemeMode; setMode: (m: ThemeMode) => void } {
  return useContext(ThemeModeContext);
}
