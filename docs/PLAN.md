# Tally — Tacoma head-unit launcher: build plan

Status: DRAFT for review. Written 2026-10-20 from the earlier design conversation
and the file listing of the previous attempt (`2TR-FE` / `tacomadash`). The old
code itself has not been read yet; see M0.

How this document is used:
- **Reviewer (Fable):** challenge the decisions in §2, the milestone order in §4,
  and the risk calls in §6. Anything marked `DECISION` is up for debate; anything
  marked `FACT` came from the device or from Ben and should not be re-litigated.
- **Builder (Opus):** work the milestones in order. Each has an acceptance check.
  Do not start a milestone whose prerequisites in M0 are unmet; say so instead.
  Keep vendor code and secrets out of the repo (§7).

---

## 1. What we are building

A replacement HOME app for Ben's Dasaita head unit in his Toyota Tacoma. It must:

1. Come up on boot as the home screen (big, glanceable, dark, landscape).
2. Show live vehicle data from an OBD-II dongle (RPM, speed, coolant, boost/load,
   voltage, etc.) plus phone-free sensors (GPS speed, compass, IMU/traction).
3. Have FM/AM radio built in, with the "rich" text the station sends (RBDS:
   station name, song/artist).
4. Jump to Zlink (CarPlay/Android Auto projection) in one tap, and come back.
5. Be a real launcher: app drawer, dock, and a place to add Android widgets and
   our own cards later.

### Target hardware (FACT, from the About screen)

| Item | Value |
|---|---|
| SoC / model | QCM6125 (Snapdragon 662) |
| Android | 13 |
| Build | `QCM6125 13 S10A_123 eng.hct.20251111.140008 NA-V2.1` |
| MCU | `MTCHS_HA4Z_V4.16f_1 Jul 30 2025` |
| Vendor | HCT, MTC platform ("MTCHS"), North America radio band |

This is a single-device project. `minSdk = targetSdk = 33`, landscape only, no
tablet/phone layouts, no Play Store.

### What the previous attempt already proved (FACT, from its file list)

The old project is an **Expo / React Native** app, package `com.benji.tacomadash`,
last touched 2026-09-09. Relevant pieces:

| Old path | What it is | Reuse |
|---|---|---|
| `src/lib/elm327.ts`, `src/data/live/obd/*` | ELM327 init + PID parsing over Bluetooth Classic SPP | Port logic 1:1 to Kotlin |
| `src/lib/derive.ts`, `units.ts`, `format.ts` | Derived values (boost, fuel econ, etc.), unit conversion, formatting | Port |
| `src/lib/imu.ts`, `pulse.ts`, `src/data/live/sensorProvider.ts`, `locationProvider.ts` | IMU filtering, pulse animation, sensor + GPS sources | Port |
| `src/data/SimulatedDataSource.ts`, `types.ts`, `DataSourceProvider.tsx` | Simulated feed + the data model | Port; this is the dev loop |
| `modules/media-bridge/**/*.kt` | NotificationListenerService + MediaSession reader, **already Kotlin** | Lift directly |
| `plugins/withHomeLauncher.js` | Manifest bits that made it a HOME app | Read, replicate in manifest |
| `plugins/withRadioQueries.js`, `src/radio/*` | Launched the **stock radio app** by intent; `RadioProvider` | Read: gives stock radio package name. Phase A of M4 |
| `plugins/withCarPlayQueries.js`, `src/carplay/launchCarPlay.ts` | Launched **Zlink** by intent | Read: gives Zlink package/activity. M5 |
| `src/components/*`, `src/theme/*`, `src/dock/*`, `src/settings/*` | UI: PulseTach, MediaWidget, GyroCard, Compass, TractionCircle, Dock, Settings | Design reference only; rewrite in Compose |
| `docs/design-brief.md`, `DECISIONS.md`, `ARCHITECTURE.md`, `M2-LIVE-BUILD.md`, `Design Directions/*.html` | Design + decisions from June | Read first. Carry forward what still holds |
| `push-to-truck.command` | His install script (wireless adb) | Replace with `scripts/push-to-truck.sh` |
| `scripts/verify.ts` | Some verification harness | Read; may become unit tests |

Note the old project **did not have a native radio**. It launched the stock radio
app and (probably) read its MediaSession for now-playing text. That is the
honest baseline for M4 Phase A.

---

## 2. Decisions

### DECISION 2.1 — Native Kotlin + Jetpack Compose, not Expo/React Native

Recommendation: rewrite native. Reasons:

- Every hard part of the old app was *already* native Kotlin wrapped for Expo
  (media bridge, Bluetooth SPP, HOME manifest plugin). The JS layer bought UI
  convenience and cost cold-start time, APK size, and a config-plugin layer that
  broke on upgrades (the duplicated `gradlew 2`, `build 2.gradle`, `local 2.properties`
  files in the listing are scars from exactly that).
- A launcher's cold start is the boot experience of the truck. RN cold start on a
  Snapdragon 662 is several seconds; Compose is well under one.
- `AppWidgetHost` (item 5) and binding to a vendor MCU service (item 3, Phase B)
  have no sane RN path.
- The TS logic that matters (ELM327 parsing, derive, IMU) is small and ports
  mechanically. The UI gets rewritten either way because the design "wasn't perfect".

If the reviewer or Ben wants to stay on Expo anyway, the milestones below still
hold; only the module layout and the build/push scripts change.

### DECISION 2.2 — New application id `com.benji.tally`

Lets the old `com.benji.tacomadash` stay installed next to the new one during
development and avoids the signing-key clash (old debug keystore vs. new key).

### DECISION 2.3 — Simulated data source is a first-class citizen

Everything renders from a `VehicleState` flow. `SimulatedDataSource` drives the
UI in the cloud and in previews; `LiveDataSource` composes OBD + sensors + GPS +
media on the device. This is how the old project worked and it is the only way
to iterate without the truck.

### DECISION 2.4 — Radio in two phases, gated on findings

Phase A (guaranteed): launch stock radio by intent, mirror its now-playing text
via the media bridge, give it a dock tile. Phase B (stretch): native tuner UI
bound to the vendor MCU service, found by read-only decompile of the stock radio
APK. Phase B only starts once M0.4 has produced the APK and a feasibility note.

### DECISION 2.5 — Single Gradle module, no DI framework, no architecture ceremony

One `app` module, packages by feature (`home`, `vehicle`, `obd`, `sensors`,
`media`, `radio`, `apps`, `settings`, `theme`). Plain Kotlin `Flow`s and a couple
of `object`-scoped services. Hilt/Koin add nothing for one device and one developer.

---

## 3. Architecture (target)

```
app/
  src/main/
    AndroidManifest.xml           HOME + DEFAULT, landscape, singleTask, notification listener svc
    java/com/benji/tally/
      TallyApp.kt                 Application: starts DataHub
      MainActivity.kt             Compose host, immersive, keep-screen-on
      data/
        VehicleState.kt           immutable snapshot (rpm, speedKph, coolantC, volts, ...)
        DataSource.kt             interface { val state: StateFlow<VehicleState> }
        SimulatedDataSource.kt    port of old simulator
        LiveDataSource.kt         merges obd + sensors + location
        Derive.kt / Units.kt      port of derive.ts, units.ts
      obd/
        Elm327.kt                 AT init sequence, PID request/parse (port of elm327.ts)
        SppTransport.kt           BluetoothSocket RFCOMM; reconnect with backoff
        ObdManager.kt             poll loop, PID schedule, health state
      sensors/
        SensorProvider.kt         rotation vector / accel / gyro → IMU model (port of imu.ts)
        LocationProvider.kt       fused/GPS speed + heading
      media/
        MediaBridge.kt            MediaSessionManager wrapper (from modules/media-bridge)
        MediaListenerService.kt   NotificationListenerService (from modules/media-bridge)
      radio/
        RadioLauncher.kt          Phase A: intent to stock radio
        (RadioMcu.kt)             Phase B: vendor binder, reflection-only, no vendor source
      apps/
        AppRepository.kt          PackageManager LAUNCHER query, icons, labels
        Zlink.kt                  launch + return handling
        WidgetHost.kt             AppWidgetHost/AppWidgetHostView wrapper
      ui/
        theme/                    port of themes.ts, Amber direction from Design Directions
        home/HomeScreen.kt        Stage + cards + Dock
        cards/                    PulseTach, VehiclePanel, GyroCard, Compass, Traction, MediaCard, RadioCard
        drawer/AppDrawer.kt
        settings/SettingsScreen.kt + Settings.kt (DataStore)
  src/test/                       Elm327, Derive, Units, Simulated source
scripts/
  build-debug.sh                  ./gradlew :app:assembleDebug, prints APK path
  push-to-truck.sh                adb connect <ip>:5555 && adb install -r
docs/
  PLAN.md (this)  DECISIONS.md  HARDWARE.md  RADIO-NOTES.md (findings only, no vendor code)
```

Threading: one coroutine scope in `TallyApp`; OBD polling on `Dispatchers.IO`;
UI collects `StateFlow`s. No background Service needed while we are HOME; if
ACC-off/on turns out to kill the process, M7 adds a foreground service.

---

## 4. Milestones

### M0 — Handoff and recon (Ben, with the agent's help). Blocks everything.

0.1 **Push the old project** to this repo as branch `old-launcher`. Answering
    "it's huge, need all?": no. Push with git; the Expo `.gitignore` already
    excludes `node_modules/`, `ios/Pods/`, `android/build/`, `.expo/`. Before
    pushing, also add to `.gitignore`:
    `android/app/debug.keystore`, `android/local.properties`, `android/*2*`
    (the duplicated `gradlew 2` etc.), `ios/`, `.DS_Store`, `REFERENCES/*.gif`.
    `ios/` is irrelevant to this project and `REFERENCES/` holds a 10 MB gif.
    ```bash
    cd ~/Desktop/2TR-FE/2TR-FE
    git init 2>/dev/null; git add -A && git commit -m "Old launcher, as it was"
    git remote add tally https://github.com/benweininger-spec/Tally.git
    git push tally HEAD:old-launcher
    ```
    Then the agent reads the files in §1's table and writes `docs/DECISIONS.md`
    (what carries forward) and fills in the package names in M4/M5.

0.2 **Network allowlist** for the cloud environment: add `dl.google.com` and
    `maven.google.com` (environment menu → Edit → Network access). Without this
    nothing compiles in the cloud. (`repo1.maven.org` rate-limited once; keep an
    eye on it.)

0.3 **Default-launcher test** on the unit: install any Play Store launcher, set
    it as default, cycle the truck fully (ACC off, wait, on). If the stock
    launcher comes back, HCT firmware pins HOME and the whole project changes
    shape (becomes an app with a boot auto-start, not a HOME replacement). Report
    the result before M1 ends.

0.4 **Pull stock APKs** for read-only study, via wireless adb:
    ```bash
    adb connect <headunit-ip>:5555
    adb shell pm list packages | grep -iE 'hct|mtc|radio|launcher|zlink|carplay|canbus|car'
    adb shell pm path <pkg>; adb pull <path> ./stock-apks/
    ls /system/framework | grep -iE 'hct|mtc'     # vendor SDK jars live here on MTC units
    adb shell dumpsys media_session               # does stock radio publish a MediaSession?
    ```
    Upload the APKs/jars to the chat, not to git. The `dumpsys media_session`
    output while the radio plays decides whether M4 Phase A gets RBDS text for free.

0.5 **OBD dongle**: model and transport (Bluetooth Classic vs BLE vs Wi-Fi). The
    old code was Classic SPP; if the dongle is BLE the transport is a rewrite.

0.6 **Wireless adb set up once properly**: reserve the unit's IP in the router,
    pair in Developer options → Wireless debugging, verify `adb connect` works
    from the Mac cold. Document in `docs/HARDWARE.md`. USB adb is not an option
    on this unit (host-mode ports), so stop chasing the pigtail.

### M1 — Scaffold + simulated home screen

- Gradle project, Kotlin, Compose, `minSdk 33`, `applicationId com.benji.tally`.
- Manifest: `MAIN` + `HOME` + `DEFAULT`, `launchMode="singleTask"`,
  `screenOrientation="landscape"`, `excludeFromRecents`, `stateNotNeeded`.
- `MainActivity`: immersive sticky, keep screen on, no system bar insets.
- `VehicleState`, `DataSource`, `SimulatedDataSource` ported.
- Home screen: Stage layout, PulseTach, VehiclePanel, Dock with placeholder tiles,
  Amber theme. Compose previews for every card.
- `scripts/build-debug.sh` works in the cloud; `scripts/push-to-truck.sh` installs.
- Unit tests: Derive, Units.

**Accept:** debug APK installs on the unit, is offered as HOME, shows simulated
data at 60 fps, survives rotation lock and a reboot (given 0.3 passed).

### M2 — Live data: OBD, sensors, GPS

- `SppTransport` + `Elm327` + `ObdManager` ported, with reconnect/backoff and a
  visible connection state on the home screen.
- Sensor + location providers; IMU model; derived values.
- Settings: dongle MAC, units (mph/°F), PID set, poll rate; stored in DataStore.
- `LiveDataSource` selected by a settings toggle; Simulated remains for dev.
- Unit tests: Elm327 parsing against captured dongle responses (ask Ben to run
  the old app's log or `scripts/verify.ts` once to capture real frames).

**Accept:** in the truck, RPM/speed/coolant/voltage track reality; dongle unplug
→ reconnect without restart; no ANR over a 30-minute drive.

### M3 — Media bridge

- Lift `MediaBridgeModule.kt` + `MediaBridgeNotificationListenerService.kt`.
- `MediaCard` on home: title/artist/app, play/pause/next via `MediaController`.
- Settings deep-link to grant notification access.

**Accept:** Spotify/Bluetooth phone audio shows and controls from the home screen.

### M4 — Radio

Phase A (do first, always):
- `RadioLauncher` using the package found in the old `withRadioQueries.js`.
- Dock tile; `RadioCard` shows whatever the media bridge sees from the stock app
  (per 0.4's `dumpsys media_session`). If the stock app publishes nothing, the
  card is just a launcher tile and we say so.

Phase B (only after a feasibility note in `docs/RADIO-NOTES.md`):
- Decompile stock radio APK + `/system/framework` vendor jar **outside the repo**
  (jadx). Identify the MCU service interface (typically an AIDL under
  `com.hct.*`/`android.mtc*` or a `SystemProperties`/socket protocol).
- `RadioMcu.kt` binds by reflection to the vendor service; no vendor classes or
  source committed. Freq, seek, presets, band, RBDS PS/RT.
- `RadioCard` becomes a tuner. Stock radio app stays installed as fallback.

**Accept A:** one tap opens stock radio, HOME returns to Tally.
**Accept B:** tune/seek/preset from Tally with RBDS text, audio routed correctly,
stock radio app untouched.

### M5 — Zlink

- `Zlink.kt`: launch intent from old `withCarPlayQueries.js`; dock tile.
- Verify HOME key (MCU-mapped on MTC units) returns to Tally, not stock launcher.
- Media bridge should pick up Zlink's projected now-playing if it posts one.

**Accept:** phone connected → one tap into CarPlay/AA → HOME back to Tally
without the stock launcher appearing.

### M6 — Apps and widgets

- App drawer (grid, big targets, search unnecessary).
- Dock configurable from Settings (port `dock/defaults.ts`).
- `WidgetHost`: `AppWidgetHost` with a pick-and-place strip; persisted layout.
- Our own cards registered in the same strip so "widgets" means both.

**Accept:** add a weather widget and remove it; layout survives reboot.

### M7 — Boot, sleep/wake, release

- Test ACC off/on: does HCT suspend-to-RAM or kill us? If killed, add a sticky
  foreground service + `BOOT_COMPLETED`/`QUICKBOOT_POWERON` receiver.
- Memory watch (`adb shell dumpsys meminfo com.benji.tally`) over a long drive.
- Release signing: Ben generates a keystore, keeps it out of git (store the
  passwords in a password manager). `signingConfigs.release` reads from
  `~/.gradle/gradle.properties`. Then uninstall the old `tacomadash`.
- CLAUDE.md updated with build/install/debug commands and the "no vendor code"
  rule.

**Accept:** truck off overnight → on → Tally is up with live data before the
backup camera has gone away.

---

## 5. How the agent builds and Ben installs

- Cloud: `./gradlew :app:assembleDebug` (needs 0.2). The agent attaches the APK
  to the chat or commits a release tag; no emulator in the cloud, so on-device
  checks are Ben's.
- Mac: `scripts/push-to-truck.sh <ip>` → `adb connect`, `adb install -r`,
  `adb shell am start` with the HOME intent.
- Logs: `adb logcat -s Tally:* Elm327:* MediaBridge:*`.

---

## 6. Risks, ranked

1. **HOME is pinned by firmware** (0.3). Kills the launcher premise. Fallback:
   auto-start app + "Tally" tile in the stock launcher. Find out in week one.
2. **MCU radio API is opaque or signature-protected.** Phase B may be
   impossible without a platform-signed app. Phase A ships regardless.
3. **Stock radio publishes no MediaSession** → no RBDS text in Phase A. Only
   Phase B fixes it.
4. **Dongle is BLE, not SPP** (0.5). Transport rewrite, parsing unchanged.
5. **ACC-off kills the process** → M7 foreground service; acceptable.
6. **HOME key handled by MCU → stock launcher regardless.** Known on some MTC
   builds; workaround is a `KeyEvent` interception or the vendor "default
   launcher" setting in the HCT factory menu.
7. **Network allowlist** not granted → nothing compiles in the cloud; the
   builder can still write code and Ben builds locally in Android Studio.

---

## 7. Rules for the builder

- Never commit: keystores, `local.properties`, vendor APKs, decompiled vendor
  code, `/system/framework` jars, API keys. `docs/RADIO-NOTES.md` holds
  findings (class names, method signatures, protocol notes) only.
- Do not touch the `qamar` branch.
- Work on `main` (repo is single-developer); tag milestones `m1`, `m2`, ...
- Every milestone ends with a short note in `docs/DECISIONS.md` and the
  acceptance check either done by Ben or explicitly listed as pending.
- Prefer boring Android APIs over libraries. Allowed deps: Compose BOM,
  `androidx.datastore`, `kotlinx.coroutines`. Add others only with a line in
  DECISIONS.md saying why.

---

## 8. Open questions for Ben

1. Result of the default-launcher test (0.3).
2. OBD dongle model (0.5).
3. Is the Tally repo private? (Decides whether stock APKs may go on a branch at
   all; the plan assumes **upload to chat, never git**.)
4. Amber direction from `Design Directions/Launcher Amber.dc.html`, or the other
   one? Pick one; the Compose theme ports from it.
5. Does the stock radio show RBDS text today? (If it doesn't, Phase B can't
   either; the tuner hardware may not decode it.)
