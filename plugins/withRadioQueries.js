/**
 * Config plugin: Android 11+ package visibility for the factory radio app(s).
 *
 * Since Android 11, an app can't see/launch another package unless it's declared in
 * <queries> (or holds QUERY_ALL_PACKAGES, which we avoid). These are the documented
 * FYT/SYU-stack radio packages Dasaita builds on — confirm yours via ADB and add it
 * here if different (see src/radio/launchRadio.ts). Applied at prebuild.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const PACKAGES = ['com.syu.radio', 'com.syu.carradio', 'com.fyt.radio'];

module.exports = function withRadioQueries(config) {
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
