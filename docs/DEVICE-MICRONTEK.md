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
