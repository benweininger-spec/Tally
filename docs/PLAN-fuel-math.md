# Fuel-math corrections — build spec

Branch: `old-launcher`. Reviewer installs; **do not build an APK or touch the device.**
Follow `CLAUDE.md` (perf model, pure-lib conventions, hard constraints) exactly.

Context: a math audit (2026-10-28) of the whole fuel chain — MAF → gallons
(`src/lib/derive.ts`), the live integrator (`src/data/live/LiveDataSource.ts`), the
long-term log (`src/lib/mpgLog.ts` + `src/data/mpgLogStore.tsx`), the tank-level filter
(`src/lib/fuelFilter.ts`) and the logbook (`src/lib/logbook.ts`) — found every formula
correct as written, plus four systematic biases. Fix the four. Nothing else in these
files should change behaviour.

## Ground truth (verified in the tree — don't re-derive)

- `src/lib/derive.ts`: `MPG_MAF_CONSTANT = 11.428`, `instantMpg(maf, mph, k)`,
  `gallonsPerHour(maf, k)`, `accumFuel(s, maf, mph, dtHours, milesOverride?)`,
  `avgMpg(s)`. Pure, no imports; checked in `scripts/verify.ts` ("instant MPG: k·mph/MAF
  (11.428,60)->60", "GPH = MAF/k = 1 gal/hr", "avg MPG integrates to 60").
- `LiveDataSource.ts` ~L275–295: per tick, `dtMs = min(2000, now − lastFuelAt)`; if OBD is
  connected and the MAF reading is < 3 s old, `accumFuel(this.fuel, maf, speedMph,
  dtMs/3.6e6, dMiles)` where `dMiles = speed ≥ 1 && !gpsJustRestored ?
  max(0, loc.distanceMi − prevDistanceMi) : 0`. `speedMph` = GPS speed, else OBD
  PID 0D via `kmhToMph`. FAST group = `[RPM, SPEED, THROTTLE, MAF, ENGINE_LOAD]`
  (`ObdManager.ts` L41) — throttle and rpm are always fresh when MAF is.
- `LiveDataSource.ts` ~L447–460: `fuelLevelPct` feeds `addFuelSample(this.fuelFilter,
  { at, litres, level: isLevel(pitchDeg, rollDeg, longG), stopped })`. The sensor
  snapshot (`src/data/live/sensorProvider.ts`) also carries `latG: number | null`.
- `src/data/live/locationProvider.ts` ~L134–140: distance only advances when
  `moving && dt > 0 && dt < 10` between consecutive fixes. A GPS gap > 10 s therefore
  adds **no** miles, and `mpgLogStore.onTick` additionally drops any single-tick jump
  ≥ 1 mi (`MAX_TICK_MILES`). `loc.gpsFix` is derived from fix recency.
- `src/lib/fuelFilter.ts`: `isLevel(pitchDeg, rollDeg, longG)`, `LEVEL_TILT_DEG = 4`,
  `LEVEL_ACCEL_G = 0.08`; tests at `scripts/verify.ts` ~L843–860.
- `src/lib/logbook.ts`: `calib` = median(pumped ÷ measured) over the last 3 full→full
  fills (`CALIB_RANGE [0.6, 1.6]`, `MIN_CALIB_GAL = 3`). Applied to `usedSinceFill`
  (`usedCorrected`) and to `spending().mpg`; **never** applied to the MPG log.
- MPG display sites: `src/components/engine/MpgCard.tsx`, `src/components/HomeGlance.tsx`,
  `src/components/HomeLog.tsx` (all via `useMpgLog` + `lifetimeMpg` / `tripMpg` /
  `last30`). They must not change.
- Sim: `SimulatedDataSource.ts` L292 publishes its own synthetic `fuelGallons`; the sim's
  30-day log is `syntheticLog()` (mpg drawn directly, not via k). Nothing in the sim
  depends on `MPG_MAF_CONSTANT` except its instant-mpg readout — a 4 % shift there is
  fine and expected.

## Deliverables

### 1. E10 fuel constant (every MPG is ~4 % optimistic today)

US pump gas is E10: stoichiometric AFR 14.08, density ≈ 6.20 lb/gal.
gal/hr = MAF·3600 / (14.08 · 6.20 · 453.592) = MAF · 0.09091 → **k = 11.00**.

- In `derive.ts` set `MPG_MAF_CONSTANT = 11.0` and rewrite the derivation comment for
  E10 (keep the warning about the bogus "710.7" constant; note the E0 value 11.428 for
  anyone running ethanol-free). Keep `k` as an optional parameter.
- Update the verify checks to the new constant: `instantMpg(11.0, 60) ≈ 60`,
  `gallonsPerHour(11.0) ≈ 1`, and the `accumFuel` 60-mph/1-hr case. Add one check that
  pins the derivation: `approx(MPG_MAF_CONSTANT, 1 / (3600 / (14.08 * 6.20 * 453.592)), 0.01)`.
- Do **not** apply the logbook `calib` to the MPG log or faces — the pump calibration
  stays the logbook's own correction (it also absorbs MAF sensor error and WOT
  enrichment). Mention in the `CLAUDE.md` voltage/headlights-style facts list that the
  constant assumes E10 and that pump calibration lives only in the logbook.

### 2. Deceleration fuel cut

With the throttle closed above idle while rolling, the 2TR-FE's ECU cuts the injectors
but MAF still reads airflow, so the integrator charges fuel that was never burned.

- Add to `derive.ts` (pure, exported, tested):
  ```ts
  export const DFCO_THROTTLE_PCT = 1.5; // closed pedal, with sensor offset
  export const DFCO_MIN_RPM = 1200;     // ECU resumes injection near idle
  export const DFCO_MIN_MPH = 8;        // rolling, not a stall / creep
  /** true when the ECU is (almost certainly) in deceleration fuel cut-off */
  export function isFuelCut(throttlePct: number | null, rpm: number | null, speedMph: number): boolean
  ```
  Returns false whenever throttle or rpm is null (never guess a cut without data).
- `accumFuel` gains an optional `fuelCut = false` argument: when true, add the miles but
  **zero gallons** for that step (do not touch `gph` elsewhere).
- `LiveDataSource` passes `isFuelCut(throttle, rpm, speedMph)` using the FAST-group
  readings (`this.obd.read(PIDS.THROTTLE)`, `PIDS.RPM`), each required to be < 3 s old
  like the MAF read; otherwise `false`.
- Instant MPG during a cut: leave `instantMpg` as is (it already caps at 99 in the
  source and reads as "coasting"), but `fuelRateGph` should publish 0 while
  `isFuelCut` is true, so the ENGINE/HOME fuel-rate readout agrees with the integrator.
- Verify: `isFuelCut(0, 1800, 35) === true`, `isFuelCut(0, 900, 35) === false` (idle
  rpm), `isFuelCut(12, 2500, 35) === false` (pedal down), `isFuelCut(0, 1800, 3) === false`
  (creeping), `isFuelCut(null, 1800, 35) === false`; and an `accumFuel(…, true)` step adds
  miles but not gallons.

### 3. Miles through GPS gaps

Today a tunnel / garage / cold-start without a fix adds fuel but no miles, dragging the
day's MPG down.

- In `LiveDataSource`, when `!loc.gpsFix` (or the GPS distance didn't advance this tick
  while GPS speed is unavailable) and the OBD speed reading is < 3 s old, use
  `dMiles = kmhToMph(obdSpeed) * dtHours` (same `dtMs`, same ≥ 1 mph gate). Keep the
  existing GPS path untouched when a fix is present, and keep the `gpsJustRestored` skip
  (the first GPS delta after a gap spans the whole gap, and OBD already counted it).
- Put the decision in a pure helper so it's testable:
  ```ts
  // src/lib/derive.ts
  /** miles for one integration step: GPS delta when fixed, else OBD speed × dt, else 0 */
  export function stepMiles(args: { gpsFix: boolean; gpsJustRestored: boolean; gpsDeltaMi: number;
                                    obdSpeedMph: number | null; speedMph: number; dtHours: number }): number
  ```
- The MPG log (`mpgLogStore.onTick`) diffs `trip.distanceMi`, which is GPS-only. So that
  the log and the logbook odometer see the same miles, `trip.distanceMi` in the live
  snapshot must include the OBD-bridged miles: keep a `bridgedMi` accumulator in
  `LiveDataSource`, add it to `loc.distanceMi` when publishing `trip.distanceMi`,
  `trip.avgSpeedMph` can stay GPS-based. Reset it in `resetTrip()` alongside
  `this.fuel`. Document the one-line reason in `types.ts` on `TripData.distanceMi`.
- Verify `stepMiles`: fixed GPS → GPS delta; no fix + OBD 30 mph for 0.001 h → 0.03 mi;
  no fix + no OBD → 0; `gpsJustRestored` → 0 even with a GPS delta; speed < 1 → 0.

### 4. Lateral g in the tank-level gate

- `isLevel(pitchDeg, rollDeg, longG, latG = null)` — a sustained corner sloshes the
  float like a grade. Apply the same `LEVEL_ACCEL_G` to `|latG|`; null = ignored (as
  `longG` is today).
- `LiveDataSource` passes `sens.latG` (null when sensors are offline, like the others).
- Verify: `isLevel(0, 0, 0, 0.2) === false`, `isLevel(0, 0, 0, 0.03) === true`,
  `isLevel(0, 0, 0, null) === true`.

## Verification bar (all must be green before committing)

- `npx tsc --noEmit` clean; `npm run verify` all checks pass, including the new ones.
- `npm run web`: the sim's ENGINE face and HOME glances still render (instant mpg shifts
  ~4 % lower in sim — expected). No change to any component file.
- `grep -rn "11.428" src scripts docs` → only the historical E0 note in `derive.ts`.
- `CLAUDE.md` "Current state → ENGINE face" bullet: one added line naming the four
  corrections (E10 constant, DFCO gate, OBD-bridged miles, lateral-g level gate).
  `docs/DEVICE-MICRONTEK.md` → OBD section: add the FACT that these are **untested on the
  truck** and what to compare (first full-to-full pump fill vs the logbook's `calib`
  should now sit near 1.0; before this change it was expected near 1.04).

## Commit

One commit, message starting `fuel math: E10 constant, DFCO gate, OBD-bridged miles,
lateral-g level gate`. Include the verify counts (before/after) in the body. Do not push.
