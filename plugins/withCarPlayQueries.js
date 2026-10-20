/**
 * Config plugin: Android 11+ package visibility for the phone-projection (CarPlay/AA)
 * app(s). Since Android 11, an app can't see/launch another package unless it's in
 * <queries>. These are the Dasaita/FYT projection packages (ZLink + EasyConnection) —
 * confirm yours via `adb shell pm list packages | grep -iE 'zlink|easyconn|carplay'`
 * and add it here if different (see src/carplay/launchCarPlay.ts). Applied at prebuild.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const PACKAGES = ['com.zjinnova.zlink', 'net.easyconn', 'com.autokit.link'];

module.exports = function withCarPlayQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    if (!Array.isArray(manifest.queries)) manifest.queries = manifest.queries ? [manifest.queries] : [{}];
    const q = manifest.queries[0] || (manifest.queries[0] = {});
    if (!Array.isArray(q.package)) q.package = q.package ? [q.package] : [];
    for (const name of PACKAGES) {
      if (!q.package.some((p) => p.$ && p.$['android:name'] === name)) {
        q.package.push({ $: { 'android:name': name } });
      }
    }
    return cfg;
  });
};
