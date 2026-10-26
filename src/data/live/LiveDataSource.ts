/**
 * LiveDataSource — the real-hardware implementation of `DataSource`.
 *
 * Composition root for the live tiers. It ticks at ~30fps exactly like
 * SimulatedDataSource, reads each provider, converts at the source to the UI's
 * units, derives metrics, and stamps every field's `live | stale | absent` status
 * from data freshness. The render tree never knows the difference — same
 * `DashboardData`/`History` contract, zero component changes (docs/ARCHITECTURE.md).
 *
 *   Tier A  GPS (LocationProvider) + IMU (SensorProvider)        — no extra hardware
 *   Tier C  OBD2 (ObdManager over an ObdTransport)               — lights up on connect
 *   Tier B  now-playing (MediaBridgeProvider)                    — needs the Kotlin module
 *   Tier D  body/CAN                                             — walled off (supported:false)
 *
 * Native only: the DataSourceProvider dynamic-imports this on native + live mode,
 * so none of the native deps reach the web bundle.
 */
import { AppState } from 'react-native';
import { startKeepAlive, stopKeepAlive } from '../../../modules/js-keepalive';
import { absent, live } from '../types';
import type { DashboardData, DataSource, History, NowPlaying, Signal } from '../types';
import { celsiusToFahrenheit, kmhToMph } from '../../lib/units';
import {
  ALT_SAMPLE_MI,
  ALT_SLOTS,
  accumFuel,
  avgMpg as deriveAvgMpg,
  estHp,
  estTorqueLbFt,
  initFuelAccum,
  initZeroSixty,
  gallonsPerHour,
  instantMpg,
  zeroSixtyStep,
  type FuelAccum,
  type ZeroSixtyState,
} from '../../lib/derive';
import { PIDS, TACOMA_TANK_L } from '../../lib/elm327';
import { loadCalibration, loadObdMac, saveCalibration, saveObdMac } from '../settings';
import { OBD_RETRY_SLOW_MS, obdRetryDelayMs, pickObdAdapter } from '../../lib/obdLink';
import { emaStep } from '../../lib/engineGlance';
import { LocationProvider } from './locationProvider';
import { SensorProvider } from './sensorProvider';
import { MediaBridgeProvider, type RadioPreset } from './mediaBridge';
import { MtcProvider } from './mtcProvider';
import { ConnectivityProvider } from './connectivityProvider';
import { ObdManager, type ObdDiagnostics, type Reading } from './obd/ObdManager';
import { ClassicSppTransport, hasBluetoothPermission, listBondedObdDevices } from './obd/ClassicSppTransport';
import type { ObdDevice } from './obd/transport';

const BACKGROUND_TICK_MS = 500;
const FUEL_DT_CAP_MS = 2000; // longest gap integrated as one fuel step
const HISTORY_LEN = 240; // matches SimulatedDataSource so the signature reads identically
const round = (v: number) => Math.round(v);
const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * OBD auto-connect state for SET: `off` = paused by DISCONNECT OBD; `waiting` = between
 * attempts; `no-adapter` / `no-permission` = waiting on something the driver must do once.
 */
export type ObdAutoState = 'off' | 'connected' | 'connecting' | 'waiting' | 'no-adapter' | 'no-permission';

/** Per-tier status the settings sheet shows. */
export interface LiveStatus {
  gpsPermission: 'granted' | 'denied' | 'undetermined';
  gpsFix: boolean;
  sensorsOnline: boolean;
  obdConnected: boolean;
  /** Bluetooth name of the connected OBD adapter (for the connect ticker) */
  obdAdapterName: string | null;
  obdAuto: ObdAutoState;
  /** ms until the next auto-connect attempt, when one is scheduled */
  obdRetryInMs: number | null;
  /** why the last attempt failed (shown under the auto-connect line) */
  obdLastError: string | null;
  /** the remembered adapter MAC auto-connect targets */
  obdSavedMac: string | null;
  mediaAvailable: boolean;
  mediaAccess: boolean;
}

/** Imperative controls the settings sheet drives (the live source only). */
export interface LiveControls {
  getStatus(): LiveStatus;
  calibrateLevel(): Promise<void>;
  calibrateForward(): Promise<void>;
  listObdDevices(): Promise<ObdDevice[]>;
  connectObd(mac?: string): Promise<void>;
  disconnectObd(): void;
  hasMediaAccess(): boolean;
  openMediaSettings(): void;
  refreshMedia(): Promise<void>;
  /** transport on the active (Bluetooth/app) session */
  mediaToggle(): void;
  mediaNext(): void;
  mediaPrevious(): void;
  /** the unit's FM/AM tuner session, when it publishes one */
  getRadio(): Promise<NowPlaying | null>;
  radioSeek(dir: 1 | -1): void;
  /** play/pause the FM tuner (play = switch the unit's audio to radio) */
  radioToggle(): void;
  /** the tuner's favourites (its session queue) with station logos */
  getRadioPresets(): Promise<RadioPreset[]>;
  radioPlayPreset(id: number): void;
  /** add the current station to the tuner's favourites (its own "Favorite" action) */
  radioFavorite(): Promise<boolean>;
  /** Mode 04: clear trouble codes + MIL (UNTESTED on the truck; key ON, engine OFF) */
  clearDtcs(): Promise<void>;
  /** per-PID health for SET → OBD DIAGNOSTICS; null when no link */
  getObdDiagnostics(): ObdDiagnostics | null;
}

interface SimOptsCompat {
  tickMs?: number;
}

export class LiveDataSource implements DataSource, LiveControls {
  private listeners = new Set<(d: DashboardData) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickMs: number;
  private frame = 0;

  private location = new LocationProvider();
  private sensors = new SensorProvider();
  private media = new MediaBridgeProvider();
  private connectivity = new ConnectivityProvider();
  private mtc = new MtcProvider();
  private obd: ObdManager | null = null;
  // ---- OBD auto-connect: remembered adapter + retry loop (src/lib/obdLink.ts) ----
  private started = false;
  private obdAttempt: Promise<void> | null = null;
  private obdAttemptId = 0;
  private obdAutoBusy = false; // one autoConnect (adapter pick + dial) at a time
  /** false after DISCONNECT OBD; re-armed by CONNECT, ignition-on, or an app restart */
  private obdAuto = true;
  private obdWait: 'waiting' | 'no-adapter' | 'no-permission' = 'waiting';
  private obdMac: string | null = null;
  private obdFailures = 0;
  private obdFailingSince: number | null = null;
  private obdRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private obdRetryAt: number | null = null;
  private obdLastError: string | null = null;
  private prevAcc: boolean | null = null;
  private appStateSub: { remove: () => void } | null = null;

  private histLongG = new Array(HISTORY_LEN).fill(0);
  private histSpeed = new Array(HISTORY_LEN).fill(0);
  private histAlt: number[] = []; // distance-sampled, grows to ALT_SLOTS
  private altNextAt: number | null = null; // trip distance (mi) of the next altitude sample

  private fuel: FuelAccum = initFuelAccum();
  private zeroSixty: ZeroSixtyState = initZeroSixty();
  private prevDistanceMi = 0;
  private lastFuelAt = 0; // wall time of the last fuel-integration step
  private prevGpsFix = false;
  private mpgSmooth: number | null = null; // ~2 s EMA of instant mpg (raw swings 5↔99)
  private mpgSmoothAt = 0;
  private snap: DashboardData = this.buildSnapshot();

  constructor(opts: SimOptsCompat = {}) {
    // 50ms ≈ 20fps. GPS is ~2Hz and the IMU is low-pass filtered, so rebuilding the
    // full snapshot faster than this only burns the JS thread (it starved touch/scroll
    // — see the audit). PulseTach's own follower interpolates the display, so the
    // gauges stay smooth regardless of this rate.
    this.tickMs = opts.tickMs ?? 50;
  }

  // ---- DataSource ------------------------------------------------------------
  start(): void {
    if (this.timer) return;
    void this.location.start();
    void this.sensors.start();
    this.media.start();
    this.connectivity.start();
    this.mtc.start();
    this.timer = setInterval(() => this.tick(), this.tickMs);

    // OBD: connect to the remembered adapter on our own, and keep trying until the truck
    // (and the dongle) wake up. A short delay lets the BT stack settle after boot.
    this.started = true;
    loadObdMac()
      .then((m) => {
        this.obdMac = m;
      })
      .catch(() => undefined)
      .finally(() => this.scheduleObd(1500));
    // keep JS timers running while another app is in front (CarPlay, the stock launcher
    // popping up on Bluetooth connect, a permission screen) — else OBD + MPG logging freeze
    void startKeepAlive();
    this.appStateSub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        this.setTickMs(this.tickMs);
        this.kickObd(false); // back on the launcher → try now, not at the next slot
      } else {
        // hidden: nothing to draw, so tick at 2 Hz — enough for fuel / distance integration
        // and the MPG log, light enough not to steal CPU from CarPlay video
        this.setTickMs(BACKGROUND_TICK_MS);
      }
    });
  }

  private setTickMs(ms: number) {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), ms);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.location.stop();
    this.sensors.stop();
    this.media.stop();
    this.connectivity.stop();
    this.mtc.stop();
    this.started = false;
    void stopKeepAlive();
    this.cancelObdRetry();
    this.appStateSub?.remove();
    this.appStateSub = null;
    this.obd?.disconnect();
    this.obd = null;
  }

  subscribe(listener: (d: DashboardData) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): DashboardData {
    return this.snap;
  }

  getHistory(): History {
    return { longG: this.histLongG, speed: this.histSpeed, altitude: this.histAlt };
  }

  // ---- frame tick ------------------------------------------------------------
  private tick(): DashboardData {
    this.frame++;
    const loc = this.location.getSnapshot();
    const sens = this.sensors.getSnapshot();

    // ignition on (Microntek ACC broadcast) → the dongle is waking: retry right away
    const acc = this.mtc.getSnapshot().acc;
    if (acc === true && this.prevAcc !== true) this.kickObd(true);
    this.prevAcc = acc;

    // effective speed for derived metrics: GPS first, OBD speed as fallback
    const obdSpeedKmh = this.obd?.read(PIDS.SPEED).value;
    const speedMph = loc.speedMph ?? (obdSpeedKmh != null ? kmhToMph(obdSpeedKmh) : 0);

    // 0–60 timer off GPS speed (smooth, no OBD latency)
    this.zeroSixty = zeroSixtyStep(this.zeroSixty, speedMph, Date.now() / 1000);

    // MPG: gallons from MAF over the REAL time since the last tick, miles from the GPS
    // distance delta. Measured dt matters: the old fixed 50 ms assumed a perfect 20 Hz,
    // but the 665 ticks slower (and at 2 Hz in the background), so gallons were
    // under-counted — trips logged 29–34 mpg (FACT, 2026-10-23). Idle fuel now counts too
    // (it's real fuel at the pump); only the MILES skip a GPS-just-restored step, whose
    // delta spans the whole dropout. dt is capped so a frozen/slept gap isn't integrated
    // with a stale airflow reading.
    const tickNow = Date.now();
    const dtMs = this.lastFuelAt ? Math.min(FUEL_DT_CAP_MS, tickNow - this.lastFuelAt) : 0;
    this.lastFuelAt = tickNow;
    const gpsJustRestored = loc.gpsFix && !this.prevGpsFix;
    if (this.obd?.connected && dtMs > 0) {
      const mafR = this.obd.read(PIDS.MAF);
      if (mafR.value != null && mafR.at != null && tickNow - mafR.at < 3000) {
        const dMiles = speedMph >= 1 && !gpsJustRestored ? Math.max(0, loc.distanceMi - this.prevDistanceMi) : 0;
        this.fuel = accumFuel(this.fuel, mafR.value, speedMph, dtMs / 3_600_000, dMiles);
      }
    }
    this.prevDistanceMi = loc.distanceMi;
    this.prevGpsFix = loc.gpsFix;

    // Tier B liveness: after the user grants Notification access at runtime nothing
    // re-arms the listener, so now-playing would sit empty until a track change. A
    // throttled poll (~1.5s, never per-frame) fills it in; cheap on the 665.
    if (this.frame % 30 === 0) {
      const m = this.media.getSnapshot();
      if (m.available && m.hasAccess && !m.nowPlaying) void this.media.refresh();
    }

    // altitude profile: one sample per ALT_SAMPLE_MI of distance (never per tick), and
    // only from a fresh fix — a held-over altitude would draw a fake flat
    if (loc.altitudeFt != null && loc.altitudeAt != null && Date.now() - loc.altitudeAt < 3000) {
      if (this.altNextAt == null || loc.distanceMi >= this.altNextAt) {
        this.histAlt.push(loc.altitudeFt);
        if (this.histAlt.length > ALT_SLOTS) this.histAlt.shift();
        this.altNextAt = loc.distanceMi + ALT_SAMPLE_MI;
      }
    }

    // history ring buffers (drop oldest)
    this.histLongG.push(sens.longG ?? 0);
    this.histLongG.shift();
    this.histSpeed.push(speedMph);
    this.histSpeed.shift();

    this.snap = this.buildSnapshot();
    this.listeners.forEach((l) => l(this.snap));
    return this.snap;
  }

  // ---- freshness helper ------------------------------------------------------
  private fresh(
    r: Reading,
    now: number,
    convert: (v: number) => number = (v) => v,
    liveMs = 3000,
    absentMs = 12000
  ): Signal<number> {
    if (r.value == null || r.at == null) return absent<number>();
    const age = now - r.at;
    if (age <= liveMs) return live(convert(r.value), r.at);
    if (age <= absentMs) return { value: convert(r.value), status: 'stale', updatedAt: r.at };
    return absent<number>();
  }

  private buildSnapshot(): DashboardData {
    const now = Date.now();
    const loc = this.location.getSnapshot();
    const sens = this.sensors.getSnapshot();
    const mediaState = this.media.getSnapshot();
    const net = this.connectivity.getSnapshot();
    const obd = this.obd;
    const obdUp = !!obd?.connected;

    // --- Tier A: GPS as fresh readings (per-field timestamps so carried-forward
    // values age to stale/absent instead of being stamped fresh) ---
    const gpsR = (v: number | null, at: number | null): Reading => ({ value: v, at: v != null ? at : null });
    const sensR = (v: number | null): Reading => ({ value: v, at: sens.online && v != null ? now : null });

    // --- Tier C: OBD-derived (only when connected) ---
    const effSpeedMph = loc.speedMph ?? (obd?.read(PIDS.SPEED).value != null ? kmhToMph(obd!.read(PIDS.SPEED).value!) : 0);
    const rpmReading = obd?.read(PIDS.RPM) ?? { value: null, at: null };
    const loadReading = obd?.read(PIDS.ENGINE_LOAD) ?? { value: null, at: null };
    const mafReading = obd?.read(PIDS.MAF) ?? { value: null, at: null };

    const rpm = rpmReading.value;
    const load = loadReading.value;
    const maf = mafReading.value;

    const rawMpg = obdUp && maf != null ? instantMpg(maf, effSpeedMph) : null;
    if (rawMpg == null) this.mpgSmooth = null; // idle / no link: restart the average
    else {
      this.mpgSmooth = emaStep(this.mpgSmooth, Math.min(rawMpg, 99), now - this.mpgSmoothAt, 2000);
      this.mpgSmoothAt = now;
    }
    const instMpg = rawMpg == null ? null : this.mpgSmooth;
    const hp = obdUp && rpm != null && load != null ? estHp(rpm, load) : null;
    const torque = hp != null && rpm != null ? estTorqueLbFt(hp, rpm) : null;
    // idle fuel now counts, so don't show a session average until there's real distance
    const avg = this.fuel.miles >= 0.5 ? deriveAvgMpg(this.fuel) : null;
    const zsResult = this.zeroSixty.result;

    const obdNum = (r: Reading, convert?: (v: number) => number): Signal<number> =>
      obdUp ? this.fresh(r, now, convert) : absent<number>();
    // SLOW-group PIDs refresh every few seconds by design (measured ~5–9 s on the truck):
    // give them a window that matches, so temps / volts / trims don't blink to a dash
    const obdSlow = (r: Reading, convert?: (v: number) => number): Signal<number> =>
      obdUp ? this.fresh(r, now, convert, 15_000, 45_000) : absent<number>();

    const nowPlaying: Signal<NowPlaying> =
      mediaState.available && mediaState.hasAccess && mediaState.nowPlaying
        ? live(mediaState.nowPlaying, now)
        : absent<NowPlaying>();

    const hour = new Date(now).getHours();

    return {
      frame: this.frame,
      motion: {
        speedMph: this.fresh(gpsR(loc.speedMph != null ? round(loc.speedMph) : null, loc.speedAt), now),
        headingDeg: this.fresh(gpsR(loc.headingDeg != null ? round(loc.headingDeg) : null, loc.headingAt), now),
        altitudeFt: this.fresh(gpsR(loc.altitudeFt != null ? round(loc.altitudeFt) : null, loc.altitudeAt), now),
        longG: this.fresh(sensR(sens.longG != null ? round2(sens.longG) : null), now, (v) => v, 500, 2000),
        latG: this.fresh(sensR(sens.latG != null ? round2(sens.latG) : null), now, (v) => v, 500, 2000),
        pitchDeg: this.fresh(sensR(sens.pitchDeg != null ? round(sens.pitchDeg) : null), now, (v) => v, 500, 2000),
        rollDeg: this.fresh(sensR(sens.rollDeg != null ? round(sens.rollDeg) : null), now, (v) => v, 500, 2000),
      },
      trip: {
        distanceMi: this.fresh(gpsR(round1(loc.distanceMi), loc.lastFixAt), now),
        movingTimeSec: this.fresh(gpsR(round(loc.movingTimeSec), loc.lastFixAt), now),
        avgSpeedMph: this.fresh(gpsR(round(loc.avgSpeedMph), loc.lastFixAt), now),
        // MAF-integrated gallons (FuelAccum) — only meaningful while OBD feeds it
        fuelGallons: obdUp ? live(Math.round(this.fuel.gallons * 1000) / 1000, now) : absent<number>(),
      },
      system: {
        // 12V: OBD control-module voltage (PID 42) when the dongle has it, else the
        // head unit's own input voltage via CarManager "battery" (FACT, 2026-10-21 — the
        // same source the stock status bar shows). Sim keeps its fake value.
        voltage: (() => {
          const fromObd = obdSlow(obd?.read(PIDS.CTRL_VOLTAGE) ?? { value: null, at: null }, round1);
          if (fromObd.status === 'live') return fromObd;
          const mtc = this.mtc.getSnapshot();
          return this.fresh({ value: mtc.voltage, at: mtc.voltageAt }, now, round1, 15000, 60000);
        })(),
        unitVoltage: (() => {
          const mtc = this.mtc.getSnapshot();
          return this.fresh({ value: mtc.voltage, at: mtc.voltageAt }, now, round1, 15000, 60000);
        })(),
        now,
        isDaylight: hour >= 7 && hour < 19,
        headlights: this.mtc.getSnapshot().headlights,
        gpsFix: loc.gpsFix,
        satellites: absent<number>(), // expo-location doesn't expose satellite count
        wifi: net.wifi,
        lte: net.lte,
        sensorsOnline: sens.online,
      },
      media: {
        nowPlaying,
        volume: absent<number>(), // no volume API in the media bridge yet
      },
      obd: {
        connected: obdUp,
        rpm: obdNum(rpmReading, round),
        throttlePct: obdNum(obd?.read(PIDS.THROTTLE) ?? { value: null, at: null }, round),
        engineLoadPct: obdNum(loadReading, round),
        coolantTempF: obdSlow(obd?.read(PIDS.COOLANT_TEMP) ?? { value: null, at: null }, (c) => round(celsiusToFahrenheit(c))),
        intakeTempF: obdSlow(obd?.read(PIDS.INTAKE_TEMP) ?? { value: null, at: null }, (c) => round(celsiusToFahrenheit(c))),
        oilTempF: obdSlow(obd?.read(PIDS.OIL_TEMP) ?? { value: null, at: null }, (c) => round(celsiusToFahrenheit(c))),
        ambientTempF: obdSlow(obd?.read(PIDS.AMBIENT_TEMP) ?? { value: null, at: null }, (c) => round(celsiusToFahrenheit(c))),
        // PID 2F isn't supported here; the EXPERIMENTAL meter probe (litres) fills it if it answers
        fuelLevelPct: (() => {
          const meter = obdUp ? this.fresh(obd!.fuelLevelL, now, (l) => round((l / TACOMA_TANK_L) * 100), 120_000, 360_000) : absent<number>();
          return meter.status !== 'absent' ? meter : obdSlow(obd?.read(PIDS.FUEL_LEVEL) ?? { value: null, at: null }, round);
        })(),
        instantMpg: obdUp && instMpg != null ? live(round1(instMpg), now) : absent<number>(),
        avgMpg: obdUp && avg != null ? live(round1(avg), now) : absent<number>(),
        runTimeSec: obdSlow(obd?.read(PIDS.RUNTIME) ?? { value: null, at: null }, round),
        baroKpa: obdSlow(obd?.read(PIDS.BARO) ?? { value: null, at: null }, round),
        estHp: obdUp && hp != null ? live(round(hp), now) : absent<number>(),
        estTorqueLbFt: obdUp && torque != null ? live(round(torque), now) : absent<number>(),
        dtcCount: obdUp ? this.fresh(obd!.dtcCount, now, round, 15000, 60000) : absent<number>(),
        milOn: obdUp && !!obd?.milOn,
        dtcCodes: (() => {
          const c = obd?.dtcCodes;
          return obdUp && c && c.codes && c.at ? live(c.codes, c.at) : absent<string[]>();
        })(),
        stftPct: obdSlow(obd?.read(PIDS.STFT_B1) ?? { value: null, at: null }, round1),
        ltftPct: obdSlow(obd?.read(PIDS.LTFT_B1) ?? { value: null, at: null }, round1),
        mapKpa: obdSlow(obd?.read(PIDS.MAP) ?? { value: null, at: null }, round),
        ecuVolts: obdSlow(obd?.read(PIDS.CTRL_VOLTAGE) ?? { value: null, at: null }, round1),
        // EXPERIMENTAL: polled rarely (every ~40 ticks), so allow it to stay live longer
        transTempF: obdUp
          ? this.fresh(obd!.transTempC, now, (c) => round(celsiusToFahrenheit(c)), 60000, 180000)
          : absent<number>(),
        zeroToSixtySec: zsResult != null ? live(round1(zsResult), now) : absent<number>(),
        fuelRateGph: (() => {
          const m = obdNum(mafReading);
          return m.status === 'absent' || m.value == null ? absent<number>() : { ...m, value: round2(gallonsPerHour(m.value)) };
        })(),
        mafGps: obdNum(mafReading, round1),
        ecuSpeedMph: obdNum(obd?.read(PIDS.SPEED) ?? { value: null, at: null }, (k) => round(kmhToMph(k))),
      },
      body: {
        supported: false,
        // the MCU's reverse ("backview") state — the one body signal the unit does publish
        reverseGear: (() => {
          const m = this.mtc.getSnapshot();
          return m.reverse != null ? live(m.reverse, m.reverseAt ?? now) : absent<boolean>();
        })(),
        acOn: absent<boolean>(),
      },
    };
  }

  // ---- LiveControls ----------------------------------------------------------
  getStatus(): LiveStatus {
    const loc = this.location.getSnapshot();
    return {
      gpsPermission: loc.permission,
      gpsFix: loc.gpsFix,
      sensorsOnline: this.sensors.getSnapshot().online,
      obdConnected: !!this.obd?.connected,
      obdAdapterName: this.obd?.adapterName ?? null,
      obdAuto: this.obd?.connected ? 'connected' : this.obdAttempt ? 'connecting' : !this.obdAuto ? 'off' : this.obdWait,
      obdRetryInMs: this.obdRetryAt != null ? Math.max(0, this.obdRetryAt - Date.now()) : null,
      obdLastError: this.obdLastError,
      obdSavedMac: this.obdMac,
      mediaAvailable: this.media.getSnapshot().available,
      mediaAccess: this.media.hasAccess(),
    };
  }

  async calibrateLevel(): Promise<void> {
    const cal = await this.sensors.calibrateLevel();
    await saveCalibration(cal);
  }

  async calibrateForward(): Promise<void> {
    const cal = await this.sensors.calibrateForward();
    await saveCalibration(cal);
  }

  async listObdDevices(): Promise<ObdDevice[]> {
    return listBondedObdDevices();
  }

  /** SET → CONNECT (or a device row). Also re-arms auto-connect. */
  async connectObd(mac?: string): Promise<void> {
    this.obdAuto = true;
    if (this.obd?.connected) return;
    if (this.obdAttempt) {
      // an auto attempt is already dialing — let it finish rather than racing it
      await this.obdAttempt.catch(() => undefined);
      if (this.obd?.connected) return;
    }
    this.cancelObdRetry();
    try {
      await this.attemptObd(mac ?? this.obdMac ?? undefined, true);
    } catch (e) {
      this.noteObdFailure(e);
      throw e;
    }
  }

  /** SET → DISCONNECT OBD. Pauses auto-connect until CONNECT / ignition-on / restart. */
  disconnectObd(): void {
    this.obdAuto = false;
    this.cancelObdRetry();
    this.obd?.disconnect();
    this.obd = null;
    this.fuel = initFuelAccum();
  }

  // ---- OBD auto-connect ------------------------------------------------------
  /** One connect attempt; concurrent callers share it. Remembers the adapter on success. */
  private attemptObd(mac: string | undefined, interactive: boolean): Promise<void> {
    if (this.obdAttempt) return this.obdAttempt;
    const id = ++this.obdAttemptId;
    const p = (async () => {
      try {
        await this.dialObd(mac, interactive);
      } finally {
        // cleared here (not in a .finally chain) so a caller resuming after this attempt
        // settles never gets handed the old, already-failed promise
        if (this.obdAttemptId === id) this.obdAttempt = null;
      }
    })();
    this.obdAttempt = p;
    return p;
  }

  private async dialObd(mac: string | undefined, interactive: boolean): Promise<void> {
    const transport = new ClassicSppTransport(mac, { interactive });
    const manager = new ObdManager();
    manager.onDrop(() => this.onObdDropped(manager));
    this.obd = manager;
    try {
      await manager.connect(transport);
    } catch (e) {
      manager.disconnect();
      if (this.obd === manager) this.obd = null;
      throw e;
    }
    if (!this.started) {
      // the source was stopped (sim switch) while we were dialing
      manager.disconnect();
      if (this.obd === manager) this.obd = null;
      return;
    }
    this.obdFailures = 0;
    this.obdFailingSince = null;
    this.obdLastError = null;
    this.obdWait = 'waiting';
    const addr = transport.linkAddress;
    if (addr && addr !== this.obdMac) {
      this.obdMac = addr;
      void saveObdMac(addr);
    }
  }

  /** Timer / kick entry point: pick the adapter silently and try once. */
  private async autoConnect(): Promise<void> {
    if (!this.started || !this.obdAuto || this.obd?.connected || this.obdAttempt || this.obdAutoBusy) return;
    this.obdAutoBusy = true;
    try {
      await this.autoConnectOnce();
    } finally {
      this.obdAutoBusy = false;
    }
  }

  private async autoConnectOnce(): Promise<void> {
    let mac: string | null;
    try {
      if (!(await hasBluetoothPermission())) {
        this.noteObdFailure(new Error('Bluetooth permission needed — tap CONNECT once'), 'no-permission', OBD_RETRY_SLOW_MS);
        return;
      }
      mac = pickObdAdapter(await listBondedObdDevices(), this.obdMac);
    } catch (e) {
      this.noteObdFailure(e); // e.g. Bluetooth still off right after boot
      return;
    }
    if (!mac) {
      this.noteObdFailure(new Error('No paired OBD adapter — pair it in Android Bluetooth'), 'no-adapter');
      return;
    }
    if (!this.started || !this.obdAuto || this.obd?.connected) return;
    try {
      await this.attemptObd(mac, false);
    } catch (e) {
      this.noteObdFailure(e);
    }
  }

  private noteObdFailure(e: unknown, wait: 'waiting' | 'no-adapter' | 'no-permission' = 'waiting', minDelayMs = 0) {
    const now = Date.now();
    this.obdFailures++;
    if (this.obdFailingSince == null) this.obdFailingSince = now;
    this.obdLastError = e instanceof Error ? e.message : String(e);
    this.obdWait = wait;
    this.scheduleObd(Math.max(minDelayMs, obdRetryDelayMs(this.obdFailures, now - this.obdFailingSince)));
  }

  private onObdDropped(manager: ObdManager) {
    if (this.obd !== manager) return;
    manager.disconnect(); // release the dead socket + listeners
    this.obd = null;
    // the drive isn't over just because the link blinked: keep the fuel tally, redial soon
    this.obdFailures = 0;
    this.obdFailingSince = null;
    this.obdWait = 'waiting';
    this.scheduleObd(2000);
  }

  /** Ignition-on / foreground: reset the backoff and try now (if not already linked). */
  private kickObd(ignition: boolean) {
    if (!this.started) return;
    if (ignition) this.obdAuto = true; // a new drive re-arms a manual DISCONNECT
    if (!this.obdAuto || this.obd?.connected || this.obdAttempt) return;
    this.obdFailures = 0;
    this.obdFailingSince = null;
    this.scheduleObd(0);
  }

  private scheduleObd(delayMs: number) {
    this.cancelObdRetry();
    if (!this.started || !this.obdAuto) return;
    this.obdRetryAt = Date.now() + delayMs;
    this.obdRetryTimer = setTimeout(() => {
      this.obdRetryTimer = null;
      this.obdRetryAt = null;
      void this.autoConnect();
    }, delayMs);
  }

  private cancelObdRetry() {
    if (this.obdRetryTimer) clearTimeout(this.obdRetryTimer);
    this.obdRetryTimer = null;
    this.obdRetryAt = null;
  }

  async clearDtcs(): Promise<void> {
    if (!this.obd?.connected) throw new Error('OBD not connected');
    await this.obd.clearDtcs();
  }

  getObdDiagnostics(): ObdDiagnostics | null {
    return this.obd ? this.obd.diagnostics() : null;
  }

  hasMediaAccess(): boolean {
    return this.media.hasAccess();
  }
  openMediaSettings(): void {
    this.media.openSettings();
  }
  async refreshMedia(): Promise<void> {
    await this.media.refresh();
  }
  mediaToggle(): void {
    this.media.toggle();
  }
  mediaNext(): void {
    this.media.next();
  }
  mediaPrevious(): void {
    this.media.previous();
  }
  getRadio(): Promise<NowPlaying | null> {
    return this.media.radio();
  }
  radioSeek(dir: 1 | -1): void {
    this.media.radioSeek(dir);
  }
  radioToggle(): void {
    this.media.radioToggle();
  }
  getRadioPresets(): Promise<RadioPreset[]> {
    return this.media.radioPresets();
  }
  radioPlayPreset(id: number): void {
    this.media.radioPlayPreset(id);
  }
  radioFavorite(): Promise<boolean> {
    return this.media.radioFavorite();
  }

  /** Load any persisted IMU calibration. Call before start(). */
  async hydrate(): Promise<void> {
    const cal = await loadCalibration();
    if (cal) this.sensors.setCalibration(cal);
  }
}
