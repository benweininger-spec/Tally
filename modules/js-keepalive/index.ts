/**
 * JS face of the local JsKeepAlive module (NATIVE variant; `index.web.ts` is the stub).
 * Keeps JS timers alive while another app is in front — see the Kotlin header for why.
 * Optional-resolved: an older build without the module just doesn't keep alive.
 */
import { AppRegistry } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

interface JsKeepAliveNative {
  start(): Promise<boolean>;
  stop(): Promise<boolean>;
  isActive(): boolean;
}

const native = requireOptionalNativeModule<JsKeepAliveNative>('JsKeepAlive');
export const KEEPALIVE_TASK = 'TacomaKeepAlive';

let registered = false;
/** Register the never-ending headless task. Call once at startup (index.ts). */
export function registerKeepAliveTask(): void {
  if (registered) return;
  registered = true;
  // never settles: the native side finishes the task in stop()
  AppRegistry.registerHeadlessTask(KEEPALIVE_TASK, () => () => new Promise<void>(() => {}));
}

export async function startKeepAlive(): Promise<boolean> {
  try {
    return native ? await native.start() : false;
  } catch {
    return false;
  }
}

export async function stopKeepAlive(): Promise<void> {
  try {
    await native?.stop();
  } catch {
    /* best effort */
  }
}
