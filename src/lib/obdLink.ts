/**
 * OBD link policy — which bonded adapter to auto-connect to, and how often to retry.
 * Pure (no React / native) so `npm run verify` covers it; LiveDataSource drives it.
 *
 * The vLinker MC+ sleeps with the engine off and wakes a few seconds after the truck
 * starts, so the loop retries fast at first and then settles. Each failed attempt is a
 * Bluetooth page (~5 s of radio time) that can stutter phone audio on the same adapter,
 * so a dongle that has been missing for a while is retried slowly. Ignition-on (ACC) and
 * the launcher coming to the foreground reset the cadence.
 */

/**
 * ELM protocol to try first next time: ATDPN answers e.g. "A6" (auto, settled on 6) →
 * "6"; the init then sends ATSPA6 ("6, auto-fallback") instead of ATSP0's full search.
 */
export function protocolHint(atdpn: string | null | undefined): string | null {
  const m = /^A?([1-9A-C])$/i.exec((atdpn ?? '').trim());
  return m ? m[1].toUpperCase() : null;
}

/** Names cheap and branded ELM327 adapters advertise (clones are inconsistent). */
export const OBD_NAME = /OBD|ELM|VLINK|VIECAR|VEEPEAK|OBDII|SCAN|VGATE/i;

export interface BondedDevice {
  name: string;
  address: string;
}

export const OBD_RETRY_STEPS_MS: readonly number[] = [2000, 4000, 8000];
export const OBD_RETRY_STEADY_MS = 15_000;
export const OBD_RETRY_SLOW_MS = 60_000;
/** after this long without a connection, back off to OBD_RETRY_SLOW_MS */
export const OBD_RETRY_SLOW_AFTER_MS = 10 * 60_000;
/**
 * Right after launch / ignition-on the BT stack and the dongle are still waking: retry every
 * OBD_RETRY_BOOT_MS for this long instead of backing off (boot connect felt slow, 2026-10-26).
 */
export const OBD_BOOT_WINDOW_MS = 2 * 60_000;
export const OBD_RETRY_BOOT_MS = 3000;

/**
 * Delay before the next auto-connect attempt.
 * @param failures consecutive failed attempts so far (≥ 1 when a retry is being scheduled)
 * @param failingForMs time since the first of those failures
 */
export function obdRetryDelayMs(failures: number, failingForMs: number, sinceKickMs = Infinity): number {
  if (sinceKickMs < OBD_BOOT_WINDOW_MS) return OBD_RETRY_BOOT_MS;
  if (failingForMs >= OBD_RETRY_SLOW_AFTER_MS) return OBD_RETRY_SLOW_MS;
  const i = Math.max(1, Math.floor(failures)) - 1;
  return i < OBD_RETRY_STEPS_MS.length ? OBD_RETRY_STEPS_MS[i] : OBD_RETRY_STEADY_MS;
}

/** Likely OBD adapters first; never hides a device (clone names are unreliable). */
export function rankObdDevices<T extends BondedDevice>(devices: readonly T[]): T[] {
  return [...devices].sort((a, b) => Number(OBD_NAME.test(b.name)) - Number(OBD_NAME.test(a.name)));
}

/**
 * The adapter to auto-connect to: the remembered one if it is still bonded, otherwise
 * the first bonded device whose name looks like an OBD adapter. Never guesses a
 * non-OBD device (that could be a phone) — returns null and the loop waits.
 */
export function pickObdAdapter(bonded: readonly BondedDevice[], savedMac: string | null): string | null {
  const norm = (m: string) => m.trim().toUpperCase();
  if (savedMac) {
    const hit = bonded.find((d) => norm(d.address) === norm(savedMac));
    if (hit) return hit.address;
  }
  return bonded.find((d) => OBD_NAME.test(d.name))?.address ?? null;
}
