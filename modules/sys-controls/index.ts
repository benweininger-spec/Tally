/**
 * JS face of the local SysControls Kotlin module (NATIVE variant; `index.web.ts` is the
 * browser stub). Optional-resolved, so a dev client built before the module existed
 * shows the SET quick controls disabled instead of crashing.
 */
import { requireOptionalNativeModule } from 'expo';
import * as IntentLauncher from 'expo-intent-launcher';

export interface SysState {
  /** user granted "Modify system settings" (brightness + timeout need it) */
  canWriteSettings: boolean;
  brightness: number; // 0..1
  volume: number; // 0..1 (media stream)
  volumeSteps: number;
  screenTimeoutMs: number;
  /** Android global font scale (1.0 = normal) */
  fontScale: number;
  bluetoothOn: boolean;
  wifiOn: boolean;
}

interface SysControlsNative {
  getState(): SysState;
  requestWriteSettings(): void;
  setBrightness(v: number): void;
  setVolume(v: number): void;
  setScreenTimeout(ms: number): void;
  setFontScale(scale: number): void;
}

const native = requireOptionalNativeModule<SysControlsNative>('SysControls');

export const sysControlsAvailable = native != null;
/** Settings.System.SCREEN_OFF_TIMEOUT value Android treats as "never". */
export const TIMEOUT_NEVER = 2147483647;

export function getSysState(): SysState | null {
  try {
    return native?.getState() ?? null;
  } catch {
    return null;
  }
}

export function requestWriteSettings(): void {
  native?.requestWriteSettings();
}

/** Throws if WRITE_SETTINGS isn't granted. */
export function setBrightness(v: number): void {
  native?.setBrightness(v);
}

export function setVolume(v: number): void {
  native?.setVolume(v);
}

/** Throws if WRITE_SETTINGS isn't granted. */
export function setScreenTimeout(ms: number): void {
  native?.setScreenTimeout(ms);
}

// Radios can't be toggled by apps on API 33 — deep-link to the system pages instead.
export async function openBluetoothSettings(): Promise<void> {
  await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.BLUETOOTH_SETTINGS);
}

export async function openWifiSettings(): Promise<void> {
  await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.WIFI_SETTINGS);
}

/** Throws if WRITE_SETTINGS isn't granted. */
export function setFontScale(scale: number): void {
  native?.setFontScale(scale);
}
