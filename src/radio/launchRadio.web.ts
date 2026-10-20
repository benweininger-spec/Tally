/**
 * Launch the factory radio app (WEB variant — Metro picks this on web). There's no
 * factory radio on web; the tuner runs in simulation, so this is a no-op. Keeps
 * expo-intent-launcher out of the web bundle.
 */
export const RADIO_PACKAGES: string[] = [];

export function launchFactoryRadio(): void {
  // eslint-disable-next-line no-console
  console.log('[radio] launchFactoryRadio is a no-op on web (factory radio is native-only).');
}
