# HANDOFF — old launcher ("Tacoma Dash", `com.benji.tacomadash`)

Branch `old-launcher`. Expo SDK 56 / RN 0.85 (New Arch, Hermes), amber-VFD dashboard
meant to become the HOME launcher on a Dasaita Vivid13 in a 2016 Tacoma (2TR-FE).
`android/` and `ios/` are NOT committed — they are generated: `npx expo prebuild -p android`
(then write `android/local.properties` with `sdk.dir=~/Library/Android/sdk`). JDK 17.
Start with `CLAUDE.md` (project brain), `docs/M2-LIVE-BUILD.md` (device bring-up),
`docs/DECISIONS.md`, `docs/ARCHITECTURE.md`.

Tags: **FACT** = seen on the head unit. **BELIEF** = from code or memory, never verified on device.

## Stock radio
- **BELIEF** — packages tried, in order: `com.syu.radio`, `com.syu.carradio`, `com.fyt.radio`
  (`src/radio/launchRadio.ts`, `plugins/withRadioQueries.js`). Launched via
  `expo-intent-launcher` `IntentLauncher.openApplication(pkg)` (= `PackageManager.getLaunchIntentForPackage`).
  No activity name known.
- **FACT** — never launched on the unit; never confirmed any of those packages exist
  (`pm list packages | grep -iE 'radio|syu|fyt'` was never run — do it first).
- **FACT** — no RBDS/song/artist text ever seen. media-bridge never read a radio MediaSession
  (media-bridge never ran on the unit at all — see below). The radio tuner UI is sim-only
  (`RadioProvider.controllable=false` in live); the real tuner is MCU-driven with no public API.

## Zlink (CarPlay)
- **FACT** — package `com.zjinnova.zlink`. It declares THREE launcher activities:
  `com.zjinnova.android.zlink.features.launcher.CarPlayActivity`, `...HiCarActivity`,
  `...HiCarUnavailableActivity`. A plain package launch (`getLaunchIntentForPackage`) therefore
  resolves to the system chooser (`ResolverActivity`).
- **FACT** — intent that works (`src/carplay/launchCarPlay.ts`):
  `IntentLauncher.startActivityAsync('android.intent.action.MAIN', { packageName:'com.zjinnova.zlink',
  className:'...CarPlayActivity', flags: FLAG_ACTIVITY_NEW_TASK })` → opened the Zlink "CarPlay —
  please connect your phone" screen (BT name "Scout-644", PIN shown). Fallbacks in code:
  `openApplication('com.zjinnova.zlink')`, then `net.easyconn` (FACT: `net.easyconn` is installed
  but has NO launcher activity, so that fallback can't work as written).
- **FACT** — requires `<queries><package android:name="com.zjinnova.zlink"/>` (Android 13 package
  visibility) — `plugins/withCarPlayQueries.js`. Without it the launch throws.
- **FACT** — launch worked. Return was only tested by relaunching our app via adb (`monkey`);
  pressing the unit's HOME button to return was NOT tested (we were never the default home).
- **FACT** — no phone was ever paired to Zlink; CarPlay projection itself never seen.

## HOME launcher
- **BELIEF** — `plugins/withHomeLauncher.js` adds to `.MainActivity` a second intent-filter
  `MAIN + android.intent.category.HOME + DEFAULT`, and sets `android:excludeFromRecents="true"`,
  `android:stateNotNeeded="true"`. `launchMode` is already `singleTask`. Set default with
  `adb shell cmd package set-home-activity com.benji.tacomadash/.MainActivity`
  (`push-to-truck.command` does this after install).
- **FACT** — the APK carrying this was BUILT (`app-release.apk`, HOME category confirmed in the
  APK manifest with aapt2) but was **never installed**: the unit went offline before install.
  So: whether it survives a power cycle, and whether the stock launcher returns, is **UNKNOWN**.
- **FACT** — the stock launcher is `com.telenav.scout.launcher` (seen owning MediaSessions and
  NavigationService logs). Keep it installed as the fallback.
- **BELIEF** — Dasaita/FYT units have a vendor autostart/"security" manager that must whitelist
  the app; never located on this unit.

## OBD
- **FACT** — dongle purchased: **Vgate vLinker MC+**. It was **never paired or connected** in any
  session; no MAC/name recorded. All OBD code is therefore BELIEF, exercised only by unit tests
  (`npm run verify` covers `src/lib/elm327.ts` parsing).
- **BELIEF** — transport: Bluetooth **Classic SPP/RFCOMM** via `react-native-bluetooth-classic`
  (`src/data/live/obd/ClassicSppTransport.ts`): connects to a *bonded* MAC with
  `{ delimiter:'>', charset:'ascii', CONNECTOR_TYPE:'rfcomm' }`; picks the first bonded device whose
  name matches `/OBD|ELM|VLINK|VIECAR|VEEPEAK|OBDII|SCAN|VGATE/i` if no MAC given. No BLE transport
  exists (the `ObdTransport` interface is meant to allow one). The vLinker MC+ is dual-mode; whether
  it pairs as Classic on this Android 13 unit is unverified.
- **BELIEF** — init (`AT_INIT` in `src/lib/elm327.ts`): `ATZ, ATE0, ATL0, ATS0, ATH0, ATAT1, ATSP0`,
  60 ms between, 4 s timeout each; then support-mask discovery `0100 / 0120 / 0140`.
  Scheduler (`ObdManager.ts`): FAST round-robin `0C RPM, 0D SPEED, 11 THROTTLE, 10 MAF, 04 LOAD`;
  every 5th tick one SLOW pid `05 COOLANT, 0F INTAKE, 0B MAP, 2F FUEL, 42 CTRL_VOLTAGE, 33 BARO,
  46 AMBIENT, 5C OIL, 1F RUNTIME`; every 200th tick `0101` monitor status (DTC count / MIL).
  1 s command timeout, one command in flight. Troubleshooting note in docs suggests pinning `ATSP6`
  (ISO 15765 11-bit/500k) for the 2TR-FE if `ATSP0` auto fails — untested.
- **BELIEF** — derived HP/torque/MPG/0-60 in `src/lib/derive.ts`; voltage in live mode is
  deliberately absent until PID 42 (see below — probably wrong).

## media-bridge (Tier B)
- **BELIEF** — Kotlin Expo module (`native/media-bridge`, copied to `modules/` by `npm run
  media:enable`). Reads `MediaSessionManager.getActiveSessions()` behind a
  `NotificationListenerService`; takes the FIRST active controller; emits `onTrackChanged` /
  `onPlaybackChanged` with `title/artist/album/durationMs/positionMs/playing/package` +
  album art as a data-URI; transport `play/pause/next/previous`. JS side `src/data/live/mediaBridge.ts`
  degrades to `absent` if the module is missing or access not granted.
- **FACT** — it compiled into the last release APK (listener service present in the merged manifest)
  but that APK was never installed. On the unit, `settings get secure enabled_notification_listeners`
  returned `null` (no access ever granted). **Tested against: nothing.**
- **FACT** — `dumpsys media_session` on the unit showed active sessions from
  `com.telenav.scout.launcher` (3) and `com.android.bluetooth` ("Bluetooth audio disconnected");
  A2DP state was `STATE_DISCONNECTED` — no phone was ever paired for audio.
- **BELIEF** — `LiveDataSource.tick()` polls `media.refresh()` every ~1.5 s when access is granted
  and nothing is playing (added, never run).

## Design
- Chosen: **"clean hybrid" home face, amber theme** (`Design Directions/Launcher Amber.dc.html`;
  the other file `Launcher Directions.dc.html` holds the rejected mono/teal/red directions and the
  Grip/Trail/Scope/Cluster/Ridgeline faces). Rationale in `docs/DECISIONS.md`: the references vote
  for amber VFD; Grip/Trail/Scope read as *modes* not a home; Cluster/Ridgeline read as home; the
  hero became **PulseTach** (Tesla-energy-graph: longitudinal-g waveform + ring that reads speed
  pre-OBD, RPM post-OBD; center number always ground speed). Known contradiction with the brief:
  amber-on-black is the worst case for direct-sun legibility; `amberDay` exists but is untuned.

## Broken / unfinished / abandoned
- **FACT** — the whole-tree re-render storm (every widget re-rendered 30×/s via context) was the
  cause of 100%-janky frames and ~203% CPU idle on the Snapdragon 665. Fixed by a selector store
  (`useTelemetry`) + `React.memo` + PulseTach's own 25 fps loop with idle-skip; idle fell to
  ~1.5 fps / ~55% CPU. Still SVG — the planned Skia port never happened. Driving CPU still ~150%.
- **FACT** — SET-sheet scroll "high input latency" counter never improved under scripted swipes;
  jank did (28→19%). Real-finger feel never evaluated.
- **FACT** — the release build signs with the **debug keystore** (`signingConfig signingConfigs.debug`
  in the generated build.gradle). Fine for sideload; not shippable.
- **BELIEF** — never built: app drawer (dock uses hand-typed URLs: `geo:0,0`, `waze://`,
  `spotify://`, camera empty), Skia port, altitude/grade ribbon, mode faces, boot sweep,
  day/night crossfade, BLE OBD, Wi-Fi/LTE indicators (hard-coded `false` in LiveDataSource),
  `satellites` (expo-location can't expose it).
- **FACT** — `waze://` launches Waze (installed). `geo:`/`spotify://` untested.
- **FACT** — heading: expo-location returns `-1` when stopped → compass used to snap to 0°/N; now
  holds last heading dimmed. OBD-derived fields (`estHp`, `estTorque`, `dtcCount`, `0-60`,
  intake/oil/ambient temps, `baro`, `runTime`, `throttle`, `load`, `avgMpg`) are computed but
  rendered by nothing.
- **FACT** — voltage: the Android status bar on this unit shows a live battery voltage (12.3–14.0 V)
  so the MCU does publish it; the code's assumption "no clean API" is probably wrong. Never traced
  (`dumpsys battery`, `/sys/class/power_supply/*/voltage_now`, or a vendor broadcast are the leads).
- **FACT** — user drove with the perf build; no feedback on gauge feel was ever reported.

## Device facts (all FACT)
- Head unit: Dasaita Vivid13, `ro.product.model=QCM6125` (Snapdragon 665), `product:S10A`,
  `ro.serialno=D281FF552A7CA033`, Android 13, screen `wm size` = **1200×2000 physical**, rotated
  to 2000×1200 landscape (uiautomator/screencap/input coordinates are in 2000×1200).
- Wi-Fi: on the home-ish network the unit was `192.168.4.69` (Mac `192.168.4.23`, /22);
  randomized MAC per SSID. Wireless-debug port **rotates on every sleep/reboot** (seen 39327,
  37221, 42407). `adb mdns services` returned nothing on that network. Pairing record on the unit
  was `benjaminweininger@Benjamins-MacBook-Air-3.local`. Last seen: offline (truck off).
- ADB quirks: (1) developer mode is behind Factory Settings password **`adbon`** (not the usual
  `126`); resets on power cycle. (2) The unit shows up TWICE in `adb devices` (plain TCP +
  `_adb-tls-connect` mDNS) → "more than one device"; use `-s <ip:port>`; both share the serial
  above. (3) A long-lived adb server on the Mac (7 `utun` VPN interfaces) returned "No route to
  host" while `nc` could reach the port — `adb kill-server && adb start-server` fixed it.
  (4) Client-isolated guest Wi-Fi (gym) and a T-Mobile-style 464XLAT hotspot (clients get
  `192.0.0.x/32`) both block adb-over-Wi-Fi; a real LAN or USB works. (5) Expo dev-client deep link:
  `exp+tacoma-dash://expo-development-client/?url=http%3A%2F%2F<mac-ip>%3A8081`.
- Other codes: factory settings `126` (front-camera app etc., BELIEF from docs).
- Packages seen (`pm list packages`, filtered — a full dump was never saved):
  `com.zjinnova.zlink`, `net.easyconn`, `com.autolauncher.motorcar.free`, `com.microntek.autotest`,
  plus `com.telenav.scout.launcher` (stock launcher/nav, Telenav SDK logs: `NavigationService`,
  `AccidentDetectProcess`) and Waze.
- System status bar shows an "OBD" glyph and a live battery-voltage readout — origin unknown.
- Sensors: accelerometer sampled at 20 ms (~50 Hz) via expo-sensors; GPS `BestForNavigation`,
  500 ms; SELinux logs `avc: denied` for `in_accel_x_raw` sysfs reads (permissive, harmless).

## Things the next builder should know
- Nothing here touches ROM/bootloader/root; `adb uninstall com.benji.tacomadash` returns the unit
  to stock. Keep `com.telenav.scout.launcher` installed.
- The data layer is the keeper: `DataSource` contract, `Signal<T>` live/stale/absent, sim↔live
  swap with zero component changes, pure tested math in `src/lib`. The render model (selector
  store) is the second keeper — don't put per-frame data in React context.
- Fonts: native loads `Oxanium_700Bold` and `JetBrainsMono_500Medium` under the family names
  `'Oxanium'` / `'JetBrains Mono'` (one weight each; RN fakes the rest) — in the unverified build.
- `push-to-truck.command` = build release → find unit (dedupes the double listing) → install →
  set default home → launch. `TRUCK_ADDR` env for auto-connect.
- Hermes: `index.android.bundle` is bytecode; you can't grep source strings in the APK.
