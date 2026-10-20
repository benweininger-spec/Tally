# Prompt — plumb live car data into the dashboard

Paste everything below the line into Claude Code, run from the repo root. It assumes
milestone 1 is in place (the `DataSource` interface, `SimulatedDataSource`, and the
clean-hybrid HomeScreen all exist and run on web).

---

You are working in an Expo / React Native (SDK 56, TypeScript strict) app that is a
custom Android launcher / dashboard for a Dasaita Vivid13 head unit (Android 13,
Snapdragon 665, 2000×1200 landscape) in a 2016 Toyota Tacoma (2.7L 2TR-FE, naturally
aspirated — there is NO boost/turbo data, never add a boost gauge).

**Read first:** `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/design-brief.md`, and
`src/data/types.ts`. The whole UI binds to the `DataSource` interface and renders
`DashboardData`, where every field is a `Signal<T>` with status `live | stale |
absent`. Today the only source is `SimulatedDataSource`.

## Goal

Add a `LiveDataSource` that implements `DataSource` from real hardware, selectable
at runtime, **without changing a single component or the `types.ts` contract**. Each
data tier lights up independently and degrades to `absent` (never crashes, never
shows an empty gauge) when its source is missing.

## Hard rules

- Do not edit `src/components/**`, `src/screens/**`, or the shape of `types.ts`.
  If you genuinely need a new field, add it to `types.ts` as an optional `Signal`
  and default it to `absent()` everywhere, then update `SimulatedDataSource` too.
- Preserve units the UI already expects: **mph, °F, feet, volts, degrees**. Convert
  at the source (GPS gives m/s and meters; OBD gives °C and kPa).
- Keep `SimulatedDataSource` working as the fallback. Add a source selector (see
  below) so I can flip sim ↔ live without a rebuild.
- Anything that needs a native module will NOT run in Expo Go — set up an Expo
  **dev client** and document the build/sideload steps. Verify every library you
  choose is compatible with **Expo SDK 56 / RN 0.85** and works in a dev build;
  the ecosystem moves, so check current versions rather than assuming.

## Build it in this order (each tier is a vertical slice that ships on its own)

### 1. Source selection plumbing
- Add a `SourceMode = 'sim' | 'live'` setting persisted with `expo-secure-store` or
  `@react-native-async-storage/async-storage`.
- `DataSourceProvider` picks the source from that setting; default `sim`.
- Wire the existing SET dock tile to a minimal settings sheet that toggles the mode
  and shows per-tier connection status (GPS / sensors / media / OBD) read straight
  from the `Signal.status` values.

### 2. Tier A — GPS + motion (official Expo modules, easiest, do first)
- `expo-location`: foreground permission, `watchPositionAsync` with `BestForNavigation`.
  Map `coords.speed` (m/s) → mph, `heading` → headingDeg, `altitude` (m) → ft.
  Derive trip distance (haversine integration), moving time, and avg speed.
- `expo-sensors`: `Accelerometer` + `Gyroscope` (or `DeviceMotion`). Compute
  longitudinal g and lateral g in the vehicle frame — you must rotate the raw device
  axes into the truck's frame and gravity-compensate (the head unit is mounted at an
  unknown fixed angle). Implement a short calibration routine (capture orientation
  while parked/level) and store the offset. Pitch/roll come from the gravity vector.
  Low-pass filter g outputs; push samples into the same history ring buffers the
  signature reads (`getHistory()`), matching `SimulatedDataSource`'s cadence.
- System voltage: there is no clean Android API for the unit's 12V input, and it is
  NOT on the CAN body bus. Leave `system.voltage` as `absent` until OBD provides
  control-module voltage (Tier C), unless you find a Dasaita/MCU serial route — if
  so, document it; do not block Tier A on it.

### 3. Tier C — OBD2 over Bluetooth (the high-value tier; dongle on order)
- Most ELM327 clones are **Bluetooth Classic (SPP/RFCOMM)**, not BLE; some (OBDLink
  MX+) are BLE. Support Classic first via a maintained SPP library
  (e.g. `react-native-bluetooth-classic`), and structure it so a BLE transport can
  be added behind the same interface. Confirm the library builds under SDK 56.
- Implement an ELM327 driver: open RFCOMM, run the AT init handshake
  (`ATZ, ATE0, ATL0, ATS0, ATSP0`), then poll **Mode 01** PIDs on a scheduler with
  sensible per-PID rates (RPM/throttle fast ~10Hz; coolant/fuel slow ~0.5Hz). Parse
  hex responses, handle `NO DATA`/`SEARCHING`/timeouts gracefully (set that field
  `stale` then `absent`, never throw).
- Map to the existing `obd` fields and convert units: RPM (0C), vehicle speed (0D),
  throttle (11), engine load (04), coolant °C→°F (05), intake °C→°F (0F), MAF (10),
  MAP (0B), fuel level (2F), control-module voltage (42) → `system.voltage`,
  baro (33), run time (1F). Derive: instant MPG (from MAF + speed), avg MPG, and a
  rough HP/torque estimate (document the formula + that it's an estimate). Add a
  0–60 timer armed off GPS speed. Read DTC count (Mode 03) for the warning state.
- Set `obd.connected` from the live link state so the UI swaps speed→RPM on the ring
  and the vehicle panel swaps GPS metrics → engine metrics automatically.

### 4. Tier B — now-playing over Bluetooth (needs a native module)
- Reading another app's media metadata on Android requires `MediaSessionManager
  .getActiveSessions`, which needs **Notification Listener access** (a special
  permission the user grants in system settings). There is no Expo module for this —
  write a small **Expo Modules API** native module (Kotlin) that registers a
  `NotificationListenerService`, exposes the active `MediaController`'s metadata
  (title/artist/album/art/position/duration/playing) as events, and forwards
  transport commands (play/pause/next/prev). Map to `media.nowPlaying` and wire the
  existing transport buttons. Guide me through granting the permission on the unit.

### 5. Tier D — acknowledge only
- Head-unit CAN body signals (doors, A/C, reverse) have no public API; reaching them
  means reverse-engineering the MCU serial protocol. Leave `body.supported = false`.
  Do not depend on it. (The rear camera auto-triggers on reverse via the unit itself;
  the launcher's camera tile just launches the factory front-cam app — factory
  password `126`.)

## Dev build, permissions, delivery
- Add config plugins / `app.json` permissions for location (fine + background if
  needed), Bluetooth (`BLUETOOTH_CONNECT`/`SCAN` for Android 12+), and notification
  listener. `newArchEnabled` is already true.
- `npx expo prebuild`, build a dev client, and document **ADB sideload to the head
  unit** (`adb connect <unit-ip>` over WiFi or USB, `adb install`). Note the launcher
  `CATEGORY_HOME` intent is a separate later milestone (M4) — not in scope here.

## Acceptance criteria
- App still runs on web in `sim` mode unchanged.
- In `live` mode on a dev build: GPS speed/heading/altitude and accelerometer g feed
  the signature with no UI changes; with the OBD dongle paired, the ring switches to
  RPM with redline and the vehicle panel fills with engine data; with media playing
  over Bluetooth, now-playing populates and transport works.
- Every source independently degrades to `absent` when unplugged — no crashes, no
  empty gauges, no layout shift.
- Extend `scripts/verify.ts` with pure-logic tests for the new unit conversions and
  the ELM327 hex parser (keep them runnable under `node --experimental-strip-types`,
  no native imports). `npm run verify` stays green.

Work tier by tier, committing each. Start with the source-selection plumbing and
Tier A (no extra hardware needed), then OBD, then the media native module.
