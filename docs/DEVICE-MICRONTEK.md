# Dasaita Vivid13 — Microntek (MTC) device facts

Everything here was **seen on the unit on 2026-10-21** (serial D281FF552A7CA033, QCM6125,
Android 13, MCU `MTCHS_HA4Z_V4.16f_1`). Vendor stack is **Microntek/HCT** (`android.microntek.*`,
`com.microntek.*`). Decompiled sources live in `docs/device/decomp/` (git-ignored APKs in
`docs/device/apks/`); the full package list is `docs/device/packages.txt`.

## Headlights → night mode (FACT)
Flipping the headlight switch makes `android.microntek.service` log
`UpdataHeadLight headlight: true|false` and broadcast
`com.microntek.report.event { type:"headlight", value:<bool> }` (raw MCU form:
`com.microntek.biglight.state { state:int }`; also `com.microntek.carlight { state }`).
Android's own `UiModeManager` night mode does **not** change. The stock launcher follows via
`Settings.System "updateTheme"`, which the service writes on the same event.
→ `modules/mtc-events` receives these; `ThemeProvider` AUTO = headlights ON → night, else clock.

## Battery voltage (FACT)
The status bar's "12.5V" comes from the hidden framework class **`android.microntek.CarManager`**:
`new CarManager().attach(Handler, "CarEvent")` → `Message.obj=="CarEvent"`,
`data.getString("type")=="battery"`, `data.getInt("value")` = **tenths of a volt**. Also
`type=="handbrake"`, `"orientation"`. Synchronous: `getIntState(String)`, `getBooleanState("handbrake"|"backview")`,
`getParameters("cfg_backlight=" | "sta_function=14" …)`. Reached by reflection in `MtcEventsModule.kt`.
`dumpsys battery` is useless here (no battery; voltage 0). `/sys/class/power_supply` is empty.

## Cameras (FACT)
`dumpsys media.camera` → **0 camera devices**. The rear/front/AV inputs are MCU video paths, not
Android cameras: no way to embed the feed. Apps: `com.microntek.backview` / `.frontview`
(explicit `.MainActivity`, only take the screen when the MCU says so — launching by hand does
nothing), `com.microntek.avin` (AV-in viewer, launches, black with nothing connected),
`com.microntek.dvr`. Reverse still overrides everything at hardware level.

## Radio (FACT)
`com.microntek.radio` (`.MainActivity`, launchable). The FM tuner's now-playing is published as
a **MediaSession by the stock launcher `com.telenav.scout.launcher`** (title "102.30", artist =
RDS radiotext e.g. "NPR for the California Coast…", "FM"), so our media-bridge shows it.
No station-logo art in that session.

## OBD (FACT)
vLinker MC+ bonds as **Bluetooth Classic** `08:04:B4:3F:15:38 "vLinker MC-Android"`. Our
`ClassicSppTransport` connects; with the key OFF every PID returns `SEARCHING...STOPPED` (ELM
alive, ECU asleep). The system broadcasts `com.microntek.obd { connect:int }` and lights the
status-bar OBD glyph when any app connects.

## Other broadcasts (from `android.microntek.Constant`)
`com.microntek.acc`, `.systemacc`, `.power`, `.power.offdone`, `.bootcheck`, `.bootcomplete`,
`.carstatechange`, `.obdstatechange`, `.bt.report { bt_state, connect_state, phone_mac }`,
`.VOLUME_CHANGED`, `.irkeyDown/Up`, `.speedstart/.speedend`, `.canbusdisplay`,
`.sync { syncdata: byte[] }` (from `android.microntek.canbus`, periodic), `com.hct.radio.report`,
`com.hct.touch.report`. `MtcEvents` logs any it receives: `adb logcat -s MtcEvents`.

## Notification-listener access without the Settings UI (FACT)
`adb shell cmd notification allow_listener com.benji.tacomadash/expo.modules.mediabridge.MediaBridgeNotificationListenerService`
(the `settings put secure enabled_notification_listeners` route alone does not bind on API 33).

## adb (FACT)
Developer options are behind Factory Settings password **`adbon`** and vanish on power cycle.
Wireless-debug port rotates per boot. Install over Wi-Fi is slow (129 MB ≈ 3 min). Set home:
`cmd package set-home-activity com.benji.tacomadash/.MainActivity`. Stock launcher:
`com.telenav.scout.launcher`. Other launchers present: AGAMA, Car Launcher (khaledisim),
bitpit, altergames, launcher3.

## Hidden-API note (FACT)
`android.microntek.CarManager` is a non-SDK class: plain reflection throws
`NoSuchMethodException: CarManager.<init> []`. Either `adb shell settings put global
hidden_api_policy 1`, or (what `MtcEventsModule` does) the VMRuntime
`setHiddenApiExemptions(["L"])` meta-reflection trick before touching it. Verified:
battery events arrive ~1/s as `{type:"battery", value:125}` → 12.5 V.

## OBD — what the ENGINE face assumes (UNVERIFIED — needs key ON)
No new device facts this round (built and checked in sim only; nothing installed). These are the
assumptions the code makes, to confirm or correct on the truck:
- **Mode 03 format.** The 2TR-FE ECM on CAN (ISO 15765) should answer `43 <count> <hi lo>…`;
  `decodeDtcs` also accepts the legacy un-counted form, ISO-TP multi-frame (`00A` / `0:` / `1:`),
  `00 00` padding and replies from several ECUs. Capture a real reply with codes present.
- **Mode 04 clear.** Expected to need key ON / engine OFF; a refusal (`7F 04 xx`) surfaces in the
  CHECK ENGINE card as "ECU did not accept the clear". Clears the MIL **and** readiness monitors.
- **ATF temperature (EXPERIMENTAL).** Probes, one every ~25 loop ticks once the ECU is awake, each
  with `ATSH7E1` then restored to `ATSH7DF`: `21 82` (reply `61 82 A`), `22 01 82` (`62 01 82 A`),
  `22 1E 1C` (`62 1E 1C A`); °C = A − 40, accepted only in −30…160 °C. The TRANS FLUID tile
  reads "EXPERIMENTAL · NO ANSWER" if none answers. A dongle that ignores `ATSH` will just fail
  all three.
- **Gallons** are MAF-derived (stoich 14.7, gasoline 6.17 lb/gal) — compare a tank against the pump.

## OBD on the truck (FACT, 2026-10-23 — engine idling, parked, vLinker MC+, app build of 10-21)
Read from `adb logcat -s RNBluetoothClassicModule` (the BT library logs every reply as
"Received translated data from the device: 41…" — a free wire tap, no app changes needed).
- **Answering (13):** 04 load, 05 coolant, 06/07 fuel trims B1, 0C RPM, 0D speed, 0F intake,
  10 MAF, 11 throttle, 1F run time, 33 baro, 42 ECU volts, 01 monitor status. Zero NO DATA replies.
- **Not in the truck's support mask (never asked):** 0B MAP (2TR-FE is MAF-only), 2F fuel level,
  46 ambient, 5C oil temp. Fuel level / ambient may exist as Toyota-enhanced PIDs — untried.
- **ATF probe (EXPERIMENTAL):** no `61 82` / `62 …` replies seen — treat as not answering.
- **Idle numbers:** ~750 rpm, MAF 3.4 g/s ≈ 0.30 gal/h, load ~30 %, throttle 17 %, LTFT −6.2 %,
  STFT +1–2 %, ECU 13.59 V, baro 98 kPa, MIL off / 0 codes. Coolant 158 → 163 °F between
  526 s and 572 s run time (crossed the 160 °F warm line at ~9 min idling, intake air 79 °F).
- **Speed:** ~150 ms per request (≈ 6.5 replies/s) *without* the ELM response-count suffix, so a
  SLOW-group PID refreshed only every ~9 s. Build after 10-23 appends `1` ("010C1") to return on
  the first ECU reply; falls back automatically if the adapter answers `?`.
- **Background pause:** the moment another app is in front (`ReactHost.onHostPause`), JS timers
  stop and so does OBD polling (last reply 80 ms after pause); it resumes on HOME. The RFCOMM link
  stays open (status-bar OBD glyph stays lit). So no OBD/MPG logging while CarPlay is in front.
- **Fuel-math corrections (2026-10-28) are UNTESTED on the truck (FACT).** E10 constant k = 11.0
  (was the E0 value — see derive.ts), no gallons during deceleration fuel cut, OBD-speed miles through GPS gaps,
  lateral g in the tank-level gate. What to compare:
  - The first FULL→FULL pump fill after this build: the logbook's `calib` (pumped ÷ measured)
    should now sit near **1.0**; before this change it was expected near **1.04** (E0 constant
    under-counted E10 gallons by ~4 %). Well above 1.0 → DFCO is cutting fuel that was burned.
  - DFCO assumes the throttle at a released pedal while coasting reads within 1.5 % of the warm-idle
    reading (idle 17 %, PID 11). Check a logcat tap on a long coast in gear: 0x11 should stay at
    the idle value (~0x2C–0x2E). If it sits higher, the gate never fires (= the old gallons).
  - A tunnel / garage exit: trip miles should keep counting with no GPS fix (OBD speed).

## Media sessions + foreground behaviour (FACT, 2026-10-23)
- The stock Telenav launcher owns three sessions, told apart by **tag**: `BluetoothMediaService`
  (the phone's music via the unit's BT module — play/pause/next/prev), `radioServerRadioMediaBrowserService`
  (FM: title "102.30", artist RDS "KCLU", album "FM", 4 presets), `LocalMediaService` (USB). Android's
  own `com.android.bluetooth` session sits idle ("Bluetooth audio disconnected"). With wireless CarPlay
  (ZLink) attached the BT session reads "Not Playing"; ZLink publishes no session at all.
- Factory radio app = `com.microntek.radio` (`.MainActivity`); `com.syu.*` / `com.fyt.radio` don't exist here.
- **The stock launcher pops itself to the front** on Bluetooth events (it started `LauncherActivity` 26 ms after
  the vLinker's RFCOMM came up) and for phone calls (in-call card). Our app pauses → before the
  `js-keepalive` module, JS timers froze and OBD init stalled. With it: 175 OBD replies in 20 s with
  Settings in front (verified).
- `Location.requestForegroundPermissionsAsync()` flashes the permission activity even when already granted
  (pauses the app ~0.6 s) — check first.
- With the response-count suffix (`010C1`): 9.2–9.3 replies/s (was ~6.5). Full Mode 01 support mask:
  `01 03 04 05 06 07 0C 0D 0E 0F 10 11 12 13 15 1C 1F 20 21 24 2E 30 31 33 34 3C 3E 40 41 42 43 44 45 47
  49 4A 4C 4D 4E 51 53 60` (protocol A6 = ISO 15765-4 CAN 11-bit 500k, adapter "ELM327 v2.2").
