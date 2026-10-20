/**
 * Config plugin: Android 12+ Bluetooth permissions for react-native-bluetooth-classic
 * (the OBD ELM327 transport). The library's own "with-rn-bluetooth-classic" plugin
 * is abandoned (2022, iOS-only), so we add the permissions ourselves with the
 * correct Android 12+ flags:
 *   - BLUETOOTH_SCAN  → usesPermissionFlags="neverForLocation" (we connect by MAC,
 *     so we never need location for scanning)
 *   - BLUETOOTH / BLUETOOTH_ADMIN → maxSdkVersion="30" (legacy, pre-Android-12)
 *   - BLUETOOTH_CONNECT → the one that, if missing, SecurityException-crashes connect
 *
 * Applied at prebuild. ACCESS_FINE_LOCATION is intentionally NOT added here — pair
 * the dongle once in Android settings and connect by address to skip the location
 * prompt entirely.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const PERMS = [
  { name: 'android.permission.BLUETOOTH_CONNECT' },
  { name: 'android.permission.BLUETOOTH_SCAN', flags: 'neverForLocation' },
  { name: 'android.permission.BLUETOOTH', maxSdk: '30' },
  { name: 'android.permission.BLUETOOTH_ADMIN', maxSdk: '30' },
];

module.exports = function withBluetoothClassic(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] || [];
    const list = manifest['uses-permission'];
    const has = (n) => list.some((p) => p.$ && p.$['android:name'] === n);

    for (const perm of PERMS) {
      if (has(perm.name)) continue;
      const entry = { $: { 'android:name': perm.name } };
      if (perm.flags) entry.$['android:usesPermissionFlags'] = perm.flags;
      if (perm.maxSdk) entry.$['android:maxSdkVersion'] = perm.maxSdk;
      list.push(entry);
    }
    return cfg;
  });
};
