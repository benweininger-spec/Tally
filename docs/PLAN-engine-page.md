# Build spec — ENGINE face + long-term MPG (for the implementing model)

Branch `old-launcher` on https://github.com/benweininger-spec/Tally.git. Read `CLAUDE.md`
first (**Perf model** + **Hard constraints** are non-negotiable), then
`docs/DEVICE-MICRONTEK.md` and `docs/PLAN-phases-B-C.md` (the style and verification bar
items 1–10 were built to). Do NOT touch the device or build an APK — the owner's reviewer
installs. Deliver: code + unit checks + web-verified screenshots, committed on this branch.

## What the owner asked for
"Build some of the OBD stuff in, give me a page with all of it, and a way to track MPG
long term." Specifically, from the OBD list: **trouble codes (read + clear)**, **fuel
trims**, a **Toyota trans-temp probe (experimental)**, and **every OBD value on one page**,
plus **persistent MPG history** (daily + per-trip) with a chart.

## Ground truth you can rely on (verified on the truck, 2026-10-21)
- OBD transport works: vLinker MC+ bonds as Bluetooth Classic (`08:04:B4:3F:15:38`,
  "vLinker MC-Android"); `ClassicSppTransport` connects; with key OFF every PID returns
  `SEARCHING...STOPPED`. Key ON has NOT been tested yet — don't assume PID support beyond
  the standard Mode 01 set; keep everything `absent`-tolerant.
- `src/lib/elm327.ts` already has: `PIDS`, `PID_DEFS` (`{pid,name,bytes,unit,decode(bytes)}`,
  helpers `A`, `AB`), `pidCommand(pid, mode=0x01)`, `parseObdResponse`, `decodePidResponse`,
  `decodeMonitorStatus` (MIL + count), **`decodeDtcs(raw)`** (Mode 03 → `["P0420",…]`, done),
  `decodeSupportMask`. `AT_INIT` = `ATZ ATE0 ATL0 ATS0 ATH0 ATAT1 ATSP0`.
- `src/data/live/obd/ObdManager.ts`: `FAST`/`SLOW` PID lists; `loop()` polls FAST each
  tick, one SLOW every 5th tick, `pollMonitor()` (PID 01) every 200th; `send(cmd, expectPid,
  timeout)` serialises commands; `read(pid): Reading {value, at}`; `dtcCount` getter;
  `supported` set from discovery (`isSupported` doesn't gate when discovery is empty).
- `src/data/live/LiveDataSource.ts`: `buildSnapshot()` maps readings via `obdNum(reading,
  convert)` and `this.fresh(...)`; it owns `FuelAccum` (`src/lib/derive.ts`:
  `{gallons, miles}`, `accumFuel`, `avgMpg`) fed by MAF + GPS distance, skipping idle and
  GPS-reacquire jumps. `LiveControls` is the imperative surface the UI reaches through
  `useSourceControls().live` (null in sim).
- `src/data/SimulatedDataSource.ts` fills `obd` with fake values when `obdConnected`
  (block near `obd: {`); add every new field there too so the web preview demos it.
- Faces: `FaceId`/`FACE_IDS` live in BOTH `src/data/settings.ts` and
  `src/data/settings.web.ts` (`'home'|'drive'|'trail'|'night'`); `src/screens/FacePager.tsx`
  renders them; faces are `src/screens/faces/*Face.tsx` — absolute layout in the 2000×1200
  stage between the header (y=92) and dock (y=1018); see `DriveFace.tsx` for conventions.
- Storage: `@react-native-async-storage/async-storage` via helpers in `src/data/settings.ts`
  (pattern: `KEY_*`, `load*/save*` with try/catch). Pure logic goes in `src/lib` with no
  React/native imports and gets a check in `scripts/verify.ts` (see the
  `DERIVED METRICS` section for the pattern).
- Perf model: widgets are `React.memo` + `useTelemetry(selector)` selecting primitives or
  `shallowEqual` objects, quantised to display precision; no per-frame data in context; no
  continuous JS animation.

## Deliverables

### 1. Data layer
- `elm327.ts`: add `STFT_B1: 0x06`, `LTFT_B1: 0x07` (decode `(A-128)*100/128`, unit `%`),
  and — experimental — a **Toyota AT fluid temp probe**. Implement as a small table of
  candidate raw commands tried once on connect (e.g. Mode 21/22 variants commonly cited for
  Toyota: `2182`, `2201 82`…) with a decoder per candidate; first one that returns parseable
  data wins; none → stays `absent`. Mark EXPERIMENTAL in code and UI; never let a probe
  delay FAST polling (run it after discovery, once).
- `ObdManager.ts`: add trims to `SLOW`; `readDtcs(): Promise<string[]>` (Mode `03`,
  via `decodeDtcs`) called after connect and whenever `pollMonitor` sees `dtcCount>0` (cap
  to every ~60 s); `clearDtcs(): Promise<void>` (Mode `04`, then re-read monitor + codes);
  expose `dtcCodes: {codes, at}`.
- `types.ts` `ObdData`: `stftPct`, `ltftPct`, `transTempF` (all `Signal<number>`),
  `dtcCodes: Signal<string[]>`, `milOn: boolean`. `TripData`: `fuelGallons: Signal<number>`
  (live: `fuel.gallons`; sim: synthetic from instantMpg). Wire sim + live + `LiveControls.clearDtcs()`.
- `src/lib/dtcDescriptions.ts`: pure map of ~60 common codes (P0100–P0500 families,
  P0420/P0430 cats, P0171/P0174 lean, P0300–P0306 misfire, P0335/P0340, P0401/P0441/P0442/
  P0446/P0455 evap, P0500, P0505, P0135/P0141/P0155 O2 heaters, P1xxx Toyota common) →
  short plain-English string; `describeDtc(code)` falls back to a family hint by prefix.
  Verify-test a handful.

### 2. Long-term MPG
- `src/lib/mpgLog.ts` (pure): types `DayBucket {date:'YYYY-MM-DD', miles, gallons}`,
  `Trip {startedAt, endedAt, miles, gallons}`; `addDelta(log, date, dMiles, dGal)`,
  `tripStart/tripUpdate/tripEnd`, `lifetimeMpg(log)`, `last30(log)` → `[{date, mpg|null}]`
  (null for days with < 0.5 mi), `bestWorstDay`. Verify-test the math (incl. days with no
  fuel, and that mpg = miles/gallons never divides by zero).
- `src/data/mpgLogStore.ts`: AsyncStorage persistence (`KEY_MPG_LOG`, debounced save,
  cap 400 days / 200 trips) + a non-rendering recorder started by `DataSourceProvider`
  (use the existing non-rendering `useTelemetryListener` pattern — see `driveRecorder.tsx`):
  every tick diff `trip.distanceMi` and `trip.fuelGallons` against the last persisted
  values (reset detection when either goes backwards), add to today's bucket and the
  current trip; a trip starts at the first motion after launch and ends after 10 min of
  speed < 1 mph or on app relaunch. **Only count when `obd.connected` (gallons are
  MAF-derived)** — miles without gallons are stored but not scored.
- `useMpgLog()` hook (memoised selector over the store, NOT the telemetry stream) for the
  face.

### 3. ENGINE face (new `FaceId 'engine'`, order Home · Drive · **Engine** · Trail · Night)
Full-stage layout, amber, all memoised + selector-fed:
- **Left (hero):** big RPM numeral with the redline band; COOLANT as a cold→normal→hot arc
  (blue-ish→amber→warn; label °F); LOAD % and THROTTLE % bars; OIL TEMP tile if present.
- **Middle grid (6–8 tiles):** INTAKE °F · AMBIENT °F · MAP kPa · BARO kPa · FUEL % · RUN
  TIME h:mm · ECU V vs UNIT V side by side (alternator vs battery) · TRANS °F
  (EXPERIMENTAL, absent until the probe answers) · STFT / LTFT as a centred ± bar each with
  a warn colour beyond ±10 %.
- **Right column:**
  - **MPG** card: INSTANT (big), TRIP AVG, LIFETIME; a **30-day ridgeline** (reuse the
    waveform geometry in `src/lib/pulse.ts`/`VizSurface` like `AltitudeRibbon`; null days
    gap the line); best/worst day; last 5 trips list (date · miles · mpg).
  - **CHECK ENGINE** card: MIL lamp (lit = `milOn`), code count, list of codes with
    `describeDtc`, and a **CLEAR CODES** button → `live.clearDtcs()` with a 2-step confirm
    (tap, then "CONFIRM CLEAR" within 5 s). Disabled in sim with a hint; show "NO CODES ·
    ENGINE OK" when empty.
  - **0–60** last result + **EST HP / TORQUE** small tiles.
- Every tile renders complete with `absent` (dash + dim label), never blank. Sim should
  light the whole page (add a sim DTC like `P0420` + trims ±4 % + a synthetic 30-day log
  so the ridgeline isn't empty in the preview).

### 4. Verify (must be green before committing)
`npx tsc --noEmit --ignoreDeprecations 6.0` clean; `npm run verify` green with new checks
(trim decode, DTC decode incl. padding and multi-frame, describeDtc, mpgLog math);
`npm run web` → swipe to ENGINE in sim: screenshot it in both LIGHT and DARK, attach to
the commit message or `docs/device/` as `engine-face-*.png`. Update `CLAUDE.md` current
state + the Roadmap (Phase C: "OBD validation" → what's now built), and append any new
device facts to `docs/DEVICE-MICRONTEK.md`. Commit on `old-launcher` with a message
listing what's verified vs untested-on-truck (the trans-temp probe and clear-codes are
untested until the key is on).
