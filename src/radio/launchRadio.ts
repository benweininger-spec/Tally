/**
 * Launch the head unit's factory FM/AM radio app (NATIVE variant).
 *
 * Radio TUNING/source-switching has no public API on these units — the tuner is
 * MCU-driven and reached only via closed vendor JNI (the same wall as the Tier-D
 * CAN signals). What a normal app CAN do is *launch* the factory radio app, which
 * grabs audio focus — i.e. launching IS the "switch to radio", exactly like the
 * CarPlay launch-don't-embed rule.
 *
 * The package varies by firmware. These are the documented FYT/SYU-stack names
 * Dasaita builds on; confirm yours on-device and reorder:
 *   adb shell pm list packages | grep -iE 'radio|fm|tuner|syu|fyt'
 *   adb shell dumpsys activity activities | grep -i mResumedActivity   # open stock radio first
 * Package visibility for these is declared in plugins/withRadioQueries.js (Android 13).
 */
import * as IntentLauncher from 'expo-intent-launcher';

// com.microntek.radio is THIS unit's tuner app (FACT: `pm list packages`, launchable
// .MainActivity, 2026-10-23); the others are other FYT/SYU firmwares' names.
export const RADIO_PACKAGES = ['com.microntek.radio', 'com.syu.radio', 'com.syu.carradio', 'com.fyt.radio'];

/** Open the first installed factory-radio app. Throws if none resolve. */
export function launchFactoryRadio(packages: string[] = RADIO_PACKAGES): void {
  for (const pkg of packages) {
    try {
      IntentLauncher.openApplication(pkg); // throws if the package isn't installed
      return;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    'No factory radio app found. Confirm the package via ADB (pm list packages | grep radio) and update RADIO_PACKAGES + plugins/withRadioQueries.js.'
  );
}
