# ENGINE face v2 — "a driver's page, not a mechanic's" — build spec

Branch: `old-launcher`. Reviewer installs; **do not build an APK or touch the device.**
Follow `CLAUDE.md` exactly: perf model (memo + `useTelemetry(selector)` on quantised
primitives, slow state in its own store), pure logic in `src/lib` with no React, every
tap target through `Press`, 2000×1200, complete-when-absent.

## Why

The owner reviewed the ENGINE face (2026-10-28): ~20 numbers, most of them raw sensor
values or diagnostics that need a definition ("I don't know what trim even means").
v2 keeps the things that drive a decision, turns diagnostics into **plain-English
verdicts**, and adds the ownership stuff a 10-year-old truck actually needs (battery
health, pending faults, service due, range). Target: **~8 glanceable items, nothing
on the page needs explaining.**

**Data layer stays intact.** Don't remove any `ObdData` / `TripData` / `SystemData`
signal — trims, MAF, baro, load, etc. keep flowing (the health verdicts read them, the
diag sheet shows them). This is a presentation rewrite plus three small data additions.

## Ground truth (verified in the tree)

- Face: `src/screens/faces/EngineFace.tsx` — three absolute columns at `TOP = 116`,
  `H = 886`: left x 48 w 600 (`RpmCard`, `CoolantCard`, `LoadThrottleCard`,
  `FuelRateTile` from `src/components/engine/EngineHero.tsx`); middle x 672 w 600
  (`EngineGrid.tsx`: rows `[Intake, Airflow] [EcuSpeed, Baro] [FuelUsed, RunTime]
  [Volts, Trans] [Stft, Ltft]`); right x 1296 w 656 (`MpgCard`, `CheckEngineCard`,
  `PerfTiles` = 0–60 / EST HP / TORQUE).
- Shared parts: `src/components/engine/parts.tsx` exports `Card`, `Tile`, `PctBar`,
  `TrimBar`, `TRIM_WARN = 10`, `styles`.
- `CheckEngineCard.tsx`: MIL lamp, `describeDtc` list (max 3), two-step CLEAR via
  `live.clearDtcs()` (armed 5 s), live-only with reasons. Keep its logic; it moves.
- `MpgCard.tsx`: instant / TRIP AVG / LIFETIME stats, 30-day ridgeline (`last30`,
  `runs`), BEST / WORST, LAST TRIPS; reads `useMpgLog` (≤ 1 Hz) + one `useTelemetry`
  for instant.
- HOME already shows: warm-up state (`HomeGlance.tsx` via `coolantState` /
  `warmupFrac` from `src/lib/engineGlance.ts`), trip + lifetime mpg, the logbook card
  (`HomeLog.tsx`: `fuelLeft`, `rangeMiles`, `spending`, `nextDue`, `dueText`,
  `lastPrice`, TANK_GAL) with its "TAP FILLED UP" entry point — **find that tap path
  and reuse it for every logbook link on ENGINE; don't build a second editor.**
- Logbook: `src/lib/logbook.ts` (`serviceStatus(lb, now)` → `ServiceStatus[]` most
  urgent first with `state: 'ok'|'soon'|'due'|'never'|'unknown'`, `dueText`, `fuelLeft`,
  `rangeMiles(gal, mpg)`, `pumpMpgs`, `lastPrice`); store `src/data/logbookStore.tsx`
  (`useLogbook(selector)`, `logbookStore.service/fill/odometer`).
- Thresholds already defined: `COOLANT_HOT_F = 230`, `COOLANT_WARM_F = 160`
  (`engineGlance.ts`); `TRIM_WARN = 10` (`parts.tsx`) — move it to the new pure lib.
- Voltage: `system.unitVoltage` = head-unit 12 V input from CarManager, **updates about
  every 1.2 s** (FACT, logcat 2026-10-21: battery events at 29.479 and 30.692). It is
  present with the key in ACC before the engine runs. `obd.ecuVolts` = PID 42, only with
  OBD up. `obd.rpm` absent until the ECU answers.
- DTCs: `src/lib/elm327.ts` `decodeDtcs(raw, respByte = 0x43)` already decodes Mode 07
  with `respByte = 0x47`. `ObdManager.readDtcs()` sends `'03'` with
  `parseResponse(f, [0x43])`; `pollMonitor()` runs every 200 ticks and re-reads codes.
- Theme tokens: `warn` (red), `cold` (blue), `accentAlt`, plus the economy colour helper
  `economyColor(t, mpg)` used by `HomeLog.tsx`.
- 0–60 lives only on ENGINE today (`PerfTiles`); `src/components/TelemetryStrip.tsx` is
  DRIVE's bottom strip.
- Sim: `SimulatedDataSource.ts` lights every OBD signal; SET → SIMULATOR has OBD ON/OFF.

## Deliverables

### A. Pure verdict logic — `src/lib/engineHealth.ts` (new, verify-tested, no imports)

```ts
export type HealthLevel = 'ok' | 'watch' | 'warn' | 'unknown';
export interface HealthItem { id: string; level: HealthLevel; label: string; detail: string }
export interface HealthInput {
  obdConnected: boolean;
  milOn: boolean;
  storedCodes: string[] | null;      // null = not read
  pendingCodes: string[] | null;     // null = not read
  ltftPct: number | null; stftPct: number | null;
  coolantF: number | null;
  rpm: number | null;                // null/0 = engine not running
  ecuVolts: number | null;           // alternator side, engine running
  unitVolts: number | null;          // battery side
  transTempF: number | null;
  start: StartSample | null;         // from B, the most recent start
}
export function engineHealth(i: HealthInput): { level: HealthLevel; line: string; items: HealthItem[] }
```
Rules (thresholds exported as constants):
- **Stored codes / MIL** → `warn`: "CHECK ENGINE · P0420 · catalyst below threshold"
  (first code's `describeDtc` text is composed by the UI; the lib returns the code).
- **Pending codes** (no MIL) → `watch`: "PENDING FAULT · P0171 · not yet confirmed".
- **Long trim** |LTFT| > 10 → `watch`; > 20 → `warn`. Detail in words:
  positive = "running lean · check for a vacuum leak / dirty airflow sensor",
  negative = "running rich · check injectors / O2 sensor". Short trim alone never
  raises a flag (it swings normally); mention it only in the detail if |STFT| > 15 too.
- **Charging** (rpm > 500 and ecuVolts present): < 13.2 V → `warn` "CHARGING LOW ·
  13.0 V · alternator or belt"; > 15.0 V → `warn` "OVERCHARGING"; else ok
  "CHARGING 14.1 V". Without ecuVolts fall back to unitVolts with the same bands.
- **Battery** (from `start`): resting < 12.2 V → `watch` "BATTERY WEAK · 12.0 V at rest";
  < 11.8 → `warn`; crank dip present and < 9.6 V → `warn` "BATTERY WEAK · dipped to
  9.2 V cranking". Resting ≥ 12.4 → ok "BATTERY 12.6 V".
- **Coolant** ≥ 230 °F → `warn` "RUNNING HOT"; absent → nothing.
- **Trans** ≥ 230 °F → `warn`; 200–229 → `watch` "TRANS WARM"; absent → nothing.
- `line`: the single sentence for the banner — the worst item's label, or
  "ALL NORMAL" when every known item is ok, or "WAITING FOR OBD" when
  `!obdConnected` and nothing else is known (battery/charging from the unit can still be
  known with OBD down — then say e.g. "BATTERY 12.6 V · WAITING FOR OBD").
- `items` sorted worst first; ok items included (the card lists them in the calm colour).

### B. Battery-start sampler — `src/lib/batteryStart.ts` (pure) + `src/data/startsStore.tsx`

Captures what the battery did at each engine start. Best-effort at the unit's ~1.2 s
voltage cadence: resting voltage is reliable; the crank dip is caught only if a sample
lands during the crank, so it's optional.

```ts
export interface StartSample { at: number; restingV: number; crankMinV: number | null }
export interface StartTracker { /* opaque */ }
export const createStartTracker = (): StartTracker => ...
/** feed every telemetry tick; returns a completed sample the moment a start is detected */
export function startStep(t: StartTracker, now: number, unitV: number | null, rpm: number | null): StartSample | null
```
- Keep a 30 s ring of `(at, unitV)`. Engine "not running" = rpm null or < 300.
- Start detected = rpm crosses from not-running to ≥ 400 (OBD up), **or**, with no OBD,
  unitV rising from < 13.0 to ≥ 13.4 and staying there 3 s (alternator came on).
- `restingV` = median of samples from 20 s to 3 s before the start (needs ≥ 3; else
  the start is ignored). `crankMinV` = min sample in the 3 s before the start if it's
  ≥ 0.6 V below resting (a real dip), else null.
- One sample per start (re-arm only after 60 s not-running).
- Store: `startsStore` follows `mpgLogStore.tsx` exactly (fed by
  `useTelemetryListener`, persisted via a new `loadStartsRaw/saveStartsRaw` in both
  `settings.ts` and `settings.web.ts`, key `tacoma-dash:starts`, keep last 20, notify
  ≤ 1 Hz, `useStarts(selector)`). Sim mode: synthetic healthy sample, not persisted.
- Verify: a resting 12.6 V trace with a 9.1 V dip then 14.2 V → sample with both;
  no dip in samples → `crankMinV === null`; fewer than 3 resting samples → null;
  the no-OBD alternator path triggers once; re-arm after 60 s.

### C. Pending codes (Mode 07)

- `ObdManager.readPendingDtcs()` mirrors `readDtcs()` with `'07'` / `[0x47]` /
  `decodeDtcs(raw, 0x47)`; called right after each `readDtcs()` (same wake and
  re-read rules). State `pending: DtcState` + getter `pendingCodes`.
- `obd.pendingCodes: Signal<string[]>` in `types.ts`, wired in `LiveDataSource` like
  `dtcCodes`; sim: empty list normally, SET → SIMULATOR gets a "PENDING CODE" toggle
  that lights `P0171` (lean) so the verdict path can be seen. Re-read after a clear
  (inside the existing exclusive section).
- Verify: a `47 01 01 71` frame decodes to `['P0171']`; `47 00` → `[]`.

### D. The face

Faces stay Home · Drive · Engine · Trail · Night. Rewrite `EngineFace.tsx` to:

```
┌ HEALTH BANNER (x 48 → 1952, h 72) ──────────────────────────────────────────┐
│ ● ALL NORMAL                            BATTERY 12.6 V · CHARGING 14.1 V      │
├──────────────┬──────────────────────────────┬────────────────────────────────┤
│ RPM hero     │ HEALTH card                  │ FUEL card                      │
│ (existing)   │  check-engine (moved card:   │  RANGE 212 mi · 9.4 gal left   │
│              │  lamp, codes, CLEAR)         │  30-day ridgeline              │
│ COOLANT arc  │  pending codes row           │  BEST / WORST                  │
│ (existing)   │  BATTERY / CHARGING cells    │  LAST TRIPS (5)                │
│              │  trim verdict row (words)    │  footer: idle cost             │
│ TRANS tile   │  trans row only if answered  │                                │
│ only if the  ├──────────────────────────────┤                                │
│ probe answers│ SERVICE card (logbook)       │                                │
│              │  up to 5 rows, due/soon first│                                │
│              │  "LOG SERVICE" → logbook     │                                │
└──────────────┴──────────────────────────────┴────────────────────────────────┘
```
- **Banner** (`src/components/engine/HealthBanner.tsx`): a dot in `warn` / accent /
  `textFaint` by level, the `line` in Oxanium 34, and the battery + charging short
  strings on the right. Selector returns the composed strings (quantised to 0.1 V and
  the item ids), `shallowEqual`.
- **Left column:** `RpmCard` + `CoolantCard` unchanged. Below them a `TRANS FLUID` tile
  **rendered only when `obd.transTempF` has ever had a value this session** (keep a
  `useRef` latch); otherwise the column ends after coolant. Delete `LoadThrottleCard`
  and `FuelRateTile`.
- **HEALTH card** (`HealthCard.tsx`): header "ENGINE HEALTH" with the level dot. Body
  from `engineHealth().items`: the check-engine block first (reuse `CheckEngineCard`'s
  internals: lamp, up to 3 codes with `describeDtc`, two-step CLEAR + reasons — delete
  the standalone card afterwards), then a PENDING row ("none pending" in `textFaint` when
  empty and read, "not read" when null), then two cells BATTERY / CHARGING (value +
  one-word verdict GOOD / WEAK / LOW), then the trim verdict row ("FUEL TRIM NORMAL ·
  +2 %" or the lean/rich sentence in `warn`), then TRANS only when present. Every row's
  detail text comes from the lib; the component never composes a diagnosis itself.
- **SERVICE card** (`ServiceCard.tsx`): `useLogbook((lb, now) => serviceStatus(lb, now))`
  mapped to `{ label, dueText, state }`, quantised (round `inMiles` to 10, `inDays` to 1),
  `shallowEqual`. Up to 5 rows, `due` in `warn`, `soon` in accent, `ok` in `textDim`,
  `never` as "not logged" in `textFaint`. Footer `Press` "LOG SERVICE / SET ODOMETER" →
  the existing logbook sheet (the HomeLog tap path).
- **FUEL card** = `MpgCard` reworked: remove the instant / TRIP AVG / LIFETIME stat row
  (HOME has them). Top line becomes **RANGE**: `rangeMiles(fuelLeft(lb).gallons, mpg)`
  with `mpg` = mean of the last 3 `pumpMpgs` if any, else `lifetimeMpg(log)`; caption
  "9.4 GAL LEFT · GAUGE" when the meter probe answers (`obd.fuelLevelPct` live), else
  "· ESTIMATE SINCE <date> FILL", else "TAP FILLED UP ON HOME" when no fill logged. Keep
  ridgeline, BEST / WORST, LAST TRIPS. Footer caption while stopped with the engine
  running (speed < 1, rpm > 500): "IDLING · 0.31 gal/h · $1.40/hr" using
  `obd.fuelRateGph` × `lastPrice(lb)` (omit the $ part without a price). Quantise gph to
  0.01 and only re-render when the shown string changes.
- **0–60** moves to DRIVE's `TelemetryStrip` as one more cell ("0–60 · 9.4 s · LAST RUN",
  "—" before a run). Delete `PerfTiles.tsx` (EST HP / TORQUE are dropped; keep the
  `estHp` / `estTorqueLbFt` signals in the data layer).
- Delete `EngineGrid.tsx`; remove `PctBar` / `TrimBar` from `parts.tsx` if nothing else
  imports them (grep first). `TRIM_WARN` moves to `engineHealth.ts`.
- Absent state (sim OBD OFF, no fills, no starts): banner "WAITING FOR OBD", HEALTH card
  shows BATTERY from the unit if present and "—" cells otherwise, SERVICE shows "not
  logged" rows with the LOG SERVICE button, FUEL shows the ridgeline (sim) / "no scored
  days yet" (live) and "TAP FILLED UP ON HOME". Nothing may look broken.

### E. Docs

- `CLAUDE.md` → replace the ENGINE face bullet's layout description with v2 (banner,
  HEALTH, SERVICE, FUEL/RANGE; 0–60 on DRIVE; trims/MAF/baro/load are data-only now).
  Add `engineHealth` / `batteryStart` / `startsStore` to the perf-model note ("slow
  derived state in its own store").
- `docs/DEVICE-MICRONTEK.md` → OBD section: Mode 07 untested on the truck; the unit's
  1.2 s battery cadence is why the crank dip is best-effort.

## Verification bar

- `npx tsc --noEmit` clean; `npm run verify` green with the new `engineHealth`,
  `batteryStart`, and Mode 07 checks (list the count before/after in the commit body).
- Perf greps return nothing new: no `useDashboard`, no `setInterval` /
  `requestAnimationFrame` in `src/components/engine/**`; every exported component is
  `React.memo`; object selectors use `shallowEqual`.
- `npm run web` at 2000×1200, LIGHT + DARK, saved to
  `docs/device/engine-face-v2-{light,dark}.png`; plus `engine-face-v2-nodata.png` with
  sim OBD OFF. Open the ENGINE face in the browser and confirm the banner text changes
  when SIM → PENDING CODE is toggled.
- `grep -rn "EngineGrid\|PerfTiles\|LoadThrottleCard\|FuelRateTile" src` → no hits.

## Commit

One commit: `ENGINE face v2: health verdicts in words, battery-at-start, pending codes,
service card, range; trims/MAF/load off the page`. Do not push.
