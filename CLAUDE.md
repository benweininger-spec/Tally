# 2TR-FE — Tacoma Head-Unit Launcher

Custom Android launcher / live instrument dashboard that replaces the stock home
screen on a Dasaita Vivid13 head unit in a 2016 Toyota Tacoma (base SR, 2.7L
2TR-FE). This is the device home screen: first thing on power-up, where every
"home" press lands.

**This file is the project's central brain.** All durable learnings and decisions
live here or in `docs/`. Keep it current; don't scatter knowledge into code
comments that no one re-reads.

---

## Current state (milestone 1 ✅ · milestone 2 — live data wired)

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
- ✅ **Customizable dock** (`src/dock/*`) — editable app tiles (label + launch link),
  reorder/add/remove/reset in SET → DOCK, persisted, launched via `Linking`. CarPlay
  (static) and SET (settings) are pinned bookends.
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
- ⬜ Phase A/B/C — see Roadmap.

## Run it

```bash
npm install
npm run web        # opens the 2000×1200 stage in a browser (sim), scaled to fit
npm run verify     # pure-logic checks (geometry, sim, units, IMU, ELM327, derived)
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
- **Voltage divergence (intentional, per the live-data brief):** in *live* mode
  `system.voltage` is `absent` until OBD control-module voltage (PID 42) — the unit's
  12V input has no clean Android API and isn't on CAN. The *sim* still fills it (fake).
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
- `SimulatedDataSource.ts` and the pure `src/lib/*` (`pulse`, `units`, `imu`,
  `elm327`, `derive`) must stay runtime-self-contained (type-only relative imports,
  no React/native) so the Node type-strip verifier (`npm run verify`) keeps working.
  `LiveDataSource` + `src/data/live/**` are the *only* place native modules are
  imported, and they're never pulled into `verify` or the web bundle.
- Fonts: Oxanium (display) + JetBrains Mono (labels). Loaded via CDN on web;
  add `expo-font` + `@expo-google-fonts/*` for native in milestone 2.

---

## Design decisions locked this session (full log: `docs/DECISIONS.md`)

1. **Default home face = clean hybrid.** One surface "home" always returns to.
   Grip / Trail / Scope from the mockups become *alternate mode faces* later, not
   the default.
2. **Signature = PulseTach.** Tesla Model S energy-graph model: a scrolling, filled
   **longitudinal-g waveform** wrapped by a **radial ring** that reads **speed
   pre-OBD and RPM (with redline) once the dongle connects**. The center number is
   **always ground speed** (the safety glance); no number is shown twice.
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
- **Phase B — Become a system.** App drawer / picker (launch by package + icons,
  replaces hand-typed dock URLs); system controls in SET (brightness, volume, BT/Wi-Fi
  status + deep-links, display sleep) so Android Settings is rare; **mode faces as the
  information architecture** — a calmer Home (speed + pulse + a glance or two) with the
  dense instruments one swipe away: Sport / Trail / Minimal-Night.
- **Phase C — Bespoke polish.** Skia port of PulseTach + full-motion reactive
  background; boot self-test sweep; source-swap "level up"; tile micro-interactions;
  30s day→night crossfade; **sunlight (`amberDay`) hardening**; drive-history
  ridgeline; altitude + grade ribbon. OBD (M3) validation once the vLinker is paired.

### Perf model (post-audit, 2026-06 — every new surface MUST follow it)
`DataSourceProvider` exposes a stable controls context + a subscribe-based telemetry
store; widgets are `React.memo` + `useTelemetry(selector)` and wake only when their
slice changes. PulseTach runs its own ~25fps loop with an idle-skip. Data tick is 20fps.
Result: idle rendering 29fps→~1.5fps, CPU 203%→~55%. Don't put fast data in context
and don't add continuous motion without Skia.

## Key references

- `docs/design-brief.md` — the full brief (data tiers, constraints, CarPlay boundary).
- `docs/DECISIONS.md` — design decision log + rationale from the kickoff session.
- `docs/ARCHITECTURE.md` — the data-source abstraction in detail.
- `docs/M2-LIVE-BUILD.md` — **how to build the dev client, ADB-sideload to the
  Dasaita (incl. the `adbon` unlock), and bring up each live tier.**
- `docs/PROMPT-live-data.md` — the M2 spec this live-data work implements.
- `REFERENCES/` — visual references (amber VFD, 80s digital clusters, Tesla energy
  graph `model s example.jpg`, Joy Division ridgeline, wireframe terrain).
- `Design Directions/` — the original HTML mockups (4 color directions, 3 layouts).
