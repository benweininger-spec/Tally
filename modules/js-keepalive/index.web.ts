/** Web stub: browsers don't pause timers the way RN-Android does; nothing to keep alive. */
export const KEEPALIVE_TASK = 'TacomaKeepAlive';
export function registerKeepAliveTask(): void {}
export async function startKeepAlive(): Promise<boolean> {
  return false;
}
export async function stopKeepAlive(): Promise<void> {}
