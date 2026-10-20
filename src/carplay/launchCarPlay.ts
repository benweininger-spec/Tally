/**
 * Launch the phone-projection (CarPlay/Android-Auto) app. Design-brief §9: CarPlay
 * is a DESTINATION we launch, never an embed — it renders full-screen from the phone
 * over Apple's encrypted pipeline and exposes no API.
 *
 * On this Dasaita/FYT unit the projection app is ZLink (com.zjinnova.zlink). ZLink
 * ships SEVERAL launcher activities (CarPlay, HiCar, …), so a plain package launch
 * pops the system resolver — we target its CarPlayActivity directly instead. If a
 * different unit uses another projection app, the fallbacks below try the whole app
 * and then EasyConnection.
 *
 * NOTE: the target packages must be declared in <queries> (plugins/withCarPlayQueries.js)
 * or Android 11+ package visibility hides them and every launch throws.
 */
import * as IntentLauncher from 'expo-intent-launcher';

const FLAG_ACTIVITY_NEW_TASK = 0x10000000;

/** Explicit component we prefer (skips ZLink's CarPlay/HiCar chooser). */
const ZLINK_CARPLAY = {
  packageName: 'com.zjinnova.zlink',
  className: 'com.zjinnova.android.zlink.features.launcher.CarPlayActivity',
};

/** Whole-app fallbacks, in priority order, if the explicit activity isn't there. */
const FALLBACK_PACKAGES = ['com.zjinnova.zlink', 'net.easyconn'];

export async function launchCarPlay(): Promise<void> {
  // 1) ZLink's CarPlay activity directly.
  try {
    await IntentLauncher.startActivityAsync('android.intent.action.MAIN', {
      packageName: ZLINK_CARPLAY.packageName,
      className: ZLINK_CARPLAY.className,
      flags: FLAG_ACTIVITY_NEW_TASK,
    });
    return;
  } catch {
    // fall through to whole-app launches
  }
  // 2) Whole projection app (may show its own launcher), first that resolves wins.
  for (const pkg of FALLBACK_PACKAGES) {
    try {
      await IntentLauncher.openApplication(pkg);
      return;
    } catch {
      // try the next candidate
    }
  }
  throw new Error('CarPlay app not found — is the ZLink / EasyConnection dongle app installed?');
}
