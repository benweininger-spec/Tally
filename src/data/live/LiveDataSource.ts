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
  instantMpg,
  zeroSixtyStep,
  type FuelAccum,
  type ZeroSixtyState,
} from '../../lib/derive';
import { PIDS } from '../../lib/elm327';
import { loadCalibration, saveCalibration } from '../settings';
import { LocationProvider } from './locationProvider';
import { SensorProvider } from './sensorProvider';
import { MediaBridgeProvider } from './mediaBridge';
import { MtcProvider } from './mtcProvider';
import { ConnectivityProvider } from './connectivityProvider';
import { ObdManager, type Reading } from './obd/ObdManager';
import { ClassicSppTransport, listBondedObdDevices } from './obd/ClassicSppTransport';
import type { ObdDevice } from './obd/transport';

const HISTORY_LEN = 240; // matches SimulatedDataSource so the signature reads identically
const round = (v: number) => Math.round(v);
const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Per-tier status the settings sheet shows. */
export interface LiveStatus {
  gpsPermission: 'granted' | 'denied' | 'undetermined';
  gpsFix: boolean;
  sensorsOnline: boolean;
  obdConnected: boolean;
  /** Bluetooth name of the connected OBD adapter (for the connect ticker) */
  obdAdapterName: string | null;
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
  /** Mode 04: clear trouble codes + MIL (UNTESTED on the truck; key ON, engine OFF) */
  clearDtcs(): Promise<void>;
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
  private obdConnecting = false;

  private histLongG = new Array(HISTORY_LEN).fill(0);
  private histSpeed = new Array(HISTORY_LEN).fill(0);
  private histAlt: number[] = []; // distance-sampled, grows to ALT_SLOTS
  private altNextAt: number | null = null; // trip distance (mi) of the next altitude sample

  private fuel: FuelAccum = initFuelAccum();
  private zeroSixty: ZeroSixtyState = initZeroSixty();
  private prevDistanceMi = 0;
  private prevGpsFix = false;
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
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.location.stop();
    this.sensors.stop();
    this.media.stop();
    this.connectivity.stop();
    this.mtc.stop();
    this.obd?.disconnect();
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

    // effective speed for derived metrics: GPS first, OBD speed as fallback
    const obdSpeedKmh = this.obd?.read(PIDS.SPEED).value;
    const speedMph = loc.speedMph ?? (obdSpeedKmh != null ? kmhToMph(obdSpeedKmh) : 0);

    // 0–60 timer off GPS speed (smooth, no OBD latency)
    this.zeroSixty = zeroSixtyStep(this.zeroSixty, speedMph, Date.now() / 1000);

    // average MPG: gallons from MAF, miles from GPS distance delta. Skip while idling
    // (speed<1 would burn gallons over ~0 miles and drag avg toward 0), and skip the
    // step where GPS just came back (its distance delta spans the whole dropout).
    const gpsJustRestored = loc.gpsFix && !this.prevGpsFix;
    if (this.obd?.connected && speedMph >= 1 && !gpsJustRestored) {
      const maf = this.obd.read(PIDS.MAF).value;
      if (maf != null) {
        const dMiles = Math.max(0, loc.distanceMi - this.prevDistanceMi);
        this.fuel = accumFuel(this.fuel, maf, speedMph, this.tickMs / 3_600_000, dMiles);
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

    const instMpg = obdUp && maf != null ? instantMpg(maf, effSpeedMph) : null;
    const hp = obdUp && rpm != null && load != null ? estHp(rpm, load) : null;
    const torque = hp != null && rpm != null ? estTorqueLbFt(hp, rpm) : null;
    const avg = deriveAvgMpg(this.fuel);
    const zsResult = this.zeroSixty.result;

    const obdNum = (r: Reading, convert?: (v: number) => number): Signal<number> =>
      obdUp ? this.fresh(r, now, convert) : absent<number>();

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
          const fromObd = obdNum(obd?.read(PIDS.CTRL_VOLTAGE) ?? { value: null, at: null }, round1);
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
        coolantTempF: obdNum(obd?.read(PIDS.COOLANT_TEMP) ?? { value: null, at: null }, (c) => round(celsiusToFahrenheit(c))),
        intakeTempF: obdNum(obd?.read(PIDS.INTAKE_TEMP) ?? { value: null, at: null }, (c) => round(celsiusToFahrenheit(c))),
        oilTempF: obdNum(obd?.read(PIDS.OIL_TEMP) ?? { value: null, at: null }, (c) => round(celsiusToFahrenheit(c))),
        ambientTempF: obdNum(obd?.read(PIDS.AMBIENT_TEMP) ?? { value: null, at: null }, (c) => round(celsiusToFahrenheit(c))),
        fuelLevelPct: obdNum(obd?.read(PIDS.FUEL_LEVEL) ?? { value: null, at: null }, round),
        instantMpg: obdUp && instMpg != null ? live(round1(instMpg), now) : absent<number>(),
        avgMpg: obdUp && avg != null ? live(round1(avg), now) : absent<number>(),
        runTimeSec: obdNum(obd?.read(PIDS.RUNTIME) ?? { value: null, at: null }, round),
        baroKpa: obdNum(obd?.read(PIDS.BARO) ?? { value: null, at: null }, round),
        estHp: obdUp && hp != null ? live(round(hp), now) : absent<number>(),
        estTorqueLbFt: obdUp && torque != null ? live(round(torque), now) : absent<number>(),
        dtcCount: obdUp ? this.fresh(obd!.dtcCount, now, round, 15000, 60000) : absent<number>(),
        milOn: obdUp && !!obd?.milOn,
        dtcCodes: (() => {
          const c = obd?.dtcCodes;
          return obdUp && c && c.codes && c.at ? live(c.codes, c.at) : absent<string[]>();
        })(),
        stftPct: obdNum(obd?.read(PIDS.STFT_B1) ?? { value: null, at: null }, round1),
        ltftPct: obdNum(obd?.read(PIDS.LTFT_B1) ?? { value: null, at: null }, round1),
        mapKpa: obdNum(obd?.read(PIDS.MAP) ?? { value: null, at: null }, round),
        ecuVolts: obdNum(obd?.read(PIDS.CTRL_VOLTAGE) ?? { value: null, at: null }, round1),
        // EXPERIMENTAL: polled rarely (every ~40 ticks), so allow it to stay live longer
        transTempF: obdUp
          ? this.fresh(obd!.transTempC, now, (c) => round(celsiusToFahrenheit(c)), 60000, 180000)
          : absent<number>(),
        zeroToSixtySec: zsResult != null ? live(round1(zsResult), now) : absent<number>(),
      },
      body: {
        supported: false,
        reverseGear: absent<boolean>(),
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

  async connectObd(mac?: string): Promise<void> {
    if (this.obdConnecting || this.obd?.connected) return;
    this.obdConnecting = true;
    try {
      const transport = new ClassicSppTransport(mac);
      const manager = new ObdManager();
      this.obd = manager;
      await manager.connect(transport);
    } catch (e) {
      this.obd?.disconnect();
      this.obd = null;
      throw e;
    } finally {
      this.obdConnecting = false;
    }
  }

  disconnectObd(): void {
    this.obd?.disconnect();
    this.obd = null;
    this.fuel = initFuelAccum();
  }

  async clearDtcs(): Promise<void> {
    if (!this.obd?.connected) throw new Error('OBD not connected');
    await this.obd.clearDtcs();
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

  /** Load any persisted IMU calibration. Call before start(). */
  async hydrate(): Promise<void> {
    const cal = await loadCalibration();
    if (cal) this.sensors.setCalibration(cal);
  }
}
