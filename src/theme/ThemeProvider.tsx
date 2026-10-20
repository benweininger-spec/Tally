import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { Theme } from './themes';
import { amberDay, amberNight, selectTheme } from './themes';
import { useTelemetry } from '../data/DataSourceProvider';
import { loadThemeMode, saveThemeMode, type ThemeMode } from '../data/settings';

const ThemeContext = createContext<Theme>(selectTheme(false));
const ThemeModeContext = createContext<{ mode: ThemeMode; setMode: (m: ThemeMode) => void }>({
  mode: 'auto',
  setMode: () => {},
});

/**
 * Selects the amber night/day theme. `auto` (default) follows the live daylight
 * flag; `light`/`dark` are manual overrides set from the SET sheet and persisted.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const isDaylight = useTelemetry((d) => d.system.isDaylight);
  const [mode, setModeState] = useState<ThemeMode>('auto');
  // don't let the async load clobber a choice the user made during the load window
  const userSet = useRef(false);

  useEffect(() => {
    let alive = true;
    loadThemeMode().then((m) => {
      if (alive && !userSet.current) setModeState(m);
    });
    return () => {
      alive = false;
    };
  }, []);

  const setMode = (m: ThemeMode) => {
    userSet.current = true;
    setModeState(m);
    void saveThemeMode(m);
  };

  const theme = mode === 'light' ? amberDay : mode === 'dark' ? amberNight : selectTheme(isDaylight);

  return (
    <ThemeModeContext.Provider value={{ mode, setMode }}>
      <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
    </ThemeModeContext.Provider>
  );
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/** Theme-mode control (light / auto / dark) for the settings sheet. */
export function useThemeMode(): { mode: ThemeMode; setMode: (m: ThemeMode) => void } {
  return useContext(ThemeModeContext);
}
