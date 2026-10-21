# Implementation plan — items 1–10 (Phases B + C)

For the implementing model. Read `CLAUDE.md` first (esp. **Perf model** and **Hard
constraints**), then `docs/ARCHITECTURE.md`. Repo branch: `old-launcher` on
https://github.com/benweininger-spec/Tally.git. Work in order; each item is
independently shippable. Verify on web (`npm run web`, sim mode) before any device build;
`npx tsc --noEmit --ignoreDeprecations 6.0` and `npm run verify` must stay clean.

## Non-negotiables (apply to every item)
- **Perf model.** No per-frame data in React context. Every new widget: `React.memo` +
  `useTelemetry(selector)` from `src/data/DataSourceProvider.tsx`, selecting primitives
  or `shallowEqual` objects, quantized so idle doesn't wake it. No continuous JS-driven
  motion outside PulseTach's loop until item 10 (Skia).
- **Stage is 2000×1200, absolute layout** (`src/screens/HomeScreen.tsx`, `Stage.tsx`).
  Touch targets ≥ 96 px. Glanceable: safety data readable < 1 s.
- **Theme tokens only** (`src/theme/themes.ts`): no hard-coded colors. Fonts: `'Oxanium'`
  (display) / `'JetBrains Mono'` (labels) — already loaded natively.
- **Graceful absence**: every readout handles `Signal` status `absent` (never a blank gauge).
- Pure logic goes in `src/lib` with no React/native imports (so `npm run verify` can run it).
- Native changes (new modules, manifest) need `npx expo prebuild -p android --clean`, then
  `android/local.properties` (`sdk.dir=~/Library/Android/sdk`), then `push-to-truck.command`.
- Update `CLAUDE.md` "Current state" when an item lands.

---

## 1. App drawer  (M)
**Goal.** Replace hand-typed dock URLs with a real launcher: all installed apps with icons;
tap opens; long-press pins/unpins to the dock.
**Native.** New Expo module `modules/app-list` (copy the shape of `modules/media-bridge`:
`expo-module.config.json` + `android/build.gradle` + Kotlin). Functions:
`listApps(): [{package, label, iconDataUri}]` via `PackageManager.queryIntentActivities`
(MAIN+LAUNCHER), icons rendered to ≤96 px PNG data URIs, cached in-module;
`launch(package)` via `getLaunchIntentForPackage` + `FLAG_ACTIVITY_NEW_TASK`.
Add `<queries><intent><action android:name="android.intent.action.MAIN"/><category
android:name="android.intent.category.LAUNCHER"/></intent></queries>` via a config plugin
(clone `plugins/withCarPlayQueries.js`) — required on Android 11+ to see other apps.
Web stub (`index.web.ts`) returns a fixed fake list so the sim still renders.
**JS.** `src/apps/AppsProvider.tsx` (loads once, memoized); `src/screens/AppDrawer.tsx`
(full-stage grid, 6×3 tiles @ 2000×1200, paging if > 18, amber tile style, label under icon);
open from a new dock tile "APPS" (keep CarPlay + SET pinned). Dock tiles become
`{id,label,package}` instead of `{label,url}` — migrate `src/dock/defaults.ts`,
`DockConfig.tsx`, `SettingsUI.tsx` DOCK section (keep a URL fallback for deep links).
Long-press tile → pin to dock (persist via existing dock storage).
**Verify.** Web: fake list renders, pin/unpin persists across reload. Device: tap opens
Waze/Spotify; CarPlay still launches ZLink.

## 2. Calmer Home + swipe mode faces  (L)
**Goal.** Home shows only what you need at a glance; dense instruments live one swipe away.
Faces: **Home** (PulseTach, clock/status header, media strip, dock) · **Drive**
(today's full layout: attitude, traction, compass, vehicle, telemetry) · **Trail**
(big inclinometer hero: `GyroCard` math at 2× size, altitude/grade, heading; dock stays) ·
**Night** (speed numeral, hairline ring, clock, nothing else; all tokens at ~40% luminance).
**Build.** `src/screens/faces/{HomeFace,DriveFace,TrailFace,NightFace}.tsx` reusing existing
widgets as-is (they're memoized, so unmounted faces cost nothing). `src/screens/FacePager.tsx`:
horizontal pager with `react-native-gesture-handler`-free implementation — use a
`PanResponder` on the Stage with a threshold swipe (≥ 180 px, velocity) and an `Animated`
translateX with `useNativeDriver: true` (transform only — no layout animation). Render only
the active face + the neighbor during a drag. Persist last face (`src/data/settings.ts`).
Small dots indicator bottom-center; dock is shared (rendered once above the pager).
**Night** auto-suggests when `isDaylight` false (a toast "NIGHT FACE ↗", never auto-switch).
**Verify.** Web: swipe between 4 faces at 60 fps in sim; gfxinfo on device after.

## 3. Quick controls in SET  (M)
**Goal.** Brightness, volume, Bluetooth, Wi-Fi, screen-timeout without opening Android Settings.
**Native.** Extend the app-list module (or new `modules/sys-controls`):
`setBrightness(0..1)` via `Settings.System.SCREEN_BRIGHTNESS` (needs `WRITE_SETTINGS`;
prompt via `Settings.ACTION_MANAGE_WRITE_SETTINGS` once — add to manifest with a plugin),
`getBrightness()`, `setVolume(stream, 0..1)` / `getVolume()` via `AudioManager`
(STREAM_MUSIC), `isBtOn/isWifiOn` via `BluetoothAdapter`/`WifiManager` (read only —
toggling BT/Wi-Fi programmatically is blocked on API 33; **deep-link** instead:
`Settings.ACTION_BLUETOOTH_SETTINGS`, `ACTION_WIFI_SETTINGS` via `expo-intent-launcher`),
`setScreenTimeout(ms)` via `Settings.System.SCREEN_OFF_TIMEOUT`.
**JS.** New SET section "QUICK CONTROLS" at the top of `SettingsUI.tsx`: two big sliders
(brightness, volume; 96 px thumbs), two status rows with OPEN buttons (BT, Wi-Fi), a
timeout chip row (1 / 5 / 30 min / never). Also show the real Wi-Fi/LTE state in the Header:
add `expo-network` (`getNetworkStateAsync`) to a `connectivityProvider` in
`src/data/live/`, feed `system.wifi/lte` (currently hard-coded `false` in
`LiveDataSource.ts:~255`).
**Verify.** Device only for the setters; web renders the section with disabled controls.

## 4. Startup sweep  (S/M)
**Goal.** ≤ 1.2 s "instruments powering up" on cold start: ring sweeps 0→100→0, ticks light
in sequence, numerals count up, caption types in — then settles to live. Hard-capped so it
never delays the first real speed readout past 1.2 s.
**Build.** `src/components/BootSweep.tsx` overlays the Home face once per process start
(ref flag in `App.tsx`). Drive it with a single `Animated.Value` (native driver) mapped via
`interpolate` to PulseTach props: add optional `overrideFrac?: number` and
`overrideSpeed?: number` props to `PulseTach` (it already takes props; respect them in its
loop instead of the follower while the override is set). Fade overlay out at the end.
Skip entirely if `prefers reduced motion` setting exists in SET (add a toggle).
**Verify.** Web reload shows the sweep once; second navigation doesn't.

## 5. Altitude + grade ribbon  (M)
**Goal.** Last ~5 mi elevation profile + live GRADE %.
**Data.** Add `altitude: number[]` to `History` (`src/data/types.ts`), maintained in both
sources: sample every 0.02 mi of `trip.distanceMi` (not per tick) into a 250-slot ring
(≈5 mi). Grade = Δalt / Δdist over the last ~0.1 mi, pure function in `src/lib/derive.ts`
(`gradePct(samples)`, with a unit check in `scripts/verify.ts`). Sim: synthesize rolling
terrain from the seeded RNG.
**UI.** `src/components/AltitudeRibbon.tsx`: 720×140 filled area (reuse `buildWaveform`
geometry from `src/lib/pulse.ts` with `range` = rolling max), live grade numeral right-aligned
(`+6.2 %`, warn color > 10 %). Home: replace the LONG G / LAT G telemetry cells (the
traction circle now owns g) — keep PITCH/ROLL. Trail face: full width under the hero.
**Verify.** `npm run verify` for `gradePct`; sim shows rolling profile.

## 6. Day/night crossfade  (S)
**Goal.** 30 s token lerp between `amberNight` and `amberDay` instead of a snap.
**Build.** In `ThemeProvider.tsx`, keep `targetTheme`; drive a `t: 0..1` with a 30 s
`Animated.timing` (JS driver is fine: it ticks the provider ~30×/s **only during the fade**),
and publish an interpolated theme object (`lerpTheme(a,b,t)` pure in `src/theme/themes.ts`,
lerping every color token in RGB; strings copied). Memoize the published object by
quantized `t` (1/60 steps) so consumers re-render ≤ 60 times per fade, never after.
**Verify.** Web: toggle AUTO with a mocked `isDaylight` flip; no re-renders after 30 s.

## 7. Press feedback  (S)
**Goal.** Every Pressable gets a soft amber under-glow + 1–2 px depress.
**Build.** `src/components/ui/Press.tsx` wrapping `Pressable` with
`Animated` scale 1→0.985 and a `shadowColor`/glow `opacity` 0→0.35 on press-in, 120 ms,
native driver (transform + opacity only). Replace `Pressable` in Dock, SET buttons,
MediaWidget tabs/transport, drawer tiles. No layout animation.
**Verify.** Web/device: no dropped frames when mashing the dock.

## 8. "OBD connected" moment  (S)
**Goal.** When `obd.connected` flips false→true: ring sweeps once, re-labels RING·SPEED →
RPM with redline igniting, vehicle panel values stagger in, a fading mono ticker
`OBD LINK · ELM327 · <adapter name>`.
**Build.** `useTelemetry(d => d.obd.connected)` edge detection in a small
`src/components/signature/ConnectMoment.tsx` mounted beside PulseTach; reuse the item-4
`overrideFrac` prop for the sweep (1.0 s), `Animated` opacity for the ticker (native driver).
Vehicle panel stagger: per-cell `Animated` opacity keyed on `connected`. Sim: trigger by
`setObdConnected(true)` from SET (add a "SIM: OBD ON/OFF" button, sim-only).
**Verify.** Web via the sim toggle.

## 9. Daylight readability  (S, then truck)
**Goal.** `amberDay` must survive direct sun. Today it's untested.
**Build.** In `themes.ts`: raise `amberDay` text/accent to ≥ 7:1 contrast on the bg (bg to
near-black or near-white — decide one; recommend **light background with dark amber text**
for sun, since the night face already owns black), thicken ring strokes +20 %, drop the
reactive-background opacity cap to 0.06 in day. Add a SET preview: a split screen showing
both themes side by side. Pure token work; the owner judges outside.
**Verify.** Contrast numbers printed by a tiny script in `scripts/` (add to `verify`).

## 10. Skia port of PulseTach  (L, native rebuild)
**Goal.** Move the signature's hot path off `react-native-svg` so motion is free on the 665.
**Build.** `npx expo install @shopify/react-native-skia` (prebuild + rebuild).
`src/components/signature/PulseTachSkia.tsx`: `<Canvas>` with `Path` objects built from the
SAME geometry in `src/lib/pulse.ts` (it's renderer-agnostic by design — do not fork it).
Drive animation with Skia/Reanimated shared values updated from PulseTach's existing loop
(or a `useClock`), so the waveform/ring update on the UI thread with **zero React
re-renders per frame**: the loop writes `speed/rpm/frac/longG` + the decimated samples into
shared values; `Path` is rebuilt via `useDerivedValue`. Keep the SVG component as the
**web** fallback (`PulseTach.web.tsx`). Then re-enable continuous motion for the reactive
background (full-bleed Skia gradient, same selectors).
**Verify.** Device `dumpsys gfxinfo` while driving in sim: ≥ 90 % non-janky frames; CPU
under 60 % with sim at speed (was ~150 %).

---

## Suggested order & why
1 → 2 → 3 make it *the operating system* (apps, faces, controls). 4, 7, 8 are cheap polish
that reuses item-4's override hook. 5 and 6 are self-contained. 9 is tokens only but needs
the owner outdoors. 10 last: it's the only one that needs a native rebuild for a non-native
reason, and everything else is written to not depend on it.
