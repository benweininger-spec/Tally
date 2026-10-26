# 2TR-FE — Tacoma Head-Unit Launcher

Custom Android launcher / live instrument dashboard that replaces the stock home
screen on a Dasaita Vivid13 head unit in a 2016 Toyota Tacoma (base SR, 2.7L
2TR-FE). This is the device home screen: first thing on power-up, where every
"home" press lands.

**This file is the project's central brain.** All durable learnings and decisions
live here or in `docs/`. Keep it current; don't scatter knowledge into code
comments that no one re-reads.

---

## Current state (milestone 1 ✅ · milestone 2 — live data wired · Phases B+C landed, device-unverified)

A sim-driven preview of the **clean-hybrid home face** (M1), plus a complete
**`LiveDataSource`** that feeds the same UI from real hardware (M2), selectable at
runtime. Web still runs the sim with zero hardware; live mode is native-only.

- ✅ Data-source abstraction (`src/data`) — UI binds to an interface, not to GPS/OBD.
- ✅ `SimulatedDataSource` — believable driving telemetry, OBD togglable.
- ✅ Amber theme tokens, themeable, with a day/night swap (`src/theme`).
- ✅ Signature element — **PulseTach** (oscilloscope-g + RPM/speed ring), `src/components/signature`.
- ✅ HomeScreen + widgets (header, media, compass, vehicle, dock) at 2000×1200.
- ✅ Pure-geometry + simulator + **units / IMU / ELM327 / derive** unit checks (`npm run verify`).
- ✅ **`LiveDataSource`** behind the unchanged `DataSource` contract: Tier A (GPS +
  IMU g-force), Tier C (OBD2 ELM327 over Bluetooth Classic), Tier B (staged media
  module). Runtime **sim ↔ live** switch + per-tier status in the SET settings sheet.
- ✅ **Live gyro/attitude instrument** (`src/components/GyroCard.tsx`) — SVG horizon
  that tilts with roll / shifts with pitch + a lateral-g slip bubble, animated off
  the live ~30fps stream (no animation lib; GPU-light). Center column of the home face.
- ✅ **Theme toggle** LIGHT / AUTO / DARK in SET (AUTO follows daylight); persisted
  via `ThemeProvider` + `useThemeMode()`.
- ✅ **Customizable dock** (`src/dock/*`) — tiles are `{id,label,package,activity?,url?}`:
  launch by package (AppList module) with a deep-link URL fallback; v1 `{label,url}` tiles
  migrate via `normalizeDock`. Reorder/remove/reset + link tiles in SET → DOCK. CarPlay
  (static), APPS (drawer) and SET are pinned.
- ✅ **Radio in the media box** (`src/radio/*`) — a BLUETOOTH/RADIO source toggle. The
  FM/AM tuner has **no public control API** on this hardware (MCU-driven, same wall as
  Tier D), so it's **launch-only**: RADIO opens the factory radio app via
  `expo-intent-launcher` (`com.syu.radio` probable — confirm via ADB). The tuner UI is
  modeled as its own provider with a `controllable` flag — interactive in sim, honest
  `absent · LAUNCH FACTORY RADIO` on the unit; lights up if an MCU bridge is ever built.
- ✅ **Running on the panel** as a standalone release (`push-to-truck.command` rebuilds +
  installs). Perf overhaul landed (see Perf model below). **CarPlay tile** launches ZLink's
  `CarPlayActivity` (`src/carplay/launchCarPlay.ts` + `withCarPlayQueries`).
- ✅ **Traction circle** (g-g dot, `TractionCircle.tsx`) + **reactive background**
  (`ReactiveBackground.tsx`, speed/lat-g amber glow, nothing when parked). Parked-heading
  hold; RPM/speed follower glide; waveform range 0.40 g.
- ✅ **Plan items 1–10** (`docs/PLAN-phases-B-C.md` — per-item status + the on-truck
  checklist live there). Web-verified in sim; native compiled into a release APK; NOT yet
  run on the head unit:
  1. **App drawer** — `modules/app-list` (Kotlin: MAIN/LAUNCHER activities, 96 px PNG
     icons cached, explicit-component launch), `withLauncherQueries` plugin,
     `src/apps/AppsProvider.tsx`, `src/screens/AppDrawer.tsx` (6×3 paged, hold = pin).
  2. **Mode faces** — `src/screens/faces/{Home,Drive,Trail,Night}Face.tsx` in
     `FacePager` (PanResponder capture + one native-driver translateX; only active +
     drag-neighbor mounted; last face persisted). NIGHT = `amberNightDim` (night palette at
     40% luminance). Dusk suggests NIGHT once (header pill), never auto-switches.
  3. **Quick controls** — `modules/sys-controls` (brightness/timeout behind the
     WRITE_SETTINGS grant, media volume, read-only BT/Wi-Fi + deep links) → SET → QUICK
     CONTROLS; `expo-network` → header WI-FI/LTE (`connectivityProvider`).
  4. **Boot sweep** — pure timeline `src/lib/sweep.ts`, played inside PulseTach's loop via
     `signature/sweepChannel.ts`; `BootSweep` veil; SET → MOTION → REDUCED skips it.
  5. **Altitude + grade** — `History.altitude` (every 0.02 mi, 250 slots), `gradePct`
     (least-squares, `src/lib/derive.ts`), `AltitudeRibbon` (Drive strip + Trail band).
  6. **Dusk crossfade** — `lerpTheme`, 60 quantized steps over 30 s (0.5 s for a tap).
  7. **Press feedback** — `src/components/ui/Press.tsx` on every tap target.
  8. **OBD-connect moment** — `ConnectMoment` (edge-triggered sweep + ticker), staggered
     VehiclePanel; SET → SIMULATOR has OBD ON/OFF + DAY/NIGHT override.
  9. **Daylight** — `amberDay` retuned to ≥ 7:1 (accent 8.1, text 17.1, warn 7.5);
     `stroke` / `ambientMax` tokens; `npm run contrast`; SET → THEME split preview.
  10. **Skia** — `PulseTachSkia` + `ReactiveBackgroundSkia` (Reanimated shared values,
     zero React renders per frame); SVG kept as web renderer + native fallback
     (`skiaFallback.tsx`).
- ✅ **Signal Library instruments** (from the Claude Design handoff `design_handoff_tacoma_launcher`,
  studies 04 / 06 / 07; math ported 1:1 into pure `src/lib/{gscope,speedRecord,mesh}.ts`):
  - **G-Scope** — DRIVE traction card (replaced `TractionCircle`) and NIGHT → SCOPE. Hold = reset peaks.
  - **Speed Record** — tachograph disc, NIGHT → RECORD (default); clock in the hub.
  - **Attitude Mesh** — TRAIL hero, tilt ×1.8 (labelled). The truck is `src/lib/tacoma.ts`: a
    wireframe of the owner's **3rd-gen Access Cab / 6.1 ft bed / SR 4x2**, generated from Toyota's
    published dimensions (212.3″ L, 127.4″ WB, 74.4″ W, 70.6″ H, 245/75R16) — edit stations there.
    The study's rotation had pitch AND roll inverted; `tiltTransform` follows the IMU convention
    (verify pins it).
  - NIGHT has a 3-way switch RECORD / SCOPE / RING (persisted, `nightStyle`).
  - Plumbing: `src/lib/driveRecorder.ts` + `<DriveRecorderFeed/>` (always-on g trail, grip envelope,
    90 s speed/RPM ring, fed via `useTelemetryListener` — no renders); `src/components/viz/VizSurface`
    = declare styled layers once, push path strings per frame; Skia on device, SVG on web/fallback.
  - New theme token `accentAlt` (the studies' second color: envelope, up-vector, RPM track).
- ✅ **ENGINE face + long-term MPG** (spec `docs/PLAN-engine-page.md`; faces now
  Home · Drive · **Engine** · Trail · Night). Screenshots: `docs/device/engine-face-{light,dark}.png`.
  - **Face** (`src/screens/faces/EngineFace.tsx`, parts in `src/components/engine/*`): RPM hero
    (segmented bar, redline 4,700) · coolant arc cold→normal→hot (new `cold` token) · LOAD /
    THROTTLE · OIL; middle grid INTAKE · AMBIENT · MAP · BARO · FUEL · RUN TIME · ECU-vs-UNIT
    volts · TRANS (EXPERIMENTAL) · STFT / LTFT ± bars (warn beyond ±10 %); right: FUEL ECONOMY
    (instant / trip / lifetime, 30-day ridgeline with gaps, best/worst day, last 5 trips),
    CHECK ENGINE (MIL lamp, codes + `describeDtc`, two-step CLEAR CODES, live-only), 0–60 /
    EST HP / TORQUE. Every block renders complete when absent (checked with sim OBD OFF).
  - **OBD layer** (`src/lib/elm327.ts`, `obd/ObdManager.ts`): PIDs 06/07 trims; CAN-aware Mode 03
    decode (count byte, ISO-TP multi-frame, padding, per-ECU dedupe), read once the ECU wakes and
    re-read ≤ 60 s when the monitor reports codes; Mode 04 `clearDtcs()`; EXPERIMENTAL Toyota ATF
    probe (header 7E1: `2182` / `220182` / `221E1C`, plausibility −30…160 °C, first answer wins,
    then polled every 40 ticks). Header-changing probe and the clear run in mutually exclusive
    sections so a clear can never go to the TCM. New signals: `obd.{milOn, dtcCodes, stftPct,
    ltftPct, mapKpa, ecuVolts, transTempF}`, `trip.fuelGallons`, `system.unitVoltage`.
  - **MPG log** (`src/lib/mpgLog.ts` pure + `src/data/mpgLogStore.tsx`): daily buckets (400) +
    trips (200, end after 10 min < 1 mph), persisted (`tacoma-dash:mpgLog`, 30 s debounce, now on
    trip end). Only miles with OBD fuel flow are *scored*; non-OBD miles are stored but never
    dilute the mpg. Sim uses a separate, never-persisted synthetic 30-day log.
  - `src/lib/dtcDescriptions.ts`: ~94 common 2TR-FE / generic codes + family fallback.
- ✅ **Truck OBD audit + HOME glances (2026-10-23)** — measured on the truck via the BT library's
  logcat tap (`docs/DEVICE-MICRONTEK.md` → "OBD on the truck"): 13 PIDs answer; MAP, fuel level,
  ambient and oil temp are NOT in the 2TR-FE's support mask. So:
  - HOME gained **ECONOMY** (2 s-smoothed instant mpg on a 0–40 bar, **ECO zone ≥ 21 mpg** = EPA
    combined for the 2.7 4x2 auto, IDLE + gal/h when stopped, trip / lifetime) and **ENGINE TEMP**
    (coolant + warm-up bar to 160 °F) — `src/components/HomeGlance.tsx`, rules in pure
    `src/lib/engineGlance.ts` (shared with the ENGINE coolant arc).
  - ENGINE's dead tiles swapped for fed ones: OIL → FUEL RATE (gal/h), AMBIENT → AIRFLOW (MAF),
    MAP → ECU SPEED vs GPS (speedo check), FUEL LEVEL → FUEL USED (session, from MAF). New
    signals `obd.{fuelRateGph, mafGps, ecuSpeedMph}`.
  - OBD speed-ups: ELM response-count suffix (`010C1`), unsupported SLOW PIDs no longer eat a
    slot, SLOW PIDs stay live 15 s / visible 45 s (they blinked to a dash before).
  - **SET → OBD DIAGNOSTICS**: per-PID OK / NO DATA / NOT ON THIS TRUCK with value + age, the
    full support mask, adapter banner, protocol, replies/s; plus a `[OBD]` logcat line every 30 s.
  - `modules/js-keepalive`: a never-ending headless JS task keeps RN timers running while
    another app (CarPlay, the stock launcher, a permission flash) is in front — verified: 175
    OBD replies in 20 s with Settings on top. Data tick drops to 2 Hz while hidden.
  - Fuel integration uses MEASURED dt (the fixed 50 ms under-counted gallons → 29–34 mpg trips)
    and includes idle fuel. MPG history recorded before 2026-10-23 is inflated.
- ✅ **Media on the unit (2026-10-23/26)** — the stock Telenav launcher owns the phone's BT music,
  FM and USB sessions, told apart by session TAG (`docs/DEVICE-MICRONTEK.md`). BLUETOOTH card follows
  the BT session (verified working); RADIO has ▶ FM / ❚❚, seek, ☆ (the session's own Favorite
  action), station logo, and favourite tiles from the tuner's queue (skipToQueueItem; HOME only —
  DRIVE's rail has no room). Factory radio app = `com.microntek.radio`. Logos/art are encoded once
  and cached in the Kotlin bridge (LRU). Favourites/logos untested on the unit.
- ✅ **Legibility pass (2026-10-26)** — every literal font ≤ 16 px bumped (floor 15 px), header
  23 px, ECONOMY trip/lifetime in bold 24 px, signature captions larger; G-Scope readouts moved to
  the DRIVE card's title row (they collided at 300 px). Immersive sticky mode (`setImmersive` in
  `modules/sys-controls`, re-applied on resume) hides the unit's top bar, which carries the nav
  buttons and was drawn OVER our header — untested on the unit; swipe from the edge to reveal.

- ✅ **Logbook + trip summary (2026-10-26)** — pure model `src/lib/logbook.ts` (verify-tested),
  store `src/data/logbookStore.tsx` (persisted `tacoma-dash:logbook`; SIM has a never-saved demo
  logbook), UI `src/logbook/*` (big number pad, tap-to-edit fields, date steppers — no Android
  keyboard except the optional note). Fed by the MPG recorder's own mile / gallon deltas.
  - **Fuel tank** (HOME card beside HEADING): fuel left + range. The 2TR-FE has no PID 2F, so it's
    the fill-up estimate — after a FULL fill the tank = 21.1 gal, minus MAF gallons × `calib`
    (pumped ÷ measured, learned from full→full fills, median of 3, sane range 0.6–1.6). One-tap
    FILLED UP; fields are PREFILLED with our estimate / last price / est. odometer, and an
    untouched estimate is saved as "not entered" so it can never calibrate us against ourselves.
    EXPERIMENTAL gauge-cluster probe (7C0 `2129`, rx 7C8 via ATCRA, litres = A/2) supersedes the
    estimate if the truck answers — untried on the unit.
  - **Service** (SET → LOGBOOK, HOME header nudge when due ≤ 500 mi / 30 days): Toyota-guide
    intervals in `SERVICE_TYPES`; back-logging old service by date; odometer = last entered
    reading + logged miles (a back-dated entry never rewinds it).
  - **Trip summary** (`TripSummaryLayer`, any face): on PARK a "TRIP SUMMARY ›" button bottom-centre
    (2 min); tap → card centred in the bottom half for 20 s (miles, minutes, avg mpg, fuel $, ECO %,
    idle, top speed, gallons). `Trip` gained movingSec / idleSec / ecoSec / maxMph.
  - **Spending**: fill-ups take gallons + $/gal OR the pump TOTAL (`FillUp.total`); `spending()` →
    this month / 30 days / avg price / cost per mile (avg price ÷ pump-honest mpg, else MAF ÷ calib).
    FUEL tab header + the HOME fuel card's foot line.
- ✅ **Truck feedback round (2026-10-26)** — gauge-cluster fuel probe ANSWERS on the truck (real
  level, ~72 % read 15.2 gal) but swings with grade → `src/lib/fuelFilter.ts`: last 5 min, level-only
  readings (IMU pitch/roll ≤ 4°, |g| ≤ 0.08), interquartile mean, refuel jump resets. Boot connect:
  retry every 3 s for 2 min after launch / ignition, and the ELM init sends `ATSPA6` (last session's
  protocol, auto-fallback) instead of searching. The dash ignores Android font scale
  (`allowFontScaling={false}` on every Text — the SET control used to push text off the cards; it's
  now labelled "Android text size, other screens"). RADIO: seek = MCU `ctl_radio_seek=up/down`,
  − / + = `ctl_radio_tune` (via CarManager.setParameters, whitelisted in MtcEvents — from the
  decompiled com.microntek.radio RadioService); the launcher session's next/prev only walks
  FAVOURITES once any exist (also what the steering-wheel buttons drive — stock launcher's call).
  Fallback tune = `hct.radio.bar.move` {FREQ Hz}; state from `com.microntek.radio.report`.
- ✅ **Gear readout + park (2026-10-26)** — `src/lib/gear.ts` (verify-tested) + `src/data/gearStore.tsx`
  + `GearBadge` (P R D + gear digit in the dial's bottom gap, HOME + DRIVE). Forward gear = rpm ÷ mph
  against the AC60E ladder (3.6 / 2.09 / 1.488 / 1.0 / 0.687 / 0.58) × K (≈ 43.1, self-learning).
  REVERSE = the MCU's `report.event` type "backview" (found in the decompiled MicrontekServer —
  same channel as the verified headlight event; untested on the unit). PARK = reverse released
  while stopped with no forward roll within 4 s (D→P passes R), or engine off; a 1-min stop is
  the fallback for the summary prompt. N isn't detectable, so it isn't shown.
- ✅ **Colour ramps (2026-10-26)** — coolant steps blue → amber at 120 / 140 / 160 °F; economy is
  green (new `eco` token, ≥ 7:1 by day) at ≥ 21 mpg fading through amber to warn at ≤ 12
  (`src/theme/glanceColors.ts`). SET → TEXT SIZE no longer greys out silently: tapping it without
  the "Modify system settings" grant opens the grant page (or grant over adb:
  `appops set com.benji.tacomadash WRITE_SETTINGS allow`).

## Run it

```bash
npm install
npm run web        # opens the 2000×1200 stage in a browser (sim), scaled to fit
npm run verify     # pure-logic checks (geometry, sim, units, IMU, ELM327, derived,
                   # grade, sweep timelines, theme math, day contrast)
npm run contrast   # WCAG table for every palette token (day targets in themes.ts)
```

**Live on the head unit** (Expo dev client + ADB sideload): see
`docs/M2-LIVE-BUILD.md`. In the app, **SET → DATA SOURCE → LIVE** flips sim↔live
at runtime (persisted; no rebuild). Tier A needs no extra hardware; Tier C lights
up when the ELM327 dongle is paired.

Toggle the OBD-connected state in the **sim** to see both realities: edit the
default in `src/data/SimulatedDataSource.ts` (`obdConnected`) or call
`useDataSource()` → `(source as SimulatedDataSource).setObdConnected(false)`.

---

## Architecture (the one rule that matters)

**The render tree never touches a data source.** Everything flows through
`DataSource` (`src/data/types.ts`). It's `SimulatedDataSource` (default, web) or
`LiveDataSource` (GPS + sensors + OBD + media), chosen at runtime from a persisted
`SourceMode` — **zero component changes** to swap. Every field is a `Signal<T>` with
an explicit `live | stale | absent` status, so the UI degrades gracefully when a
source is missing — never an empty gauge. Full write-up: `docs/ARCHITECTURE.md`.

### Live data layer (`src/data/live`, M2)
- `LiveDataSource` is the composition root: it ticks ~30fps like the sim, reads each
  provider, **converts at the source** to UI units, derives metrics, and stamps each
  field's freshness. It's **dynamic-imported only on native + live**, so web never
  bundles a native module (verified: Metro code-splits it into its own chunk).
- **All math is pure + tested** in `src/lib` (no native imports), so `npm run verify`
  covers it: `units.ts` (conversions + haversine), `imu.ts` (vehicle-frame g +
  calibration), `elm327.ts` (AT/PID parse + DTC), `derive.ts` (MPG/HP/torque/0-60).
  Providers (`locationProvider`, `sensorProvider`, `obd/*`, `mediaBridge`) are thin
  wiring only.
- **OBD** talks to a swappable `ObdTransport` (Classic SPP now via
  `react-native-bluetooth-classic`; BLE droppable in later) — same philosophy one
  layer down. ELM327 init + fast/slow PID scheduler in `obd/ObdManager.ts`.
- **OBD auto-connect:** connect once in SET and the adapter MAC is remembered; from then on
  `LiveDataSource` dials it by itself and retries with backoff until the dongle wakes
  (policy in pure `src/lib/obdLink.ts`), kicked by ignition-on (ACC broadcast) and
  app-foreground. `ObdManager` reports drops (transport event, or 8 commands in a row with
  no bytes back = stale socket — counted per command, not wall time, because JS freezes
  while another app is in front) so the source redials. The background loop never shows a permission
  prompt. Untested on the truck.
- **Voltage:** live `system.voltage` = OBD PID 42 when the dongle has it, else the head
  unit's own 12V input via `android.microntek.CarManager` ("battery", tenths of a volt —
  `src/data/live/mtcProvider.ts`, `modules/mtc-events`). The old "no Android API" belief
  was wrong; see `docs/DEVICE-MICRONTEK.md`.
- **Headlights:** `system.headlights` (null = unit doesn't report) from the Microntek
  `com.microntek.report.event` broadcast; **AUTO theme = headlights ON → night, else clock.**
- **The swap rule still holds:** the live data drops in with **zero changes to how any
  widget reads/renders data** — components bind to `DashboardData` only. `types.ts`
  gained one *optional* `obd.zeroToSixtySec` signal (defaulted absent). UI *features*
  added afterward (gyro card, theme toggle, dock customization) deliberately add/edit
  components — that's product work, separate from the data-source abstraction.

Data tiers (see `docs/design-brief.md` §3):
- **A** GPS + onboard sensors + system voltage — live now, no hardware.
- **B** phone/media over Bluetooth (A2DP/AVRCP) + app launching.
- **C** full OBD2 (ELM327/OBDLink dongle, on order) — designed-for, lights up on connect.
- **D** head-unit CAN body signals — walled off, no API; acknowledged, never depended on.

## Hard constraints (non-negotiable — `docs/design-brief.md` §2)

- Landscape **2000×1200**, rotation locked.
- **Glanceable while driving**: safety data readable < 1s, large touch targets.
- **Day + night legibility** incl. direct desert sun. Dark amber is the night hero;
  `amberDay` is the high-contrast daylight treatment (still being tuned — sunlight
  is the weak spot of amber-on-black, treat it as a real requirement).
- **Performance budget**: Snapdragon 665. Signature must stay GPU-light → Skia in
  milestone 2 (see below). No stutter.
- **Graceful with missing data**: complete and intentional on Tiers A+B alone.

## Conventions

- TypeScript strict. Path alias `@/*` → `src/*` (also plain relative imports work).
- Pure, testable logic (geometry, formatting, sim math) lives in `src/lib` and
  `src/data` with **no React imports**, so `npm run verify` can run it in Node.
- `SimulatedDataSource.ts`, the pure `src/lib/*` (`pulse`, `units`, `imu`, `elm327`,
  `derive`, `sweep`) and `src/theme/themes.ts` must stay runtime-self-contained
  (type-only relative imports, no React/native) so the Node type-strip verifier
  (`npm run verify`) keeps working.
- Native code is reached only through: `LiveDataSource` + `src/data/live/**` (dynamic,
  native + live only); the local modules' JS faces (`modules/app-list`,
  `modules/sys-controls` — each has an `index.web.ts` stub, resolved optionally so an old
  dev client degrades instead of crashing); and the `*Skia.tsx` surfaces, which load
  lazily behind `skiaWithFallback` (SVG twin on failure; `*.web.tsx` → SVG on web).
- Every tap target uses `Press` (`src/components/ui/Press.tsx`) — tactile feedback,
  native driver. Every decorative animation respects SET → MOTION (`useMotionPref`).
- Fonts: Oxanium (display) + JetBrains Mono (labels). Loaded via CDN on web;
  add `expo-font` + `@expo-google-fonts/*` for native in milestone 2.

---

## Design decisions locked this session (full log: `docs/DECISIONS.md`)

1. **Default home face = clean hybrid.** One surface "home" always returns to.
   Grip / Trail / Scope from the mockups become *alternate mode faces* later, not
   the default.
2. **Signature = PulseTach.** Tesla Model S energy-graph model: a scrolling, filled
   trace wrapped by a **radial ring** that reads **speed pre-OBD and RPM (with
   redline) once the dongle connects**. The center number is **always ground speed**
   (the safety glance); no number is shown twice. **2026-10-26: the trace is the last
   minute of THROTTLE % on a fixed 0–100 scale (speed when OBD is down)** — the ring already
   carries RPM (was longitudinal g — on the truck it read as jittery noise with no
   meaning to the driver): read from the always-on drive recorder, 1.5 s box-averaged and
   drawn as a Catmull-Rom spline (`buildTrace` in `src/lib/pulse.ts`, verify-tested: one
   new sample moves the curve < 1.5 px), scale changes eased over ~1 s.
3. **Amber is the shipped theme.** Architecture is themeable; we ship one theme,
   not four.
4. **SVG now, Skia later.** Milestone 1 renders the signature in `react-native-svg`
   (runs on web + Expo Go instantly). The geometry already lives in `src/lib/pulse.ts`,
   so the milestone-2 Skia port (for 665 perf) won't touch data wiring.
5. **Vehicle panel reads complete without OBD** — Tier-A data fills it; OBD adds
   richer metrics on connect. No "AWAIT OBD —" dashes.

## Roadmap — "make Android invisible"

**Strategy (locked 2026-09):** we don't replace Android, we make it invisible. On a
single-purpose head unit the driver's whole experience is the launcher + a fullscreen
app + our own settings — all replaceable at the app layer, no root/ROM. Own those and
the stock Telenav launcher, system bar, and Android Settings are never seen.
What stays walled off (boot animation, volume HUD, third-party app internals, radio
tuning, CAN body data) we hide, deep-link around, or accept. **When we're the
launcher, crash-free is a hard requirement** — keep the stock launcher installed as
fallback.

- **Phase A — Own the home (in progress).** ① `CATEGORY_HOME` launcher intent
  (`plugins/withHomeLauncher.js`; set default with
  `adb shell cmd package set-home-activity com.benji.tacomadash/.MainActivity`) +
  whitelist in Dasaita's vendor autostart manager. ② Native fonts via `expo-font` +
  `@expo-google-fonts` (Oxanium/JetBrains Mono registered under the style family
  names). ③ Tier-B media compiled in (`npm run media:enable`) + Notification access.
  *After this the stock OS is invisible.*
- **Phase B — Become a system (✅ landed, device-unverified).** App drawer / picker (launch by package + icons,
  replaces hand-typed dock URLs); system controls in SET (brightness, volume, BT/Wi-Fi
  status + deep-links, display sleep) so Android Settings is rare; **mode faces as the
  information architecture** — a calmer Home (speed + pulse + a glance or two) with the
  dense instruments one swipe away: Sport / Trail / Minimal-Night.
- **Phase C — Bespoke polish (mostly ✅: Skia, sweep, crossfade, press, connect moment,
  amberDay, altitude ribbon; open: source-swap "level up", drive-history ridgeline).** Skia port of PulseTach + full-motion reactive
  background; boot self-test sweep; source-swap "level up"; tile micro-interactions;
  30s day→night crossfade; **sunlight (`amberDay`) hardening**; drive-history
  ridgeline; altitude + grade ribbon. **OBD (M3): ENGINE face built** (trims, codes read +
  clear, ATF probe, long-term MPG — see Current state); what's left is *validation on the
  truck with the key on*: Mode 04 clear, which ATF probe (if any) answers, the real Mode 03
  frame format, and MAF-derived gallons vs the pump.

**Next with the truck linked:** auto-return to the dash after calls / when the stock launcher pops
up on Bluetooth connect, and boot order (ZLink should connect first, the dash end up in front) —
needs the unit's call-state broadcasts + a background-activity-start test (likely
`appops SYSTEM_ALERT_WINDOW allow`). **Parked ideas (don't clutter until placeable widgets
exist):** extra PIDs the truck supports — catalyst temp 3C, timing advance 0E, accelerator pedal
49, commanded AFR 44; a placeable-widgets feature for HOME.

### Perf model (post-audit, 2026-06 — every new surface MUST follow it)
`DataSourceProvider` exposes a stable controls context + a subscribe-based telemetry
store; widgets are `React.memo` + `useTelemetry(selector)` and wake only when their
slice changes. PulseTach runs its own ~25fps loop with an idle-skip. Data tick is 20fps.
Result: idle rendering 29fps→~1.5fps, CPU 203%→~55%. Don't put fast data in context
and don't add continuous motion without Skia. Slow derived state (the MPG log) lives in its
own store fed by a non-rendering listener; `useMpgLog(selector)` notifies ≤ 1 Hz.
**Skia (2026-10):** per-frame motion goes through Reanimated shared values into Skia
props (PulseTach writes path strings from its loop; Skia's `processPath` worklet builds
the SkPaths on the UI thread) — zero React renders per frame. Text stays in RN `Text`
and re-renders only when the shown value changes. Web (dev) measurement: React work
107.7 → 6.4 ms/s for the signature. Device target (unmeasured): ≥ 90 % non-janky
frames in `dumpsys gfxinfo`, CPU < 60 % with the sim at speed.

## Key references

- `docs/design-brief.md` — the full brief (data tiers, constraints, CarPlay boundary).
- `docs/DECISIONS.md` — design decision log + rationale from the kickoff session.
- `docs/ARCHITECTURE.md` — the data-source abstraction in detail.
- `docs/DEVICE-MICRONTEK.md` — **verified head-unit facts**: headlight broadcast, CarManager voltage, cameras (launch-only), radio session, OBD, adb quirks.
- `docs/M2-LIVE-BUILD.md` — **how to build the dev client, ADB-sideload to the
  Dasaita (incl. the `adbon` unlock), and bring up each live tier.**
- `docs/PROMPT-live-data.md` — the M2 spec this live-data work implements.
- `REFERENCES/` — visual references (amber VFD, 80s digital clusters, Tesla energy
  graph `model s example.jpg`, Joy Division ridgeline, wireframe terrain).
- `Design Directions/` — the original HTML mockups (4 color directions, 3 layouts).
