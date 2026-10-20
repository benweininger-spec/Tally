# media-bridge — Tier B now-playing native module (STAGED, not yet active)

This is a local Expo Modules API module (Kotlin) that reads the active media
session (Spotify, the Bluetooth A2DP source, etc.) via Android's
`MediaSessionManager`, gated behind **Notification Listener access**. It maps to
`media.nowPlaying` in the `DataSource` contract.

## Why it lives in `native/` and not `modules/`

Expo autolinking scans `./modules` by default. Keeping this under `native/` means
it does **not** compile into your build yet — so your first Tier-A dev build (GPS +
sensors) can't be broken by it. Activate it only when you want media.

The JS side (`src/data/live/mediaBridge.ts`) resolves it by name with
`requireNativeModule('MediaBridge')` and **degrades to absent** if it isn't built
in — so the app runs fine with or without it.

## Activate it (Tier B)

Recommended (lets Expo generate a toolchain-correct gradle for your exact SDK):

```bash
npx create-expo-module@latest --local media-bridge
# then copy these over the generated files:
#   android/src/main/java/expo/modules/mediabridge/MediaBridgeModule.kt
#   android/src/main/java/expo/modules/mediabridge/MediaBridgeNotificationListenerService.kt
#   android/src/main/AndroidManifest.xml
#   expo-module.config.json
cp -R native/media-bridge/* modules/media-bridge/
```

Or copy as-is and let the included `build.gradle` try:

```bash
mkdir -p modules && cp -R native/media-bridge modules/media-bridge
```

Then rebuild the dev client:

```bash
npx expo prebuild --clean
npx expo run:android      # or: cd android && ./gradlew installDebug
```

Native changes never hot-reload — you must rebuild.

## Grant access on the head unit

`MediaSessionManager.getActiveSessions` throws `SecurityException` until the user
enables the listener: **Settings → Apps → Special app access → Notification access
→ Tacoma Dash**. The in-app **SETTINGS → MEDIA ACCESS → GRANT ACCESS** button
deep-links there.

⚠️ **Sideloaded apps on Android 13** may show the toggle greyed out
("Restricted setting"). Fix: **App info → ⋮ (top-right) → Allow restricted
settings**, then enable the listener.
