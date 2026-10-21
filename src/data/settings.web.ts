/**
 * Persisted launcher settings (WEB variant — Metro picks this on web).
 *
 * Mirrors `settings.ts` exactly but backs onto `localStorage`, so the web design
 * preview never references `@react-native-async-storage/async-storage`. This is
 * what keeps "App still runs on web in sim mode unchanged" true even before the
 * native deps are installed.
 */
import type { Calibration } from '../lib/imu';
import type { DockTile } from '../dock/defaults';

export type SourceMode = 'sim' | 'live';
export type ThemeMode = 'light' | 'auto' | 'dark';
export type FaceId = 'home' | 'drive' | 'trail' | 'night';
export const FACE_IDS: FaceId[] = ['home', 'drive', 'trail', 'night'];

const KEY_MODE = 'tacoma-dash:sourceMode';
const KEY_CAL = 'tacoma-dash:imuCalibration';
const KEY_OBD_MAC = 'tacoma-dash:obdMac';
const KEY_THEME = 'tacoma-dash:themeMode';
const KEY_DOCK = 'tacoma-dash:dock';
const KEY_FACE = 'tacoma-dash:face';
const KEY_MOTION = 'tacoma-dash:reducedMotion';

const ls = (): Storage | null => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

export async function loadSourceMode(): Promise<SourceMode> {
  return ls()?.getItem(KEY_MODE) === 'live' ? 'live' : 'sim';
}

export async function saveSourceMode(mode: SourceMode): Promise<void> {
  ls()?.setItem(KEY_MODE, mode);
}

export async function loadCalibration(): Promise<Calibration | null> {
  const v = ls()?.getItem(KEY_CAL);
  return v ? (JSON.parse(v) as Calibration) : null;
}

export async function saveCalibration(cal: Calibration): Promise<void> {
  ls()?.setItem(KEY_CAL, JSON.stringify(cal));
}

export async function loadObdMac(): Promise<string | null> {
  return ls()?.getItem(KEY_OBD_MAC) ?? null;
}

export async function saveObdMac(mac: string): Promise<void> {
  ls()?.setItem(KEY_OBD_MAC, mac);
}

export async function loadThemeMode(): Promise<ThemeMode> {
  const v = ls()?.getItem(KEY_THEME);
  return v === 'light' || v === 'dark' ? v : 'auto';
}

export async function saveThemeMode(mode: ThemeMode): Promise<void> {
  ls()?.setItem(KEY_THEME, mode);
}

export async function loadDock(): Promise<DockTile[] | null> {
  const v = ls()?.getItem(KEY_DOCK);
  return v ? (JSON.parse(v) as DockTile[]) : null;
}

export async function saveDock(tiles: DockTile[]): Promise<void> {
  ls()?.setItem(KEY_DOCK, JSON.stringify(tiles));
}

export async function loadFace(): Promise<FaceId> {
  const v = ls()?.getItem(KEY_FACE);
  return FACE_IDS.includes(v as FaceId) ? (v as FaceId) : 'home';
}

export async function saveFace(face: FaceId): Promise<void> {
  ls()?.setItem(KEY_FACE, face);
}

export async function loadReducedMotion(): Promise<boolean> {
  return ls()?.getItem(KEY_MOTION) === '1';
}

export async function saveReducedMotion(reduced: boolean): Promise<void> {
  ls()?.setItem(KEY_MOTION, reduced ? '1' : '0');
}
