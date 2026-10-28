# M2 — Live data: build, sideload, and bring-up

How to take the dashboard from the web sim to **live data on the Dasaita Vivid13**.
The architecture is unchanged — a `LiveDataSource` implements the same `DataSource`
contract behind a runtime sim↔live switch, so no component changed
(`docs/ARCHITECTURE.md`). Verified against **Expo SDK 56 / React Native 0.85**
(New Architecture is mandatory; Expo Go can't host the native modules, so a **dev
client** is required).

> TL;DR for the first drive: install deps → build a dev client → `adb install` →
> open **SET → DATA SOURCE → LIVE** → grant Location → calibrate the g-sensor.
> That's Tier A (speed/heading/altitude/g), no extra hardware. OBD and media come after.

---

## 0. What lights up when

| Tier | Source | Needs | Status in this build |
|------|--------|-------|----------------------|
| A | GPS + accelerometer | nothing extra | **ready now** |
| C | OBD2 ELM327 over Bluetooth | the dongle (paired) | **ready, lights up on connect** |
| B | now-playing over Bluetooth | the staged Kotlin module + Notification access | **opt-in** (see §6) |
| D | head-unit CAN body signals | — | walled off (no API), `supported:false` |

Everything degrades to `absent` independently — no crashes, no empty gauges.

---

## 1. Install dependencies

Everything is pinned in `package.json` (SDK-56 versions), so one command installs it all:

```bash
npm install
```

To confirm the versions match Expo SDK 56, run `npx expo install --check` — it should
report **"Dependencies are up to date."** (Don't run `npm audit fix --force`; it bumps
majors and breaks the SDK pinning. The moderate audit warnings are transitive
build-tooling deps and are expected.)

`npm run verify` stays green (pure-logic tests, no native deps), and `npm run web`
still runs the **sim** unchanged — live mode is native-only and dynamic-imported,
so nothing native lands in the web bundle.

---

## 2. Build a dev client (local)

> Paste commands **one line at a time** — lines starting with text after a command
> are explanations, not part of the command. (`#` comments error in some shells.)

Config plugins (`app.json`) only take effect after a prebuild. `prebuild --clean`
generates `android/` with the permissions + plugins; `run:android` builds the dev
client and installs it to a connected device/emulator:

```bash
npx expo prebuild --clean
npx expo run:android
```

To build the **APK to sideload yourself** (no device needed) — it lands at
`android/app/build/outputs/apk/debug/app-debug.apk`:

```bash
npx expo prebuild --clean
cd android && ./gradlew assembleDebug
```

The debug dev client is self-signed and debuggable — fine for `adb install`.

**Prerequisite:** the Android toolchain must be installed — Android Studio (bundles
the SDK + `adb`) or the SDK command-line tools, plus **JDK 17**, with `ANDROID_HOME`
and `JAVA_HOME` set. On macOS with Homebrew:
`brew install --cask android-studio temurin@17`, open Studio once to install the SDK,
then export `ANDROID_HOME="$HOME/Library/Android/sdk"` and
`JAVA_HOME="$(/usr/libexec/java_home -v 17)"`.

---

## 3. Get it onto the Dasaita over ADB

**Enable ADB (Dasaita quirk):** developer mode is gated behind the factory-settings
password field. Open **Settings → (Car/Factory Settings)**, and in the password
prompt type **`adbon`** (not the usual factory `126`). This exposes **Developer
options** under Android Settings → System; enable **USB debugging**.

> ⚠️ ADB mode and `tcpip` can reset on reboot — re-enter `adbon` after a power cycle
> if `adb devices` shows nothing.

**Stable port (FACT, 2026-10-28).** Android 13's *Wireless debugging* toggle uses a TLS
port that rotates every session and drops when the unit sleeps — that was the
"new port every 10 minutes" pain. Classic TCP mode fixes it: with any adb link up, run
`adb -s <addr> tcpip 5555`, then `adb connect 192.168.4.45:5555` (the unit's LAN
address). `service.adb.tcp.port=5555` sticks until adbd restarts (full power-off / reboot;
ACC-off standby keeps it). `push-to-truck.command` now defaults `TRUCK_ADDR` to that
address. adbd runs as `shell` (no root), so `persist.adb.tcp.port` can't be set — after
a real reboot, re-enable Wireless debugging once, connect on its port, and re-run `tcpip`.

**USB** (authorize the RSA prompt on the head-unit screen when `adb devices` runs):
```bash
adb devices
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

**Over Wi-Fi** (handy once it's in the dash — bootstrap once over USB). After
`tcpip`, unplug USB and find the unit's IP in Settings → About / Wi-Fi:
```bash
adb tcpip 5555
adb connect 192.168.x.x:5555
adb install -r app-debug.apk
```
Android 13 also supports pairing: `adb pair <ip>:<pairPort>` (code on screen) then
`adb connect <ip>:<port>`.

**If install is blocked:** uninstall a conflicting signature first
(`adb uninstall com.benji.tacomadash`); for manual file-manager installs enable
**Install unknown apps** for that installer. Many of these ROMs ship a vendor
"security"/autostart manager — whitelist the app for **autostart** and disable
**battery/background restrictions** (matters more once it's the launcher in M4).

---

## 4. Tier A bring-up (GPS + g-sensor)

1. Launch the app → tap **SET** (dock) → **DATA SOURCE → LIVE**.
2. Grant **Location** when prompted (foreground is enough; we use
   `BestForNavigation`). Speed/heading/altitude + trip start filling within a few
   GPS fixes. `satellites` stays absent (expo-location doesn't expose it).
3. **Calibrate the g-sensor** (the head unit is mounted at an unknown angle):
   - **Parked & level → CALIBRATE LEVEL** (~1.5 s capture): learns gravity → correct
     pitch/roll and the up axis.
   - **On an open road → FORWARD**, then accelerate straight for ~2 s: resolves which
     way is "forward" so longitudinal vs lateral g aren't swapped/rotated.
   - The calibration persists; redo it only if the unit is remounted.

Voltage note: in **live** mode `system.voltage` stays **absent until OBD** provides
control-module voltage (PID 42) — there's no clean Android API for the unit's 12V
input and it isn't on CAN. (The sim still shows a Tier-A voltage; that's sim-only.)

---

## 5. Tier C — OBD2 (when the dongle arrives)

1. **Pair once** in Android **Settings → Bluetooth** (most ELM327 clones are
   Bluetooth **Classic**; PIN is usually `1234`/`0000`).
2. In-app **SET → OBD2 ADAPTER → FIND PAIRED**, tap your adapter (or **CONNECT** to
   use the first OBD-named one). Connecting by MAC means no scan and **no location
   prompt**. **Only needed once:** the adapter's MAC is remembered (`tacoma-dash:obdMac`)
   and the live source auto-connects on launch, then keeps retrying (2 → 4 → 8 s, then
   every 15 s; every 60 s after 10 min) until the dongle answers. Ignition-on (Microntek
   `com.microntek.acc`) and the launcher returning to the foreground retry immediately; a
   link where 8 commands in a row get no bytes back (stale socket after the unit slept) is dropped and
   redialed. SET shows the state on the AUTO-CONNECT line. **DISCONNECT OBD** pauses it
   until CONNECT or the next ignition-on. Policy + tests: `src/lib/obdLink.ts`.
3. On connect: the ring switches **speed → RPM (with redline)**, the vehicle panel
   fills with engine data, `system.voltage` lights up, and instant/avg MPG + a crude
   HP/torque estimate + DTC count appear. The center number stays **GPS ground
   speed** (the safety glance) by design.

Implementation: `ATZ ATE0 ATL0 ATS0 ATH0 ATAT1 ATSP0` init, support-mask discovery
(`0100/0120/0140`), then a fast group (RPM/speed/throttle/MAF/load) round-robin with
an interleaved slow group (temps/fuel/voltage/baro/runtime) and a rare DTC check.
All decode/﻿conversion/derivation is the pure, unit-tested `src/lib/elm327.ts` +
`src/lib/derive.ts` (see `npm run verify`). NA 2TR-FE → **no boost gauge**, by design.

A BLE adapter (OBDLink MX+) can be added later behind the same `ObdTransport`
interface (`src/data/live/obd/transport.ts`) without touching any PID logic.

---

## 6. Tier B — now-playing (Bluetooth audio, opt-in)

The JS side is fully wired and degrades to `absent` if the native module isn't built
in — so it's safe and **off the initial build by design**. The Kotlin module is
staged in `native/media-bridge/` (NOT autolinked) so an unverified native compile
can't block your first Tier-A sideload. **Recommended: activate it as a *second*
build, once Tier A is confirmed on the panel.**

Enable it with one command, then rebuild:

```bash
npm run media:enable          # copies native/media-bridge → modules/ (autolinks)
npx expo prebuild --clean
npx expo run:android
# to back out: npm run media:disable
```

⚠️ The only part I couldn't compile-verify here is the module's `build.gradle` (it's
toolchain-version-sensitive). If Gradle errors on it, scaffold a correct shell with
`npx create-expo-module@latest --local media-bridge` and drop in the three custom
files (Module.kt, the listener service, AndroidManifest.xml) — see
`native/media-bridge/README.md`.

Then grant **Notification access**: **SET → MEDIA ACCESS → GRANT ACCESS**. Sideloaded
apps on Android 13 may need **App info → ⋮ → Allow restricted settings** first.

---

## 6b. Radio (launch-only — confirm the package)

The media box has a **BLUETOOTH / RADIO** toggle. Radio tuning/source-switching has
no public API on this unit (MCU-driven, same wall as Tier D), so RADIO is **launch
the factory radio app** (which grabs audio). The tuner UI is interactive in **sim**
and shows **LAUNCH FACTORY RADIO** in **live**.

Confirm your unit's radio package once over ADB, then update both
`src/radio/launchRadio.ts` (`RADIO_PACKAGES`) and `plugins/withRadioQueries.js`:

```bash
adb shell pm list packages | grep -iE 'radio|fm|tuner|syu|fyt'
```
Then open the stock radio on the unit and read its component:
```bash
adb shell dumpsys activity activities | grep -i mResumedActivity
```

Defaults assume the FYT/SYU stack (`com.syu.radio`). The `<queries>` plugin makes
the package visible on Android 13; re-run `npx expo prebuild` + rebuild after editing.

## 7. Switching back to sim

**SET → DATA SOURCE → SIMULATOR** at any time (persisted). Useful for showing the
design without driving, and for isolating whether an issue is data or UI.

---

## Troubleshooting

- **`adb devices` empty** → re-enter `adbon`; replug USB; re-accept the RSA prompt.
- **Live mode falls back to sim** → check Metro logs; a missing native dep makes the
  dynamic import fail and the provider stays on sim (logged with `[DataSource]`).
- **OBD `SecurityException`** → grant `BLUETOOTH_CONNECT` at the runtime prompt; make
  sure the dongle is *paired* in Android settings first.
- **OBD connects but every field is `NO DATA`** → ignition must be on (engine
  running is safest); some clones need `ATSP6` pinned instead of `ATSP0`.
- **g-force looks wrong / axes swapped** → redo calibration (level, then forward).
- **Media toggle greyed out** → Allow restricted settings for the app (§6).

---

## 8. Phase A — become the home screen (launcher, fonts, media)

The release now declares `CATEGORY_HOME` (`plugins/withHomeLauncher.js`), loads the
design typefaces natively, and compiles in the Tier-B MediaBridge module.

1. **Install** — `push-to-truck.command` (it now also sets the default home), or:
   ```bash
   adb install -r android/app/build/outputs/apk/release/app-release.apk
   adb shell cmd package set-home-activity com.benji.tacomadash/.MainActivity
   ```
   Press the unit's **home** button — it should land on the dashboard. The stock
   Telenav launcher stays installed as a fallback; if the app ever fails to start,
   Android falls back to the launcher chooser.
2. **Autostart / keep-alive** — in the vendor "security"/autostart manager whitelist
   Tacoma Dash for **autostart** and disable **battery/background restrictions**, so
   it's up at ignition and isn't killed in the background.
3. **Now-playing (Tier B)** — **SET → MEDIA ACCESS → GRANT ACCESS**. Sideloaded on
   Android 13 the toggle may be greyed: **App info → ⋮ → Allow restricted settings**,
   then enable "Tacoma Dash". Pair a phone over Bluetooth; the card fills within ~2s
   (auto-refresh poll) — no REFRESH tap needed.
4. **Fonts** — nothing to do; Oxanium + JetBrains Mono are bundled. If text still looks
   like the system font, the fonts failed to load: check `adb logcat | grep -i font`.
