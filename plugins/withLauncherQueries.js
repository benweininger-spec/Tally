/**
 * Config plugin: Android 11+ package visibility for the app drawer. A launcher must
 * see every MAIN/LAUNCHER activity on the unit; without this <queries><intent> entry
 * PackageManager.queryIntentActivities returns only our own app (and system ones), so
 * the drawer would be empty. Used by modules/app-list. Applied at prebuild.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const MAIN = 'android.intent.action.MAIN';
const LAUNCHER = 'android.intent.category.LAUNCHER';

module.exports = function withLauncherQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    if (!Array.isArray(manifest.queries)) manifest.queries = manifest.queries ? [manifest.queries] : [{}];
    const q = manifest.queries[0] || (manifest.queries[0] = {});
    if (!Array.isArray(q.intent)) q.intent = q.intent ? [q.intent] : [];
    const already = q.intent.some(
      (i) =>
        (i.action || []).some((a) => a.$['android:name'] === MAIN) &&
        (i.category || []).some((c) => c.$['android:name'] === LAUNCHER)
    );
    if (!already) {
      q.intent.push({
        action: [{ $: { 'android:name': MAIN } }],
        category: [{ $: { 'android:name': LAUNCHER } }],
      });
    }
    return cfg;
  });
};
