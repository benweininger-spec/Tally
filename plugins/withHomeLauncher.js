/**
 * Config plugin: make the app an Android HOME launcher (M4 / Phase A).
 *
 * Adds a second intent-filter to MainActivity with MAIN + HOME + DEFAULT so every
 * "home" press (and boot, once it's the default home) lands on the dashboard. The
 * stock launcher stays installed as a fallback — set/clear the default with:
 *   adb shell cmd package set-home-activity com.benji.tacomadash/.MainActivity
 * Applied at prebuild. launchMode is already singleTask, which is what a launcher wants.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withHomeLauncher(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    const main = app?.activity?.find((a) => a.$['android:name'] === '.MainActivity');
    if (!main) return cfg;
    main['intent-filter'] = main['intent-filter'] || [];
    const already = main['intent-filter'].some((f) =>
      (f.category || []).some((c) => c.$['android:name'] === 'android.intent.category.HOME')
    );
    if (!already) {
      main['intent-filter'].push({
        action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
        category: [
          { $: { 'android:name': 'android.intent.category.HOME' } },
          { $: { 'android:name': 'android.intent.category.DEFAULT' } },
        ],
      });
    }
    // a launcher must survive the task being cleared and take the screen back fast
    main.$['android:excludeFromRecents'] = 'true';
    main.$['android:stateNotNeeded'] = 'true';
    return cfg;
  });
};
