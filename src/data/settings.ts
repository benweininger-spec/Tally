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
export type FaceId = 'home' | 'drive' | 'engine' | 'trail' | 'night';
export const FACE_IDS: FaceId[] = ['home', 'drive', 'engine', 'trail', 'night'];
/** NIGHT face hero: the original minimal ring, the speed-record disc, or the G-Scope. */
export type NightStyle = 'ring' | 'record' | 'scope';
const NIGHT_STYLES: NightStyle[] = ['ring', 'record', 'scope'];

const KEY_MODE = 'tacoma-dash:sourceMode';
const KEY_CAL = 'tacoma-dash:imuCalibration';
const KEY_OBD_MAC = 'tacoma-dash:obdMac';
const KEY_THEME = 'tacoma-dash:themeMode';
const KEY_DOCK = 'tacoma-dash:dock';
const KEY_FACE = 'tacoma-dash:face';
const KEY_MOTION = 'tacoma-dash:reducedMotion';
const KEY_NIGHT = 'tacoma-dash:nightStyle';
const KEY_MPG_LOG = 'tacoma-dash:mpgLog';

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

export async function loadFace(): Promise<FaceId> {
  try {
    const v = await AsyncStorage.getItem(KEY_FACE);
    return FACE_IDS.includes(v as FaceId) ? (v as FaceId) : 'home';
  } catch {
    return 'home';
  }
}

export async function saveFace(face: FaceId): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_FACE, face);
  } catch {
    /* non-fatal */
  }
}

export async function loadReducedMotion(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY_MOTION)) === '1';
  } catch {
    return false;
  }
}

export async function saveReducedMotion(reduced: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_MOTION, reduced ? '1' : '0');
  } catch {
    /* non-fatal */
  }
}

export async function loadNightStyle(): Promise<NightStyle> {
  try {
    const v = await AsyncStorage.getItem(KEY_NIGHT);
    return NIGHT_STYLES.includes(v as NightStyle) ? (v as NightStyle) : 'record';
  } catch {
    return 'record';
  }
}

export async function saveNightStyle(style: NightStyle): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_NIGHT, style);
  } catch {
    /* non-fatal */
  }
}

/** Long-term MPG log (src/lib/mpgLog.ts shape); normalised by the caller. */
export async function loadMpgLogRaw(): Promise<unknown> {
  try {
    const v = await AsyncStorage.getItem(KEY_MPG_LOG);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

export async function saveMpgLogRaw(log: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_MPG_LOG, JSON.stringify(log));
  } catch {
    /* non-fatal: the next debounced save retries */
  }
}
