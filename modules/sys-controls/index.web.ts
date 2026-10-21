/**
 * Web stub for SysControls: no system to control in the browser preview, so the SET
 * quick controls render disabled. Keeps expo-intent-launcher out of the web bundle.
 */
export interface SysState {
  canWriteSettings: boolean;
  brightness: number;
  volume: number;
  volumeSteps: number;
  screenTimeoutMs: number;
  bluetoothOn: boolean;
  wifiOn: boolean;
}

export const sysControlsAvailable = false;
export const TIMEOUT_NEVER = 2147483647;

export function getSysState(): SysState | null {
  return null;
}
export function requestWriteSettings(): void {}
export function setBrightness(_v: number): void {}
export function setVolume(_v: number): void {}
export function setScreenTimeout(_ms: number): void {}
export async function openBluetoothSettings(): Promise<void> {}
export async function openWifiSettings(): Promise<void> {}
