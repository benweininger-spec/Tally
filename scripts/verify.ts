/**
 * Logic checks for the parts with real risk: the signature geometry and the
 * simulator. No native deps — runs under `node --experimental-strip-types`.
 *   npm run verify
 */
import {
  arcPath,
  buildTrace,
  buildWaveform,
  gaugeProgress,
  gaugeRedline,
  gaugeTicks,
  gaugeTrack,
  clamp,
  mapRange,
  polar,
} from '../src/lib/pulse.ts';
import { SimulatedDataSource } from '../src/data/SimulatedDataSource.ts';
import {
  mpsToMph,
  kmhToMph,
  metersToFeet,
  metersToMiles,
  celsiusToFahrenheit,
  mps2ToG,
  normalizeDeg,
  haversineMeters,
} from '../src/lib/units.ts';
import {
  estimateGravity,
  buildCalibration,
  identityCalibration,
  initImuState,
  processSample,
  toDeg,
  lpAlpha,
} from '../src/lib/imu.ts';
import {
  pidCommand,
  cleanLine,
  classifyLine,
  decodePidResponse,
  decodeMonitorStatus,
  decodeDtcs,
  decodeSupportMask,
  AT_INIT,
  PIDS,
  TRANS_TEMP_PROBES,
  FUEL_LEVEL_PROBES,
  decodeProbe,
  isClearAck,
  parseResponse,
  responseMessages,
} from '../src/lib/elm327.ts';
import { describeDtc, DTC_DESCRIPTION_COUNT } from '../src/lib/dtcDescriptions.ts';
import {
  COOLANT_HOT_F,
  COOLANT_WARM_F,
  ECO_MPG,
  MPG_BAR_MAX,
  coolantState,
  ecoLevel,
  emaStep,
  POOR_MPG,
  warmupStage,
  inEcoZone,
  mpgBarFrac,
  warmupFrac,
} from '../src/lib/engineGlance.ts';
import { hexPid, pidHealth, summarizeHealth, type PidStat } from '../src/lib/obdDiag.ts';
import {
  TANK_GAL,
  addFill,
  addService,
  dueText,
  emptyLogbook,
  fuelLeft,
  nextDue,
  normalizeLogbook,
  odometerNow,
  onUsage,
  pumpMpgs,
  rangeMiles,
  serviceStatus,
  setOdometer,
  spending,
  fillCost,
} from '../src/lib/logbook.ts';
import { GEAR_RATIOS, K_NOMINAL, REVERSE_TO_PARK_MS, STOP_PROMPT_MS, createGearState, gearStep, matchGear, summaryPromptDue } from '../src/lib/gear.ts';
import {
  OBD_RETRY_SLOW_AFTER_MS,
  OBD_RETRY_SLOW_MS,
  OBD_RETRY_STEADY_MS,
  OBD_RETRY_STEPS_MS,
  obdRetryDelayMs,
  pickObdAdapter,
  rankObdDevices,
} from '../src/lib/obdLink.ts';
import {
  addDelta,
  bestWorstDay,
  dateKey,
  emptyLog,
  last30,
  lifetimeMpg,
  MAX_DAYS,
  mpgOf,
  normalizeLog,
  runs,
  syntheticLog,
  tripEnd,
  tripTick,
  ecoShare,
  tripMpg,
  tripStart,
  tripUpdate,
} from '../src/lib/mpgLog.ts';
import {
  instantMpg,
  gallonsPerHour,
  avgMpg,
  initFuelAccum,
  accumFuel,
  estHp,
  estTorqueLbFt,
  initZeroSixty,
  zeroSixtyStep,
  gradePct,
  ALT_SAMPLE_MI,
  ALT_SLOTS,
} from '../src/lib/derive.ts';
import {
  bootSweep,
  connectSweep,
  BOOT_UP_MS,
  BOOT_LIVE_BY_MS,
  BOOT_MS,
  BOOT_PEAK_MPH,
  CONNECT_MS,
} from '../src/lib/sweep.ts';
import {
  ENV_BINS,
  TRAIL_BANDS,
  envelopeBin,
  envelopePeak,
  gscopeFrame,
  gscopeGrid,
  trailLife,
  updateEnvelope,
} from '../src/lib/gscope.ts';
import {
  RECORD_SLOTS,
  RECORD_DT,
  recordFrame,
  recordGrid,
  recordSpokes,
  speedRadius,
} from '../src/lib/speedRecord.ts';
import { makeProjector, meshFrame, tiltTransform, truckToWorld, GRID_ALPHAS } from '../src/lib/mesh.ts';
import { TACOMA_ACCESS_CAB } from '../src/lib/tacoma.ts';
import { createDriveRecorder, readRecord, recordTick, resetEnvelope, RECORDER_SLOTS, TRAIL_LIFE_S } from '../src/lib/driveRecorder.ts';
import {
  amberDay,
  amberNight,
  amberNightDim,
  composite,
  contrastRatio,
  DAY_CONTRAST_TARGETS,
  dimTheme,
  formatColor,
  lerpTheme,
  parseColor,
  relLuminance,
} from '../src/theme/themes.ts';

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    failures++;
    console.error('  ✗ ' + msg);
  } else {
    console.log('  ✓ ' + msg);
  }
};
const finite = (...xs: number[]) => xs.every((x) => Number.isFinite(x));
const noNaNStr = (s: string) => s.length > 0 && !/NaN|undefined/.test(s);

console.log('\nGEOMETRY (src/lib/pulse.ts)');
{
  ok(clamp(5, 0, 1) === 1 && clamp(-5, 0, 1) === 0, 'clamp bounds');
  ok(mapRange(0.5, 0, 1, 0, 100) === 50, 'mapRange midpoint');
  const p = polar(100, 100, 50, 0);
  ok(Math.abs(p.x - 150) < 1e-6 && Math.abs(p.y - 100) < 1e-6, 'polar 0° = 3 o’clock');

  ok(noNaNStr(gaugeTrack(360, 360, 300)), 'gauge track path well-formed');
  ok(noNaNStr(arcPath(360, 360, 300, 135, 405)), 'arc path well-formed');

  const ticks = gaugeTicks({ cx: 360, cy: 360, rOuter: 300, minorLen: 10, majorLen: 22, count: 55, majorEvery: 5 });
  ok(ticks.length === 56, `tick count = ${ticks.length} (expected 56)`);
  ok(ticks.every((t) => finite(t.x1, t.y1, t.x2, t.y2)), 'all ticks finite');
  ok(ticks[0].major && ticks[5].major && !ticks[1].major, 'major-every-5 cadence');

  ok(gaugeProgress(360, 360, 300, 0) === null, 'zero progress returns null (valid SVG)');
  ok(noNaNStr(gaugeProgress(360, 360, 300, 0.5) ?? ''), 'half progress well-formed');
  ok(noNaNStr(gaugeProgress(360, 360, 300, 1) ?? ''), 'full progress well-formed');
  ok(noNaNStr(gaugeRedline(360, 360, 300, 4700 / 5500)), 'redline arc well-formed');

  const samples = Array.from({ length: 240 }, (_, i) => Math.sin(i / 9) * 0.4);
  const w = buildWaveform({ samples, x: 50, y: 100, width: 600, height: 160, range: 0.55 });
  ok(noNaNStr(w.line) && w.line.startsWith('M'), 'waveform line path well-formed');
  ok(noNaNStr(w.fill) && w.fill.endsWith('Z'), 'waveform fill closed');
  ok(finite(w.head.x, w.head.y), 'waveform head finite');
  ok(w.baseline === 180, `baseline centered (${w.baseline})`);
  const empty = buildWaveform({ samples: [], x: 0, y: 0, width: 10, height: 10, range: 1 });
  ok(noNaNStr(empty.line), 'empty waveform degrades gracefully');
  // out-of-range samples must be clamped inside the band
  const hot = buildWaveform({ samples: [10, -10], x: 0, y: 0, width: 100, height: 100, range: 0.5 });
  ok(!/-?\d{4,}/.test(hot.line), 'extreme samples clamped to band');
}

console.log('\nSIMULATOR — OBD connected (src/data/SimulatedDataSource.ts)');
{
  const sim = new SimulatedDataSource({ obdConnected: true, seed: 42 });
  let last = sim.getSnapshot();
  for (let i = 0; i < 5000; i++) last = sim.tick();

  const m = last.motion;
  ok(m.speedMph.value! >= 0 && m.speedMph.value! <= 80, `speed in [0,80]: ${m.speedMph.value}`);
  ok(m.headingDeg.value! >= 0 && m.headingDeg.value! < 360, `heading in [0,360): ${m.headingDeg.value}`);
  ok(Math.abs(m.longG.value!) <= 1.0, `|longG| <= 1.0: ${m.longG.value}`);
  ok(Math.abs(m.latG.value!) <= 1.0, `|latG| <= 1.0: ${m.latG.value}`);
  ok(m.pitchDeg.value! >= -16 && m.pitchDeg.value! <= 18, `pitch in range: ${m.pitchDeg.value}`);
  ok(last.system.voltage.value! >= 12 && last.system.voltage.value! <= 14.8, `voltage in range: ${last.system.voltage.value}`);
  ok(last.obd.rpm.status === 'live' && last.obd.rpm.value! >= 700 && last.obd.rpm.value! <= 5200, `rpm live & in band: ${last.obd.rpm.value}`);
  ok(last.obd.coolantTempF.status === 'live', 'coolant present when OBD connected');

  const hist = sim.getHistory();
  ok(hist.longG.length === 240 && hist.speed.length === 240, `history fixed length (${hist.longG.length})`);
  ok(hist.longG.every(Number.isFinite) && hist.speed.every(Number.isFinite), 'history all finite');

  // scan every numeric signal for NaN across a fresh run
  let nan = 0;
  const s2 = new SimulatedDataSource({ obdConnected: true, seed: 7 });
  for (let i = 0; i < 1000; i++) {
    const snap = s2.tick();
    const probe = [
      snap.motion.speedMph.value, snap.motion.longG.value, snap.motion.latG.value,
      snap.trip.distanceMi.value, snap.system.voltage.value, snap.obd.rpm.value,
      snap.obd.instantMpg.value, snap.obd.estHp.value,
    ];
    if (probe.some((v) => v !== null && !Number.isFinite(v))) nan++;
  }
  ok(nan === 0, `no NaN across 1000 frames (${nan} bad)`);
}

console.log('\nSIMULATOR — OBD absent (day-one reality)');
{
  const sim = new SimulatedDataSource({ obdConnected: false, seed: 99 });
  let last = sim.getSnapshot();
  for (let i = 0; i < 500; i++) last = sim.tick();
  ok(last.obd.connected === false, 'obd.connected = false');
  ok(last.obd.rpm.status === 'absent' && last.obd.rpm.value === null, 'rpm absent (null) without dongle');
  ok(last.obd.coolantTempF.status === 'absent', 'coolant absent without dongle');
  ok(last.motion.speedMph.status === 'live', 'Tier-A speed still live without dongle');
  ok(last.trip.distanceMi.status === 'live', 'Tier-A trip still live without dongle');
  ok(last.system.voltage.status === 'live', 'voltage still live (self-measured, not CAN)');
}

const approx = (a: number | null, b: number, eps = 1e-2) =>
  a !== null && Number.isFinite(a) && Math.abs(a - b) <= eps;

console.log('\nUNITS (src/lib/units.ts)');
{
  ok(mpsToMph(0) === 0, 'mps 0 -> 0 mph');
  ok(approx(mpsToMph(10), 22.3694, 1e-3), 'm/s -> mph');
  ok(mpsToMph(-5) === 0, 'negative speed clamps to 0');
  ok(approx(kmhToMph(100), 62.1371, 1e-3), 'km/h -> mph');
  ok(approx(metersToFeet(100), 328.084, 1e-2), 'm -> ft');
  ok(approx(metersToMiles(1609.344), 1, 1e-6), 'm -> mi');
  ok(
    celsiusToFahrenheit(100) === 212 && celsiusToFahrenheit(0) === 32 && celsiusToFahrenheit(-40) === -40,
    '°C -> °F (212/32/-40)'
  );
  ok(approx(mps2ToG(9.80665), 1, 1e-9), 'm/s² -> g');
  ok(normalizeDeg(370) === 10 && normalizeDeg(-10) === 350, 'normalizeDeg wraps to [0,360)');
  ok(approx(haversineMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }), 111194.9, 5), 'haversine 1° lon ≈ 111.2km');
  ok(haversineMeters({ lat: 5, lon: 5 }, { lat: 5, lon: 5 }) === 0, 'haversine identical points = 0');
}

console.log('\nIMU (src/lib/imu.ts)');
{
  const g = estimateGravity([
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
  ]);
  ok(approx(g[2], 1) && approx(g[0], 0) && approx(g[1], 0), 'estimateGravity averages to [0,0,1]');

  const cal = buildCalibration([0, 0, 1], [0, 1, 0]);
  const rowNorm = (r: readonly number[]) => Math.hypot(r[0], r[1], r[2]);
  ok(
    approx(rowNorm(cal.R[0]), 1, 1e-6) && approx(rowNorm(cal.R[1]), 1, 1e-6) && approx(rowNorm(cal.R[2]), 1, 1e-6),
    'calibration rotation rows are unit length'
  );

  // a sustained forward accel must read as +longitudinal, ~0 lateral
  let st = initImuState([0, 0, 1]);
  let out = processSample(st, cal, [0, 0.3, 1], 0.02).out;
  for (let i = 0; i < 15; i++) {
    const r = processSample(st, cal, [0, 0.3, 1], 0.02);
    st = r.state;
    out = r.out;
  }
  ok(out.longitudinal > 0.05, `forward accel => +longG (${out.longitudinal.toFixed(3)})`);
  ok(Math.abs(out.lateral) < 0.05, `forward accel => ~0 latG (${out.lateral.toFixed(3)})`);

  // level + identity calibration => pitch/roll ≈ 0
  let s2 = initImuState([0, 0, 1]);
  let o2 = processSample(s2, identityCalibration(), [0, 0, 1], 0.02).out;
  for (let i = 0; i < 10; i++) {
    const r = processSample(s2, identityCalibration(), [0, 0, 1], 0.02);
    s2 = r.state;
    o2 = r.out;
  }
  ok(Math.abs(toDeg(o2.pitch)) < 1 && Math.abs(toDeg(o2.roll)) < 1, 'level => pitch/roll ≈ 0°');
  ok(lpAlpha(1.6, 0.02) > 0 && lpAlpha(1.6, 0.02) < 1, 'lpAlpha in (0,1)');
}

console.log('\nELM327 PARSER (src/lib/elm327.ts)');
{
  ok(pidCommand(0x0c) === '010C', 'pidCommand(0x0C) = "010C"');
  ok(cleanLine('41 0C 1A F8\r>') === '410C1AF8', 'cleanLine strips spaces/CR/prompt');
  ok(classifyLine('NO DATA') === 'no-data', 'classify NO DATA');
  ok(classifyLine('SEARCHING...') === 'searching', 'classify SEARCHING');
  ok(classifyLine('41 0C 1A F8') === 'data', 'classify a data line');
  ok(classifyLine('?') === 'error', 'classify "?" as error');
  ok(AT_INIT[0] === 'ATZ' && AT_INIT.includes('ATE0'), 'AT init starts ATZ + echo-off');

  ok(decodePidResponse(PIDS.RPM, '41 0C 1A F8') === 1726, 'RPM = (256A+B)/4 = 1726');
  ok(decodePidResponse(PIDS.SPEED, '41 0D 45') === 69, 'speed = A = 69 km/h');
  ok(decodePidResponse(PIDS.COOLANT_TEMP, '41 05 7B') === 83, 'coolant = A-40 = 83 °C');
  ok(approx(decodePidResponse(PIDS.CTRL_VOLTAGE, '41 42 39 D4'), 14.804, 1e-3), 'ctrl voltage = (256A+B)/1000');
  ok(approx(decodePidResponse(PIDS.THROTTLE, '41 11 99'), 60, 1e-6), 'throttle = A/2.55 = 60%');
  ok(decodePidResponse(PIDS.RPM, 'SEARCHING...\r41 0C 1A F8\r>') === 1726, 'ignores SEARCHING line');
  ok(decodePidResponse(PIDS.RPM, '410C1AF8') === 1726, 'packed (no-space) frame decodes');
  ok(decodePidResponse(PIDS.RPM, 'NO DATA') === null, 'NO DATA -> null');
  ok(decodePidResponse(PIDS.RPM, '41 0C 1A') === null, 'short frame -> null');
  ok(decodePidResponse(PIDS.RPM, '\r\r41 0C 1A F8\r>') === 1726, 'tolerates blank lines + trailing prompt');

  const ms = decodeMonitorStatus('41 01 81 07 65 04');
  ok(ms !== null && ms.milOn === true && ms.dtcCount === 1, 'monitor status: MIL on, 1 DTC');

  const codes = decodeDtcs('43 01 33 00 00');
  ok(codes.length === 1 && codes[0] === 'P0133', `DTC decode -> P0133 (${codes.join(',')})`);

  const sup = decodeSupportMask('41 00 80 00 00 00', 0x00);
  ok(sup.length === 1 && sup[0] === 0x01, 'support mask bit31 -> PID 0x01');
}

console.log('\nENGINE DATA — trims, trouble codes, ATF probe (src/lib/elm327.ts, dtcDescriptions.ts)');
{
  ok(decodePidResponse(PIDS.STFT_B1, '41 06 80') === 0, 'STFT 0x80 = 0 %');
  ok(approx(decodePidResponse(PIDS.STFT_B1, '41 06 8A'), 7.8125, 1e-9), 'STFT 0x8A = +7.8 % (adding fuel)');
  ok(approx(decodePidResponse(PIDS.LTFT_B1, '41 07 70'), -12.5, 1e-9), 'LTFT 0x70 = −12.5 % (pulling fuel)');
  ok(decodePidResponse(PIDS.LTFT_B1, '41 07 00') === -100 && approx(decodePidResponse(PIDS.LTFT_B1, '41 07 FF'), 99.21875, 1e-9), 'trim range −100 … +99.2 %');

  ok(decodeDtcs('43 01 33 00 00 00 00').join() === 'P0133', 'legacy Mode 03: padding 0000 skipped');
  ok(decodeDtcs('43 01 01 33').join() === 'P0133', 'CAN Mode 03: count byte first (43 01 01 33 = P0133, not P0101)');
  ok(decodeDtcs('43 00').length === 0, 'CAN Mode 03: zero codes');
  ok(decodeDtcs('43 02 04 20 01 71').join() === 'P0420,P0171', 'CAN Mode 03: two codes');
  const multi = '00A\r0: 43 04 01 33 04 20\r1: 01 71 03 00 55 55 55\r\r>';
  ok(decodeDtcs(multi).join() === 'P0133,P0420,P0171,P0300', `ISO-TP multi-frame reassembled + padding trimmed (${decodeDtcs(multi).join()})`);
  ok(decodeDtcs('43 01 04 20\r43 01 07 41\r').join() === 'P0420,P0741', 'two ECUs (engine + trans) each answer');
  ok(decodeDtcs('43 01 C1 23 00 00 00 00').join() === 'U0123' && decodeDtcs('43 01 81 23').join() === 'B0123', 'letter bits: C/B/U families');
  ok(decodeDtcs('NO DATA').length === 0 && decodeDtcs('SEARCHING...\rSTOPPED').length === 0, 'NO DATA / STOPPED → no codes, no crash');
  ok(responseMessages('00A\r0: 43 04 01 33 04 20\r1: 01 71 03 00 55 55 55').length === 1, 'multi-frame = one message');
  ok(isClearAck('44') && isClearAck('44\r\r>') && !isClearAck('7F 04 22') && !isClearAck('NO DATA'), 'Mode 04 ack (44) vs refusal (7F 04 22)');
  ok(parseResponse('61 82 6E 00', [0x61, 0x82])?.[0] === 0x6e, 'generic prefix parser (Mode 21)');

  const p0 = TRANS_TEMP_PROBES[0];
  ok(decodeProbe(p0, '61 82 82 00') === 90, 'ATF probe: A − 40 °C (0x82 → 90 °C)');
  ok(decodeProbe(p0, '61 82 FF') === null, 'ATF probe rejects implausible values (215 °C)');
  ok(decodeProbe(p0, 'NO DATA') === null && decodeProbe(p0, '7F 21 11') === null, 'ATF probe: no answer / not supported → null');

  ok(describeDtc('P0420') === 'Catalyst efficiency below threshold (bank 1)', 'describeDtc exact (P0420)');
  ok(describeDtc('p0171').startsWith('System too lean'), 'describeDtc is case-insensitive');
  ok(describeDtc('P0399').startsWith('Ignition system or misfire'), 'describeDtc family fallback (P03xx)');
  ok(describeDtc('P1999').startsWith('Manufacturer-specific') && describeDtc('U0999').startsWith('Network'), 'describeDtc: P1 / U families');
  ok(describeDtc('XYZ') === 'Unrecognised code', 'describeDtc rejects garbage');
  ok(DTC_DESCRIPTION_COUNT >= 60, `≥ 60 described codes (${DTC_DESCRIPTION_COUNT})`);
}

console.log('\nLONG-TERM MPG (src/lib/mpgLog.ts)');
{
  ok(mpgOf(0, 0) === null && mpgOf(10, 0) === null && mpgOf(0.2, 0.01) === null, 'mpgOf never divides by zero / scores < 0.5 mi');
  ok(approx(mpgOf(20, 1), 20, 1e-12), 'mpgOf = miles / gallons');
  const log = emptyLog();
  addDelta(log, '2026-10-20', 10, 0.5, true);
  addDelta(log, '2026-10-20', 5, 0, false); // OBD off: miles stored, not scored
  addDelta(log, '2026-10-21', 30, 2, true); // 15 mpg
  addDelta(log, '2026-10-19', 2, 0, false); // out-of-order day lands in order
  ok(log.days.map((d) => d.date).join() === '2026-10-19,2026-10-20,2026-10-21', 'day buckets merge + stay sorted');
  ok(log.days[1].miles === 15 && log.days[1].fuelMiles === 10, 'miles without fuel are stored but not scored');
  ok(approx(lifetimeMpg(log), 40 / 2.5, 1e-9), `lifetime = scored miles / gallons (${lifetimeMpg(log)})`);
  ok(lifetimeMpg(emptyLog()) === null, 'lifetime null with no fuel');
  const bw = bestWorstDay(log);
  ok(bw.best?.date === '2026-10-20' && bw.worst?.date === '2026-10-21' && bw.best!.mpg === 20 && bw.worst!.mpg === 15, 'best / worst day');
  const today = new Date(2026, 9, 21, 12).getTime();
  const l30 = last30(log, today);
  ok(l30.length === 30 && l30[29].date === '2026-10-21' && l30[0].date === '2026-09-22', 'last30 spans 30 calendar days ending today');
  ok(approx(l30[29].mpg, 15, 1e-9) && approx(l30[28].mpg, 20, 1e-9) && l30[27].mpg === null, 'last30: mpg per day, null for no-fuel days');
  ok(dateKey(new Date(2026, 0, 5, 23, 59).getTime()) === '2026-01-05', 'dateKey is local YYYY-MM-DD');
  ok(runs([null, 1, 2, null, null, 3, null, 4]).join('|') === '1,2|5,5|7,7', 'ridgeline runs gap on nulls');

  tripStart(log, 1000);
  tripUpdate(log, 12, 0.6, true);
  tripUpdate(log, 3, 0, false);
  tripEnd(log, 5000);
  ok(log.trips.length === 1 && log.current === null && approx(tripMpg(log.trips[0]), 20, 1e-9), 'trip start / update / end + trip mpg');
  tripStart(log, 6000);
  tripUpdate(log, 0.05, 0, false);
  tripEnd(log, 7000);
  ok(log.trips.length === 1, 'driveway-length trips are discarded');

  const big = emptyLog();
  for (let i = 0; i < MAX_DAYS + 20; i++) addDelta(big, dateKey(new Date(2025, 0, 1 + i).getTime()), 1, 0.05, true);
  ok(big.days.length === MAX_DAYS && big.days[0].date === dateKey(new Date(2025, 0, 21).getTime()), `capped at ${MAX_DAYS} days (oldest dropped)`);
  const round = normalizeLog(JSON.parse(JSON.stringify(log)));
  ok(round.days.length === 3 && round.trips.length === 1, 'persist round-trip');
  ok(normalizeLog({ days: [{ date: 'bad' }, { date: '2026-01-01', miles: -5, gallons: NaN }] }).days[0].miles === 0, 'normalizeLog drops / sanitises junk');
  const syn = syntheticLog(today);
  ok(last30(syn, today).filter((d) => d.mpg != null).length >= 15 && syn.trips.length === 5, 'sim preview log fills the 30-day ridgeline');
}

console.log('\nDERIVED METRICS (src/lib/derive.ts)');
{
  ok(approx(instantMpg(11.428, 60), 60, 1e-2), 'instant MPG: k·mph/MAF (11.428,60)->60');
  ok(instantMpg(11.428, 0) === null, 'instant MPG null at idle (speed 0)');
  ok(instantMpg(0, 60) === null, 'instant MPG null with no MAF');
  ok(approx(gallonsPerHour(11.428), 1, 1e-3), 'GPH = MAF/k = 1 gal/hr');

  let fa = initFuelAccum();
  fa = accumFuel(fa, 11.428, 60, 1); // 60 mph for 1 hr, MAF 11.428 -> 60 mi / 1 gal
  ok(approx(avgMpg(fa), 60, 1e-1), 'avg MPG integrates to 60');
  ok(avgMpg(initFuelAccum()) === null, 'avg MPG null before any fuel used');

  ok(approx(estHp(5200, 100), 159, 1e-6), 'estHp at peak rpm + full load = 159');
  ok(estHp(800, 20) > 0 && estHp(800, 20) < 159, 'estHp partial at idle-ish');
  ok(approx(estTorqueLbFt(100, 5252), 100, 1e-6), 'torque = hp at 5252 rpm');
  ok(estTorqueLbFt(100, 0) === 0, 'torque = 0 at rpm 0 (no div-by-zero)');

  let z = initZeroSixty();
  z = zeroSixtyStep(z, 0, 0); // seed: stopped -> armed
  ok(z.phase === 'armed', '0-60 arms when stopped');
  z = zeroSixtyStep(z, 2, 0.1); // first motion -> running (t0 = 0.1)
  ok(z.phase === 'running', '0-60 starts on first motion');
  z = zeroSixtyStep(z, 30, 4);
  z = zeroSixtyStep(z, 58, 8);
  z = zeroSixtyStep(z, 62, 8.5); // crosses 60 between t=8 and t=8.5
  ok(z.phase === 'done', '0-60 completes when crossing 60 mph');
  ok(approx(z.result, 8.15, 1e-2), `0-60 linearly interpolates the crossing (${z.result?.toFixed(2)}s)`);
}

console.log('\nALTITUDE + GRADE (src/lib/derive.ts, src/lib/pulse.ts)');
{
  const run = ALT_SAMPLE_MI * 5280; // ft of road per sample (105.6)
  const climb10 = Array.from({ length: 20 }, (_, i) => 1000 + i * run * 0.1);
  ok(approx(gradePct(climb10), 10, 1e-6), `steady 10% climb reads +10% (${gradePct(climb10)?.toFixed(3)})`);
  const descend6 = Array.from({ length: 20 }, (_, i) => 1000 - i * run * 0.062);
  ok(approx(gradePct(descend6), -6.2, 1e-6), 'steady descent reads negative grade');
  ok(approx(gradePct(new Array(30).fill(1284)), 0, 1e-9), 'flat road reads 0%');
  ok(gradePct([1, 2, 3]) === null && gradePct([]) === null, 'too few samples (< 0.1 mi) → null');
  // noisy GPS: least-squares should land near the true slope despite ±15 ft jitter
  const noise = [12, -9, 15, -14, 3, 8];
  const noisy = Array.from({ length: 6 }, (_, i) => 1000 + i * run * 0.05 + noise[i]);
  const g = gradePct(noisy)!;
  ok(Math.abs(g - 5) < 4, `noisy 5% climb stays in band (${g.toFixed(2)}%)`);

  const terrain = buildWaveform({ samples: [-1, 0, 1], x: 0, y: 10, width: 100, height: 50, range: 1, floor: true });
  ok(/L 100 60 Z$/.test(terrain.fill) && terrain.fill.startsWith('M 0 60'), 'floor fill closes at the bottom edge');

  const sim = new SimulatedDataSource({ seed: 3 });
  const alt0 = sim.getHistory().altitude;
  ok(alt0.length === ALT_SLOTS, `sim pre-fills the ~5 mi profile (${alt0.length} samples)`);
  for (let i = 0; i < 4000; i++) sim.tick();
  const alt = sim.getHistory().altitude;
  ok(alt.length === ALT_SLOTS && alt.every(Number.isFinite), 'sim altitude ring stays full + finite');
  const sg = gradePct(alt);
  ok(sg !== null && Math.abs(sg) < 25, `sim grade is plausible (${sg?.toFixed(1)}%)`);
}

console.log('\nTHEME MATH (src/theme/themes.ts)');
{
  ok(formatColor(parseColor('#FFB454')!) === '#ffb454', 'hex parse/format round-trips');
  ok(formatColor(parseColor('rgba(244,162,58,0.2)')!) === 'rgba(244,162,58,0.2)', 'rgba parse/format round-trips');
  ok(parseColor('Oxanium') === null, 'font names are not colors');
  ok(lerpTheme(amberNight, amberDay, 0) === amberNight && lerpTheme(amberNight, amberDay, 1) === amberDay, 'lerpTheme endpoints are the themes themselves');
  const mid = lerpTheme(amberNight, amberDay, 0.5);
  const m = parseColor(mid.bg)!;
  const n0 = parseColor(amberNight.bg)!;
  const d0 = parseColor(amberDay.bg)!;
  ok([0, 1, 2].every((i) => Math.abs(m[i] - (n0[i] + d0[i]) / 2) <= 1), `lerpTheme midpoint bg is the RGB average (${mid.bg})`);
  ok(mid.fontDisplay === 'Oxanium' && mid.fontMono === 'JetBrains Mono', 'lerpTheme copies non-color tokens');
  const keys = Object.keys(amberNight) as (keyof typeof amberNight)[];
  ok(
    keys.every((k) => (typeof mid[k] === 'number' ? Number.isFinite(mid[k]) : !/NaN/.test(String(mid[k])))),
    'lerpTheme leaves no NaN tokens'
  );
  ok(Math.abs(mid.stroke - (amberNight.stroke + amberDay.stroke) / 2) < 1e-9, 'lerpTheme blends numeric tokens (ring stroke)');
  const ratio = relLuminance(amberNightDim.accent) / relLuminance(amberNight.accent);
  ok(Math.abs(ratio - 0.4) < 0.02, `night face dims luminance to ~40% (${(ratio * 100).toFixed(1)}%)`);
  ok(parseColor(dimTheme(amberNight, 0.4).panel)![3] === parseColor(amberNight.panel)![3], 'dimTheme keeps alpha');
}

console.log('\nDAYLIGHT CONTRAST (amberDay, WCAG vs bg — npm run contrast for the full table)');
{
  for (const [k, target] of Object.entries(DAY_CONTRAST_TARGETS)) {
    const r = contrastRatio(amberDay[k as keyof typeof DAY_CONTRAST_TARGETS], amberDay.bg);
    ok(r >= target, `day ${k.padEnd(10)} ${r.toFixed(2)}:1 ≥ ${target}`);
  }
  const panel = composite(amberDay.panel, amberDay.bg);
  ok(contrastRatio(amberDay.accent, panel) >= 7, `day accent on a panel ${contrastRatio(amberDay.accent, panel).toFixed(2)}:1 ≥ 7`);
  ok(contrastRatio(amberDay.panelBorder, amberDay.bg) >= 3, `day tile borders ${contrastRatio(amberDay.panelBorder, amberDay.bg).toFixed(2)}:1 ≥ 3 (non-text)`);
  ok(amberDay.stroke >= 1.2 * amberNight.stroke - 1e-9, 'day ring strokes ≥ +20%');
  ok(amberDay.ambientMax <= 0.06, 'day ambient glow capped at 0.06');
}

console.log('\nSIGNAL LIBRARY — G-SCOPE (src/lib/gscope.ts)');
{
  ok(envelopeBin(1, 0) === 0 && envelopeBin(0, 1) === 9 && envelopeBin(-1, 0) === 18 && envelopeBin(0, -1) === 27, 'envelope bins: right / accel / left / brake = 0 / 9 / 18 / 27');
  const env = new Array(ENV_BINS).fill(0);
  updateEnvelope(env, 0, 0.5, 0.05);
  ok(Math.abs(env[9] - 0.5) < 1e-9 && envelopePeak(env) === env[9], 'envelope records a 0.5 g accel peak');
  updateEnvelope(env, 0, 0.1, 10);
  ok(env[9] < 0.5 && env[9] > 0.4, `envelope fades slowly (${env[9].toFixed(3)} after 10 s)`);
  ok(trailLife(0) === 0.6 && Math.abs(trailLife(1) - 5.6) < 1e-9, 'trail life 0.6 → 5.6 s with persistence');
  const grid = gscopeGrid(200, 200, 180);
  ok(noNaNStr(grid.inner) && noNaNStr(grid.outer) && noNaNStr(grid.cross), 'scope grid well-formed');
  const trail = Array.from({ length: 60 }, (_, i) => [Math.sin(i / 7) * 0.4, Math.cos(i / 9) * 0.3] as [number, number]);
  const fr = gscopeFrame({ cx: 200, cy: 200, S: 180, trail, env, lat: 0.4, long: -0.3 });
  ok(fr.bands.length === TRAIL_BANDS && fr.bands.every((b) => b === '' || noNaNStr(b)), `trail split into ${TRAIL_BANDS} bands`);
  ok(fr.envelope.endsWith('Z') && noNaNStr(fr.envelope), 'grip envelope closed');
  ok(fr.beam.x > 200 && fr.beam.y > 200, 'beam: +lat right, −long (braking) down');
  const wild = gscopeFrame({ cx: 0, cy: 0, S: 100, trail: [], env, lat: 9, long: NaN });
  ok(Number.isFinite(wild.beam.x) && Number.isFinite(wild.beam.y) && wild.beam.x <= 0.8 * 1.12 * 100 + 1e-9, 'beam clamps wild / NaN g');
}

console.log('\nSIGNAL LIBRARY — SPEED RECORD (src/lib/speedRecord.ts)');
{
  ok(RECORD_SLOTS === 1800 && RECORD_DT === 0.05, '90 s at 20 Hz = 1800 samples');
  ok(speedRadius(0, 100, 400) === 100 && speedRadius(70, 100, 400) === 400 && speedRadius(200, 100, 400) === 400, 'speed radius R0 → R1, clamped');
  const g = recordGrid(400, 400, 140, 390);
  ok(noNaNStr(g.major) && noNaNStr(g.minor) && noNaNStr(g.pen), 'record grid well-formed');
  ok(noNaNStr(recordSpokes(400, 400, 140, 390, 1.3).major), 'spokes well-formed');
  const empty = recordFrame({ cx: 400, cy: 400, R0: 140, R1: 390, speeds: [] });
  ok(empty.line === '' && empty.head === null, 'empty record draws nothing (no crash)');
  const speeds = Array.from({ length: RECORD_SLOTS }, (_, i) => 30 + 20 * Math.sin(i / 50));
  const rpms = speeds.map((v, i) => (i < 900 ? NaN : v * 50));
  const fr = recordFrame({ cx: 400, cy: 400, R0: 140, R1: 390, speeds, rpms });
  ok(noNaNStr(fr.line) && noNaNStr(fr.fresh) && fr.area.endsWith('Z'), 'record line / fresh / area well-formed');
  ok(fr.head !== null && Math.abs(fr.head.x - 400) < 0.01 && fr.head.y < 400, 'newest sample sits at the 12 o’clock pen');
  ok(fr.rpm.length > 0 && !/NaN/.test(fr.rpm), 'RPM track drawn only where RPM exists');
}

console.log('\nSIGNAL LIBRARY — ATTITUDE MESH + TACOMA MODEL (src/lib/mesh.ts, tacoma.ts)');
{
  const m = TACOMA_ACCESS_CAB;
  const all = [...m.body, ...m.detail, ...m.wheels].flat();
  ok(all.every((p) => p.every(Number.isFinite)), `Tacoma model: ${m.body.length + m.detail.length + m.wheels.length} polylines, all finite`);
  const zs = all.map((p) => p[2]);
  const len = Math.max(...zs) - Math.min(...zs);
  ok(Math.abs(len - 3.4) < 0.05, `model length = 212.3" scaled (${len.toFixed(2)} units)`);
  const xs = all.map((p) => p[0]);
  ok(Math.abs(Math.max(...xs) + Math.min(...xs)) < 1e-9, 'model is left/right symmetric');
  const nose = Math.min(...zs);
  const T = tiltTransform(10, 0, 1);
  ok(T([0, 0, nose])[1] > 0, '+pitch raises the nose (IMU convention; the study had it inverted)');
  const R = tiltTransform(0, 10, 1);
  ok(R([0.5, 0, 0])[1] < 0 && R([0, 1, 0])[0] > 0, '+roll drops the right side and leans the roof right');
  // the terrain's cross lines sit at z = j − frac(dist·0.3): they flow toward −z as you
  // drive, so the nose must point to +z on the road (upstream) or the truck reverses
  ok(truckToWorld([0, 0, nose])[2] > 0, 'truck faces into the scrolling terrain (drives forward, not in reverse)');
  const L0 = tiltTransform(0, 0, 1)([0.3, 0.7, -1.1]);
  ok(Math.abs(L0[0] - 0.3) < 1e-12 && Math.abs(L0[1] - 0.7) < 1e-12 && Math.abs(L0[2] + 1.1) < 1e-12, 'level = identity');
  const P = makeProjector(700, 600);
  const o = P(0, 0, 0);
  ok(Math.abs(o[0] - 350) < 1e-9 && Math.abs(o[1] - 396) < 1e-9, 'projector: ground origin at (w/2, 0.66h)');
  const fr = meshFrame({ w: 700, h: 600, distM: 123.4, pitchDeg: 25, rollDeg: -30, model: m });
  ok(fr.grid.length === GRID_ALPHAS.length && noNaNStr(fr.body) && noNaNStr(fr.wheels) && noNaNStr(fr.detail) && noNaNStr(fr.up), 'mesh frame well-formed at an extreme pose');
  ok(noNaNStr(meshFrame({ w: 700, h: 600, distM: NaN, pitchDeg: NaN, rollDeg: NaN, model: m }).body), 'mesh survives NaN inputs (draws level)');
}

console.log('\nDRIVE RECORDER (src/lib/driveRecorder.ts)');
{
  ok(RECORDER_SLOTS === RECORD_SLOTS && Math.abs(TRAIL_LIFE_S - trailLife(0.6)) < 1e-9, 'recorder constants match gscope / speedRecord');
  const r = createDriveRecorder();
  for (let i = 0; i < 2500; i++) recordTick(r, { lat: 0.3 * Math.sin(i / 20), long: 0.2, speedMph: i % 80, rpm: i < 2000 ? null : 2000 }, i * 0.05);
  ok(r.count === RECORD_SLOTS, `speed ring full after 125 s (${r.count})`);
  ok(r.trail.length > 0 && r.trail[r.trail.length - 1][2] - r.trail[0][2] <= TRAIL_LIFE_S + 1e-9, 'g trail pruned to its life');
  const sp = new Float32Array(RECORD_SLOTS);
  const rp = new Float32Array(RECORD_SLOTS);
  const n = readRecord(r, sp, rp);
  ok(n === RECORD_SLOTS && sp[n - 1] === 2499 % 80 && sp[n - 2] === 2498 % 80, 'readRecord returns oldest → newest');
  ok(Number.isNaN(rp[0]) && rp[n - 1] === 2000, 'RPM absent (NaN) before OBD, present after');
  ok(Math.max(...r.env) > 0.3, 'envelope accumulated');
  resetEnvelope(r);
  ok(r.env.every((v) => v === 0), 'hold-to-reset clears the peaks');
  const v0 = r.version;
  recordTick(r, { lat: null, long: null, speedMph: null, rpm: null }, 9999);
  ok(r.version === v0 + 1 && r.gLive === false, 'absent sensors: no beam, record keeps ticking');
}

console.log('\nSIGNATURE MOMENTS (src/lib/sweep.ts)');
{
  const f0 = bootSweep(0, 0.3, 24)!;
  ok(f0.frac === 0 && f0.speed === 0, 'boot sweep starts at 0 (ring + numeral)');
  const peak = bootSweep(BOOT_UP_MS - 1, 0.3, 24)!;
  ok(peak.frac > 0.99 && Math.abs(peak.speed! - BOOT_PEAK_MPH) <= 1, `boot sweep peaks at full scale (${peak.frac.toFixed(3)}, ${peak.speed})`);
  let mono = true;
  for (let t = 0, prev = -1; t < BOOT_UP_MS; t += 16) {
    const f = bootSweep(t, 0, 0)!.frac;
    if (f < prev) mono = false;
    prev = f;
  }
  ok(mono, 'boot sweep rises monotonically (ticks light in sequence)');
  const land = bootSweep(BOOT_LIVE_BY_MS - 1, 0.3, 24)!;
  ok(Math.abs(land.frac - 0.3) < 0.01 && land.speed === 24, `boot sweep lands on live values (${land.frac.toFixed(3)}, ${land.speed})`);
  ok(bootSweep(BOOT_LIVE_BY_MS, 0.3, 24) === null, 'boot sweep hands off to live by BOOT_LIVE_BY_MS');
  ok(BOOT_LIVE_BY_MS < BOOT_MS && BOOT_MS <= 1200, `boot sweep hard-capped ≤ 1.2 s (${BOOT_MS} ms)`);
  ok(bootSweep(NaN, 0, 0) === null && bootSweep(-5, 0, 0) === null, 'boot sweep tolerates bad clocks');

  const c0 = connectSweep(0, 0.4, 0.15)!;
  ok(Math.abs(c0.frac - 0.4) < 1e-9 && c0.redline === 0, 'connect sweep starts where the ring was, redline dark');
  const cEnd = connectSweep(CONNECT_MS - 1, 0.4, 0.15)!;
  ok(Math.abs(cEnd.frac - 0.15) < 0.01 && cEnd.redline === 1, 'connect sweep lands on live rpm, redline lit');
  ok(connectSweep(CONNECT_MS, 0.4, 0.15) === null, 'connect sweep ends at CONNECT_MS');
}

console.log('\nSIGNATURE SPEED TRACE (src/lib/pulse.ts buildTrace)');
{
  const box = { x: 100, y: 200, width: 1000, height: 100 };
  const nums = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const flat = buildTrace({ samples: new Float32Array(1800), count: 0, ...box });
  ok(flat.top === 40 && nums(flat.line).filter((_, i) => i % 2 === 1).every((y) => y === 300), 'no data → flat zero line on the floor, 40 mph scale');
  const cruise = new Float32Array(1800).fill(50);
  const c = buildTrace({ samples: cruise, count: 1800, ...box });
  ok(c.top === 60 && Math.abs(c.head.y - (300 - (50 / 60) * 100)) < 0.01, `steady 50 mph → level line, scale rounds up to ${c.top}`);
  ok(/^M [\d.]+ [\d.]+( C( [\d.]+){6})+$/.test(c.line) && !/NaN|Infinity/.test(c.fill), 'line is pure cubic Béziers (a spline, no corners); finite numbers only');
  // GPS-style stair steps: speed changes in 1 Hz jumps (20 samples each) while accelerating
  const stairs = new Float32Array(1800);
  for (let i = 0; i < 1800; i++) stairs[i] = Math.min(65, Math.floor(i / 20) * 2);
  const ys = (tr: { line: string }) => nums(tr.line).filter((_, i) => i % 2 === 1);
  let worst = 0;
  for (let n = 1000; n < 1040; n++) {
    const a = ys(buildTrace({ samples: stairs, count: n, ...box }));
    const b = ys(buildTrace({ samples: stairs, count: n + 1, ...box }));
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  }
  ok(worst < 1.5, `one new sample moves the curve < 1.5 px anywhere (smooth scroll, worst ${worst.toFixed(2)} px)`);
  const jag = new Float32Array(1800);
  for (let i = 0; i < 1800; i++) jag[i] = 40 + (i % 2 ? 6 : -6); // ±6 mph sample-to-sample noise
  const j = ys(buildTrace({ samples: jag, count: 1800, ...box }));
  ok(Math.max(...j) - Math.min(...j) < 2, 'sample-to-sample jitter is averaged away (no jagged up-and-down)');
  const neg = buildTrace({ samples: [-5, NaN, Infinity, 30], count: 4, ...box });
  ok(!/NaN|Infinity/.test(neg.line + neg.fill) && neg.head.y <= 300 && neg.head.y >= 200, 'bad samples (negative / NaN / ∞) stay inside the box');
}

console.log('\nHOME GLANCES — warm-up + eco zone (src/lib/engineGlance.ts)');
{
  ok(coolantState(135) === 'cold' && coolantState(COOLANT_WARM_F) === 'warm' && coolantState(196) === 'warm' && coolantState(COOLANT_HOT_F) === 'hot', 'coolant: cold < 160 ≤ warm < 230 ≤ hot');
  ok(warmupFrac(100) === 0 && Math.abs(warmupFrac(130) - 0.5) < 1e-9 && warmupFrac(163) === 1 && warmupFrac(NaN) === 0, 'warm-up bar 100 → 160 °F, clamped');
  // the truck, 2026-10-23: 158 °F at 526 s run time, 163 °F at 572 s — crossed "warm" at idle
  ok(coolantState(158) === 'cold' && coolantState(163) === 'warm', 'measured idle warm-up crosses the line between 158 and 163 °F');
  ok(warmupStage(100) === 0 && warmupStage(125) === 1 && warmupStage(150) === 2 && warmupStage(160) === 3 && warmupStage(NaN) === 0, 'coolant colour steps blue → amber at 120 / 140 / 160 °F');
  ok(ecoLevel(null) === null && ecoLevel(ECO_MPG) === 1 && ecoLevel(30) === 1 && ecoLevel(POOR_MPG) === 0 && ecoLevel(5) === 0, `economy colour: green ≥ ${ECO_MPG}, warn ≤ ${POOR_MPG} mpg`);
  ok([15, 17, 19, 20].map((m) => ecoLevel(m)).every((v, i, a) => v != null && v > 0 && v < 1 && (i === 0 || v >= (a[i - 1] as number))), 'economy colour fades in quarter steps between poor and eco (20 mpg is not yet green)');
  ok(!inEcoZone(null) && !inEcoZone(ECO_MPG - 1) && inEcoZone(ECO_MPG) && !inEcoZone(NaN), `eco zone = instant ≥ ${ECO_MPG} mpg (EPA combined)`);
  ok(mpgBarFrac(0) === 0 && mpgBarFrac(MPG_BAR_MAX / 2) === 0.5 && mpgBarFrac(99) === 1 && mpgBarFrac(-3) === 0, 'mpg bar 0–40, coasting pins to the end');
  const e1 = emaStep(null, 20, 50, 2000);
  let e = e1;
  for (let i = 0; i < 40; i++) e = emaStep(e, 30, 50, 2000); // 2 s at 20 Hz
  ok(e1 === 20 && e > 26 && e < 27.5, `EMA seeds on first value, ~63% of a step after one τ (${e.toFixed(2)})`);
  ok(emaStep(20, 99, 0, 2000) === 20 && emaStep(20, 99, -5, 2000) === 20, 'EMA ignores zero / negative dt');
}

console.log('\nOBD DIAGNOSTICS (src/lib/obdDiag.ts)');
{
  const now = 100_000;
  const st = (p: Partial<PidStat>): PidStat => ({ pid: 0x05, asked: 0, answered: 0, noData: 0, timeouts: 0, lastValue: null, lastAt: null, ...p });
  ok(pidHealth(st({ asked: 9, answered: 9, lastAt: now - 4000 }), true, now) === 'ok', 'answering → ok');
  ok(pidHealth(st({ asked: 9, answered: 3, lastAt: now - 60_000 }), true, now) === 'slow', 'answered before, nothing recent → slow');
  ok(pidHealth(undefined, false, now) === 'unsupported' && pidHealth(st({ asked: 0 }), false, now) === 'unsupported', 'left out of the support mask → unsupported (never asked)');
  ok(pidHealth(st({ asked: 6, noData: 6 }), true, now) === 'no-data' && pidHealth(st({ asked: 6, timeouts: 6 }), null, now) === 'no-data', 'asked but never decoded → no-data');
  ok(pidHealth(undefined, null, now) === 'waiting' && pidHealth(undefined, true, now) === 'waiting', 'not asked yet → waiting');
  ok(hexPid(0x0c) === '0C' && hexPid(0x5c) === '5C', 'hexPid pads + uppercases');
  const line = summarizeHealth([
    { pid: 0x0c, health: 'ok' },
    { pid: 0x05, health: 'ok' },
    { pid: 0x2f, health: 'unsupported' },
    { pid: 0x5c, health: 'unsupported' },
  ]);
  ok(line === 'ok: 0C 05 · unsupported: 2F 5C', `logcat summary groups by health ("${line}")`);
}

console.log('\nLOGBOOK — fuel tank, odometer, service (src/lib/logbook.ts)');
{
  const DAY = 86_400_000;
  const t0 = Date.UTC(2026, 0, 1);
  const lb = emptyLogbook();
  ok(fuelLeft(lb) === null && odometerNow(lb) === null, 'nothing logged → fuel left + odometer unknown (never guessed)');
  addFill(lb, { at: t0, gallons: null, full: true, pricePerGal: 4.5, odometer: 80_000 });
  ok(fuelLeft(lb)!.gallons === TANK_GAL && odometerNow(lb) === 80_000, `a full fill = ${TANK_GAL} gal; odometer reading taken`);
  onUsage(lb, 200, 10);
  ok(Math.abs(fuelLeft(lb)!.gallons - (TANK_GAL - 10)) < 1e-9 && odometerNow(lb) === 80_200, 'MAF gallons drain the tank; logged miles advance the odometer');
  ok(Math.abs(rangeMiles(fuelLeft(lb)!.gallons, 20)! - (TANK_GAL - 10) * 20) < 1e-9 && rangeMiles(null, 20) === null, 'range = gallons left × mpg');
  // the pump says 12.0 gal went in where MAF measured 10.0 → MAF under-reads by 20 %
  addFill(lb, { at: t0 + 5 * DAY, gallons: 12, full: true, pricePerGal: 4.6, odometer: null });
  ok(lb.calib != null && Math.abs(lb.calib - 1.2) < 1e-9, 'full → full fill learns the pump calibration (pumped ÷ measured = 1.20)');
  onUsage(lb, 100, 5);
  ok(Math.abs(fuelLeft(lb)!.gallons - (TANK_GAL - 6)) < 1e-9, 'later burn is corrected by the calibration (5 measured → 6 real)');
  ok(pumpMpgs(lb).length === 1 && Math.abs(pumpMpgs(lb)[0].mpg - 200 / 12) < 1e-9, 'pump-honest MPG between full fills (200 mi / 12 gal)');
  addFill(lb, { at: t0 + 6 * DAY, gallons: 3, full: false, pricePerGal: null, odometer: null });
  ok(Math.abs(fuelLeft(lb)!.gallons - (TANK_GAL - 6 + 3)) < 1e-9, 'a partial fill adds what was pumped');
  const silly = emptyLogbook();
  addFill(silly, { at: t0, gallons: null, full: true, pricePerGal: null, odometer: null });
  onUsage(silly, 50, 4);
  addFill(silly, { at: t0 + DAY, gallons: 40, full: true, pricePerGal: null, odometer: null }); // 10× — a typo
  ok(silly.calib === null, 'an implausible pump number (typo) never becomes the calibration');
  onUsage(silly, 0, 999);
  ok(fuelLeft(silly)!.gallons === 0, 'fuel left never goes negative');

  // service: oil 10k mi / 12 mo, logged at 79,500 mi six months ago; odometer now ~80,300
  const sv = emptyLogbook();
  const now = t0 + 400 * DAY;
  addService(sv, { at: now - 182 * DAY, odometer: 79_500, types: ['oil', 'rotate'], note: ' dealer ', cost: 90 });
  setOdometer(sv, 84_200, now - DAY);
  const st = serviceStatus(sv, now);
  const oil = st.find((r) => r.type.id === 'oil')!;
  const rot = st.find((r) => r.type.id === 'rotate')!;
  ok(oil.state === 'ok' && oil.inMiles === 5_300 && oil.inDays != null && oil.inDays > 150 && oil.inDays < 200, `oil 10k / 12 mo after 79,500 → ok, ${dueText(oil)}`);
  ok(rot.state === 'soon' && rot.inMiles === 300, `tire rotation 5k after 79,500 at 84,200 → ${dueText(rot)}`);
  ok(st[0].type.id === 'rotate' && nextDue(sv, now)?.type.id === 'rotate', 'most urgent first; HOME nudges the nearest due item');
  ok(st.find((r) => r.type.id === 'plugs')!.state === 'never', 'never-logged items say so (no fake due date)');
  addService(sv, { at: now - 900 * DAY, odometer: 60_000, types: ['oil'], note: '', cost: null }); // back-logged history
  ok(odometerNow(sv) === 84_200, 'back-logging an OLD service never rewinds the odometer');
  ok(serviceStatus(sv, now).find((r) => r.type.id === 'oil')!.last!.odometer === 79_500, 'the latest service of a kind is what counts');
  ok(sv.service[0].at < sv.service[1].at && sv.service[1].note === 'dealer', 'history stays date-sorted; notes trimmed');
  addService(sv, { at: now, odometer: 84_250, types: ['rotate'], note: '', cost: null });
  ok(serviceStatus(sv, now).find((r) => r.type.id === 'rotate')!.state === 'ok', 'logging it clears the nudge');
  const back = normalizeLogbook(JSON.parse(JSON.stringify(lb)));
  ok(back.fills.length === lb.fills.length && back.calib === lb.calib && Math.abs(fuelLeft(back)!.gallons - fuelLeft(lb)!.gallons) < 1e-9, 'round-trips through JSON');
  ok(normalizeLogbook('garbage').fills.length === 0 && normalizeLogbook({ fills: [null, { at: 'x' }] }).fills.length === 0, 'corrupt storage loads as an empty logbook');

  // spending: real pump numbers, this month + per mile
  const sp = emptyLogbook();
  const nowS = Date.UTC(2026, 9, 26, 12);
  addFill(sp, { at: Date.UTC(2026, 8, 20), gallons: 18.0, full: true, pricePerGal: 4.0, odometer: null }); // September
  onUsage(sp, 380, 17);
  addFill(sp, { at: Date.UTC(2026, 9, 5), gallons: 19.0, full: true, pricePerGal: 4.5, odometer: null });
  onUsage(sp, 350, 16);
  addFill(sp, { at: Date.UTC(2026, 9, 20), gallons: 17.5, full: true, pricePerGal: 4.6, odometer: null });
  addFill(sp, { at: Date.UTC(2026, 9, 22), gallons: null, full: true, pricePerGal: 4.7, odometer: null }); // no gallons: can't cost
  const spd = spending(sp, nowS, 20);
  ok(Math.abs(spd.month - (19 * 4.5 + 17.5 * 4.6)) < 1e-9 && spd.costedFills === 3, `this month = only fills with gallons + price ($${spd.month.toFixed(2)})`);
  ok(Math.abs(spd.last30 - (19 * 4.5 + 17.5 * 4.6)) < 1e-9, 'last 30 days');
  ok(fillCost(sp.fills[0]) === 72 && fillCost(sp.fills[3]) === null, 'fill cost = gallons × price');
  addFill(sp, { at: Date.UTC(2026, 9, 24), gallons: null, full: false, pricePerGal: null, total: 40, odometer: null });
  ok(fillCost(sp.fills[4]) === 40 && Math.abs(spending(sp, nowS, 20).month - (19 * 4.5 + 17.5 * 4.6 + 40)) < 1e-9, 'a pump TOTAL counts even without gallons');
  ok(spd.mpg != null && Math.abs(spd.mpg - (380 / 19 + 350 / 17.5) / 2) < 1e-9, 'per-mile uses pump-honest mpg between full fills');
  ok(spd.perMile != null && Math.abs(spd.perMile - ((4.5 + 4.6 + 4.7) / 3) / spd.mpg!) < 1e-9, `cost to drive ≈ $${spd.perMile!.toFixed(3)}/mi`);
  const early = emptyLogbook();
  early.calib = 1.1;
  addFill(early, { at: nowS, gallons: 15, full: true, pricePerGal: 4.4, odometer: null });
  ok(Math.abs(spending(early, nowS, 22).mpg! - 20) < 1e-9, 'before two full fills: MAF mpg ÷ calibration');

  // the EXPERIMENTAL gauge-cluster fuel probe: 61 29 A → A / 2 litres
  const fp = FUEL_LEVEL_PROBES[0];
  ok(fp.rx === '7C8' && decodeProbe(fp, '61 29 64') === 50 && decodeProbe(fp, '61 29 FF') === null && decodeProbe(fp, 'NO DATA') === null, 'meter fuel probe decodes litres, rejects out-of-range + NO DATA');
}

console.log('\nTRIP SUMMARY STATS (src/lib/mpgLog.ts tripTick)');
{
  const lg = emptyLog();
  tripStart(lg, 0);
  for (let i = 0; i < 600; i++) tripTick(lg, 1, 40, i % 4 !== 0); // 10 min moving, 75 % eco
  for (let i = 0; i < 120; i++) tripTick(lg, 1, 0, null); // 2 min idling
  tripTick(lg, 1, 63, null);
  tripTick(lg, 3600, 50, true); // a slept gap — ignored
  const c = lg.current!;
  ok(c.movingSec === 601 && c.idleSec === 120 && c.maxMph === 63, 'moving / idle time + top speed');
  ok(Math.abs(ecoShare(c)! - 450 / 600) < 1e-9, 'eco share counts only moving time with an mpg reading');
  ok(ecoShare({ ...c, scoredSec: 10 }) === null, 'too little scored time → no eco %');
}

console.log('\nGEAR + PARK (src/lib/gear.ts)');
{
  // every gear of the AC60E at a sensible speed, from the nominal driveline
  const speeds = [10, 18, 28, 38, 45, 60];
  ok(speeds.every((mph, i) => matchGear(mph * K_NOMINAL * GEAR_RATIOS[i], mph)?.gear === i + 1), 'rpm ÷ mph picks gears 1–6');
  ok(matchGear(1.08 * 18 * K_NOMINAL * GEAR_RATIOS[1], 18)?.gear === 2, '8 % converter slip in 2nd is still 2nd');
  ok(matchGear(1580, 30) === null && matchGear(750, 0) === null && matchGear(0, 40) === null, 'between gears / stopped / no rpm → no match (no guessing)');
  // drive in 4th for a while: shown after the 0.5 s hold; K self-calibrates toward a bigger tire
  const g = createGearState();
  let tt = 0;
  const step = (mph: number | null, rpm: number | null, reverse: boolean | null, ms = 100) => {
    tt += ms;
    return gearStep(g, { now: tt, mph, rpm, reverse });
  };
  step(40, 40 * 41 * 1.0, false);
  ok(g.shown !== '4', 'a new gear waits out the hold (no flicker mid-shift)');
  for (let i = 0; i < 600; i++) step(40, 40 * 41 * 1.0, false); // 41 rpm/mph: e.g. taller tires
  ok(g.shown === '4' && g.k < K_NOMINAL && g.k > 40.5, `K learns from clean cruise (${g.k.toFixed(2)})`);
  // stop at a light in D: shows D, not parked
  for (let i = 0; i < 50; i++) step(0, 720, false);
  ok(g.shown === 'D' && !g.parked && !summaryPromptDue(g, tt), 'stopped in drive → D, no prompt yet');
  // shift D → P: passes through R (camera blips), then nothing — Park after the window
  step(0, 720, true);
  ok(g.shown === 'R', 'reverse lights R');
  step(0, 720, false);
  for (let i = 0; i < REVERSE_TO_PARK_MS / 100 + 2; i++) step(0, 720, false);
  ok(g.shown === 'P' && g.parked && g.parkSeq === 1 && summaryPromptDue(g, tt), 'R released + no roll → P, prompt due');
  // drive off: clears; back out of a spot (R → D) must NOT read as park
  for (let i = 0; i < 20; i++) step(5, 5 * K_NOMINAL * 3.6, false);
  ok(!g.parked && g.shown !== 'P', 'rolling clears park');
  step(0, 720, false);
  step(0, 720, true);
  step(0, 720, false);
  for (let i = 0; i < 10; i++) step(3, 900, false); // pulled away forward within a second
  ok(!g.parked && g.parkSeq === 1, 'R → D (pulling out after reversing) is not park');
  // engine off while stopped = park; no reverse signal at all → long stop still prompts
  for (let i = 0; i < 5; i++) step(0, 0, false);
  ok(g.parked && g.parkSeq === 2, 'engine off while stopped → P');
  const q = createGearState();
  gearStep(q, { now: 0, mph: 0, rpm: null, reverse: null });
  ok(!summaryPromptDue(q, STOP_PROMPT_MS - 1) && summaryPromptDue(q, STOP_PROMPT_MS + 1), 'no park clues → a 1-min stop still offers the summary');
}

console.log('\nOBD AUTO-CONNECT (src/lib/obdLink.ts)');
{
  ok(
    obdRetryDelayMs(1, 0) === OBD_RETRY_STEPS_MS[0] && obdRetryDelayMs(2, 5000) === OBD_RETRY_STEPS_MS[1] && obdRetryDelayMs(3, 9000) === OBD_RETRY_STEPS_MS[2],
    `retry ramps ${OBD_RETRY_STEPS_MS.join(' → ')} ms while the dongle wakes`
  );
  ok(obdRetryDelayMs(4, 30_000) === OBD_RETRY_STEADY_MS && obdRetryDelayMs(40, 5 * 60_000) === OBD_RETRY_STEADY_MS, 'then settles at the steady cadence');
  ok(obdRetryDelayMs(80, OBD_RETRY_SLOW_AFTER_MS) === OBD_RETRY_SLOW_MS, 'a long-missing dongle is retried slowly (spares phone BT audio)');
  ok(obdRetryDelayMs(0, 0) === OBD_RETRY_STEPS_MS[0] && obdRetryDelayMs(NaN as unknown as number, 0) > 0, 'never a zero / NaN delay');
  ok(OBD_RETRY_STEPS_MS.every((v, i, a) => i === 0 || v > a[i - 1]) && OBD_RETRY_STEADY_MS < OBD_RETRY_SLOW_MS, 'cadence is monotonic');

  const bonded = [
    { name: 'Pixel 8', address: '11:22:33:44:55:66' },
    { name: 'vLinker MC-Android', address: '08:04:B4:3F:15:38' },
    { name: 'OBDII', address: 'AA:BB:CC:DD:EE:FF' },
  ];
  ok(pickObdAdapter(bonded, 'aa:bb:cc:dd:ee:ff') === 'AA:BB:CC:DD:EE:FF', 'remembered adapter wins (MAC case-insensitive)');
  ok(pickObdAdapter(bonded, null) === '08:04:B4:3F:15:38', 'no memory → first OBD-named bonded device');
  ok(pickObdAdapter(bonded, '00:00:00:00:00:01') === '08:04:B4:3F:15:38', 'remembered adapter unpaired → falls back to an OBD-named one');
  ok(pickObdAdapter([bonded[0]], null) === null && pickObdAdapter([], 'AA:BB:CC:DD:EE:FF') === null, 'never auto-dials a non-OBD device (a phone)');
  const ranked = rankObdDevices(bonded);
  ok(ranked.length === 3 && ranked[2].name === 'Pixel 8', 'picker ranks OBD adapters first, hides nothing');
}

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
