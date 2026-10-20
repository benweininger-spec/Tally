/**
 * Logic checks for the parts with real risk: the signature geometry and the
 * simulator. No native deps — runs under `node --experimental-strip-types`.
 *   npm run verify
 */
import {
  arcPath,
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
} from '../src/lib/elm327.ts';
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
} from '../src/lib/derive.ts';

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

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
