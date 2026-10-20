/**
 * Persisted launcher settings (NATIVE variant).
 *
 * Source mode (sim ↔ live) and the IMU mount calibration survive restarts via
 * `@react-native-async-storage/async-storage`. The matching `settings.web.ts`
 * uses `localStorage` so the web design preview never bundles a native module —
 * Metro picks the platform file automatically. Both expose the same API.
 *
 * Keep both files API-identical. Type-only import of `Calibration` keeps this
 * decoupled from the IMU runtime.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Calibration } from '../lib/imu';
import type { DockTile } from '../dock/defaults';

export type SourceMode = 'sim' | 'live';
export type ThemeMode = 'light' | 'auto' | 'dark';

const KEY_MODE = 'tacoma-dash:sourceMode';
const KEY_CAL = 'tacoma-dash:imuCalibration';
const KEY_OBD_MAC = 'tacoma-dash:obdMac';
const KEY_THEME = 'tacoma-dash:themeMode';
const KEY_DOCK = 'tacoma-dash:dock';

export async function loadSourceMode(): Promise<SourceMode> {
  try {
    const v = await AsyncStorage.getItem(KEY_MODE);
    return v === 'live' ? 'live' : 'sim';
  } catch {
    return 'sim';
  }
}

export async function saveSourceMode(mode: SourceMode): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_MODE, mode);
  } catch {
    /* non-fatal: fall back to defaulting on next launch */
  }
}

export async function loadCalibration(): Promise<Calibration | null> {
  try {
    const v = await AsyncStorage.getItem(KEY_CAL);
    return v ? (JSON.parse(v) as Calibration) : null;
  } catch {
    return null;
  }
}

export async function saveCalibration(cal: Calibration): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_CAL, JSON.stringify(cal));
  } catch {
    /* non-fatal */
  }
}

export async function loadObdMac(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY_OBD_MAC);
  } catch {
    return null;
  }
}

export async function saveObdMac(mac: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_OBD_MAC, mac);
  } catch {
    /* non-fatal */
  }
}

export async function loadThemeMode(): Promise<ThemeMode> {
  try {
    const v = await AsyncStorage.getItem(KEY_THEME);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export async function saveThemeMode(mode: ThemeMode): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_THEME, mode);
  } catch {
    /* non-fatal */
  }
}

export async function loadDock(): Promise<DockTile[] | null> {
  try {
    const v = await AsyncStorage.getItem(KEY_DOCK);
    return v ? (JSON.parse(v) as DockTile[]) : null;
  } catch {
    return null;
  }
}

export async function saveDock(tiles: DockTile[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_DOCK, JSON.stringify(tiles));
  } catch {
    /* non-fatal */
  }
}
