/**
 * Radio state + controls, modeled as its own app-level provider (like the dock /
 * theme providers) rather than in the core DataSource contract — because on this
 * hardware the tuner is launch-only (no public tune/seek API; see the radio
 * research verdict). `controllable` is the honest present/absent flag:
 *
 *   - sim / web  → controllable: true  → an interactive, "alive" simulated tuner
 *   - live native → controllable: false → tuner reads absent; only launchFactory()
 *     works (opens the factory radio app, which grabs audio = the source switch)
 *
 * If an MCU bridge is ever built, flip controllable and feed real values here — the
 * MediaWidget needs no changes.
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useSourceControls } from '../data/DataSourceProvider';
import { launchFactoryRadio } from './launchRadio';

export type Band = 'FM' | 'AM';

export interface RadioState {
  /** can the tuner be driven from the launcher here? */
  controllable: boolean;
  band: Band;
  /** current frequency in kHz (FM 87.9–107.9 MHz, AM 530–1700 kHz) */
  frequencyKhz: number;
  stationName: string;
  signalPct: number;
  presets: number[]; // kHz
}

export interface RadioControls {
  seek(dir: 1 | -1): void;
  step(dir: 1 | -1): void;
  setBand(b: Band): void;
  recallPreset(khz: number): void;
  /** the real action on the unit: open the factory radio app */
  launchFactory(): void;
}

const FM = { min: 87900, max: 107900, step: 200, def: 101100, presets: [88500, 94900, 98100, 101100, 104500] };
const AM = { min: 530, max: 1700, step: 10, def: 1010, presets: [620, 710, 1010, 1130, 1500] };
const STATIONS = [
  'THE MOUNTAIN', 'KEXP', 'THE END', 'KISW', 'POWER', 'CLASSIC HITS', 'SONIC', 'THE WAVE', 'OUTLAW', 'PULSE FM',
];

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const stationFor = (khz: number) => STATIONS[Math.abs(Math.floor(khz / 100)) % STATIONS.length];

const Ctx = createContext<{ state: RadioState; controls: RadioControls; available: boolean } | null>(null);

export function RadioProvider({ children }: { children: React.ReactNode }) {
  const { mode, livePending } = useSourceControls();
  // live hardware tuner has no public control API; also treat an in-flight switch to
  // live as not-controllable so the tuner reads honest the instant live is requested.
  const controllable = mode === 'sim' && !livePending;

  const [state, setState] = useState<RadioState>({
    controllable,
    band: 'FM',
    frequencyKhz: FM.def,
    stationName: stationFor(FM.def),
    signalPct: 82,
    presets: FM.presets,
  });

  useEffect(() => {
    setState((s) => ({ ...s, controllable }));
  }, [controllable]);

  // a quietly "alive" signal meter while controllable (no animation lib needed)
  useEffect(() => {
    if (!controllable) return;
    const id = setInterval(() => {
      setState((s) => ({ ...s, signalPct: clamp(Math.round(s.signalPct + (Math.random() - 0.5) * 8), 35, 99) }));
    }, 500);
    return () => clearInterval(id);
  }, [controllable]);

  const bandCfg = (b: Band) => (b === 'FM' ? FM : AM);

  const controls: RadioControls = {
    seek: (dir) =>
      setState((s) => {
        if (!s.controllable) return s;
        const c = bandCfg(s.band);
        let f = s.frequencyKhz + dir * c.step * (3 + Math.floor(Math.random() * 8));
        if (f > c.max) f = c.min;
        if (f < c.min) f = c.max;
        return { ...s, frequencyKhz: f, stationName: stationFor(f), signalPct: clamp(72 + Math.round(Math.random() * 25), 35, 99) };
      }),
    step: (dir) =>
      setState((s) => {
        if (!s.controllable) return s;
        const c = bandCfg(s.band);
        let f = s.frequencyKhz + dir * c.step;
        if (f > c.max) f = c.min;
        if (f < c.min) f = c.max;
        return { ...s, frequencyKhz: f, stationName: stationFor(f) };
      }),
    setBand: (b) =>
      setState((s) => {
        if (!s.controllable || s.band === b) return s; // re-tapping the active band is a no-op
        const c = bandCfg(b);
        return { ...s, band: b, frequencyKhz: c.def, presets: c.presets, stationName: stationFor(c.def) };
      }),
    recallPreset: (khz) =>
      setState((s) => {
        if (!s.controllable) return s;
        return { ...s, frequencyKhz: khz, stationName: stationFor(khz), signalPct: clamp(75 + Math.round(Math.random() * 20), 35, 99) };
      }),
    launchFactory: () => {
      try {
        launchFactoryRadio();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[radio]', e);
      }
    },
  };

  return <Ctx.Provider value={{ state, controls, available: true }}>{children}</Ctx.Provider>;
}

export function useRadio() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useRadio must be used inside <RadioProvider>');
  return c;
}
