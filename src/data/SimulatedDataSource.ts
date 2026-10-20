/**
 * Drives the whole UI from believable fake telemetry so the design can be built
 * and judged with zero hardware. This is the ONLY data source in milestone 1.
 *
 * Runtime-self-contained on purpose: it imports *types only* from ./types, so it
 * can be executed standalone by `node --experimental-strip-types` for tests
 * (see scripts/verify.ts). Do not add runtime relative imports here.
 */
import type {
  DashboardData,
  DataSource,
  History,
  NowPlaying,
  Signal,
} from './types';

// local Signal constructors (kept inline so this file has no runtime imports)
const mk = <T>(value: T): Signal<T> => ({ value, status: 'live', updatedAt: Date.now() });
const no = <T>(): Signal<T> => ({ value: null, status: 'absent', updatedAt: null });

const HISTORY_LEN = 240; // samples shown in the scrolling waveform window
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export interface SimOptions {
  /** ms between frames. 33 ≈ 30fps. */
  tickMs?: number;
  /** start with the OBD dongle "connected" so RPM + engine data are live */
  obdConnected?: boolean;
  /** deterministic seed for repeatable runs/tests */
  seed?: number;
}

const PLAYLIST: Omit<NowPlaying, 'isPlaying' | 'positionMs' | 'source'>[] = [
  { title: 'Disorder', artist: 'Joy Division', album: 'Unknown Pleasures', artUri: null, durationMs: 209000 },
  { title: 'Midnight City', artist: 'M83', album: 'Hurry Up, We’re Dreaming', artUri: null, durationMs: 244000 },
  { title: 'Nightcall', artist: 'Kavinsky', album: 'OutRun', artUri: null, durationMs: 258000 },
];

export class SimulatedDataSource implements DataSource {
  private opts: Required<SimOptions>;
  private listeners = new Set<(d: DashboardData) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  private frame = 0;
  private rngState: number;

  // continuous physical state
  private speed = 28; // mph
  private targetSpeed = 38;
  private heading = 312; // deg
  private headingRate = 0; // deg/s
  private altitude = 1284; // ft
  private pitch = 2;
  private roll = -1;
  private longG = 0;
  private latG = 0;
  private trip = 128.6;
  private movingSec = 12250;
  private voltage = 14.2;

  // discrete
  private trackIndex = 0;
  private trackPosMs = 42000;

  // history ring buffers
  private histLongG: number[];
  private histSpeed: number[];

  constructor(options: SimOptions = {}) {
    this.opts = {
      tickMs: options.tickMs ?? 50, // 20fps — see LiveDataSource; the follower keeps gauges smooth
      obdConnected: options.obdConnected ?? true,
      seed: options.seed ?? 1337,
    };
    this.rngState = this.opts.seed >>> 0;
    this.histLongG = new Array(HISTORY_LEN).fill(0);
    this.histSpeed = new Array(HISTORY_LEN).fill(this.speed);
  }

  // small deterministic PRNG (mulberry32)
  private rnd(): number {
    let t = (this.rngState += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  setObdConnected(connected: boolean) {
    this.opts.obdConnected = connected;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.opts.tickMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  subscribe(listener: (d: DashboardData) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getHistory(): History {
    return { longG: this.histLongG, speed: this.histSpeed };
  }

  /** Advance the simulation one frame. Public so tests can step deterministically. */
  tick(): DashboardData {
    const dt = this.opts.tickMs / 1000;
    this.frame++;

    // occasionally pick a new target speed (accel/cruise/brake intent)
    if (this.frame % 90 === 0 || this.rnd() < 0.01) {
      this.targetSpeed = clamp(this.targetSpeed + (this.rnd() - 0.45) * 30, 0, 72);
    }
    // approach target -> derive longitudinal g from acceleration
    const prevSpeed = this.speed;
    const accelMphPerS = clamp((this.targetSpeed - this.speed) * 0.6, -9, 7);
    this.speed = clamp(this.speed + accelMphPerS * dt, 0, 80);
    // 1 g ≈ 21.94 mph/s
    const rawLongG = (this.speed - prevSpeed) / dt / 21.94;
    this.longG = this.longG * 0.7 + rawLongG * 0.3 + (this.rnd() - 0.5) * 0.01;

    // cornering: wander heading, lateral g from yaw rate * speed
    if (this.frame % 70 === 0) this.headingRate = (this.rnd() - 0.5) * 24; // deg/s
    this.headingRate *= 0.96;
    this.heading = (this.heading + this.headingRate * dt + 360) % 360;
    const yawRad = (this.headingRate * Math.PI) / 180;
    const rawLatG = (this.speed * 0.447 * yawRad) / 9.81; // v(m/s)*omega / g
    this.latG = this.latG * 0.8 + rawLatG * 0.2;

    // terrain
    this.altitude += (this.rnd() - 0.48) * 2.2;
    this.pitch = clamp(this.pitch + (this.rnd() - 0.5) * 0.6 - this.pitch * 0.02, -16, 18);
    this.roll = clamp(this.roll + (this.rnd() - 0.5) * 0.5 - this.roll * 0.03, -14, 14);

    // trip + electrical
    this.trip += (this.speed * dt) / 3600;
    if (this.speed > 1) this.movingSec += dt;
    this.voltage = clamp(13.9 + this.longG * 0.4 + (this.rnd() - 0.5) * 0.06, 12.0, 14.8);

    // media transport
    if (this.frame % 30 === 0) {
      this.trackPosMs += 1000;
      const dur = PLAYLIST[this.trackIndex].durationMs;
      if (this.trackPosMs >= dur) {
        this.trackPosMs = 0;
        this.trackIndex = (this.trackIndex + 1) % PLAYLIST.length;
      }
    }

    // push history (drop oldest)
    this.histLongG.push(this.longG);
    this.histLongG.shift();
    this.histSpeed.push(this.speed);
    this.histSpeed.shift();

    const snap = this.snapshot();
    this.listeners.forEach((l) => l(snap));
    return snap;
  }

  getSnapshot(): DashboardData {
    return this.snapshot();
  }

  // ---- derive an OBD view from physical state (when "connected") ----
  private deriveRpm(): number {
    // crude gear model: pick gear from speed, map to rpm band
    const ratios = [0, 45, 70, 95, 120, 150]; // mph per 1000rpm-ish breakpoints
    let gear = 1;
    for (let g = ratios.length - 1; g >= 1; g--) {
      if (this.speed >= (g - 1) * 12) {
        gear = g;
        break;
      }
    }
    const base = 800 + (this.speed / (ratios[gear] || 60)) * 1000 * (6 - gear) * 0.55;
    const throttleKick = Math.max(0, this.longG) * 1400;
    return clamp(base + throttleKick, 700, 5200);
  }

  private snapshot(): DashboardData {
    const obd = this.opts.obdConnected;
    const rpm = this.deriveRpm();
    const throttle = clamp(20 + Math.max(0, this.longG) * 90 + (this.speed > this.targetSpeed ? -15 : 10), 0, 100);
    const load = clamp(throttle * 0.8 + 15, 0, 100);
    const hour = new Date().getHours();

    const track = PLAYLIST[this.trackIndex];
    const nowPlaying: NowPlaying = {
      ...track,
      isPlaying: true,
      positionMs: this.trackPosMs,
      source: 'BLUETOOTH A2DP',
    };

    return {
      frame: this.frame,
      motion: {
        speedMph: mk(Math.round(this.speed)),
        headingDeg: mk(Math.round(this.heading)),
        altitudeFt: mk(Math.round(this.altitude)),
        longG: mk(round2(this.longG)),
        latG: mk(round2(this.latG)),
        pitchDeg: mk(Math.round(this.pitch)),
        rollDeg: mk(Math.round(this.roll)),
      },
      trip: {
        distanceMi: mk(round1(this.trip)),
        movingTimeSec: mk(Math.round(this.movingSec)),
        avgSpeedMph: mk(Math.round((this.trip / (this.movingSec / 3600)) || 0)),
      },
      system: {
        voltage: mk(round1(this.voltage)),
        now: Date.now(),
        isDaylight: hour >= 7 && hour < 19,
        gpsFix: true,
        satellites: mk(11),
        wifi: true,
        lte: true,
        sensorsOnline: true,
      },
      media: {
        nowPlaying: mk(nowPlaying),
        volume: mk(0.6),
      },
      obd: {
        connected: obd,
        rpm: obd ? mk(Math.round(rpm)) : no(),
        throttlePct: obd ? mk(Math.round(throttle)) : no(),
        engineLoadPct: obd ? mk(Math.round(load)) : no(),
        coolantTempF: obd ? mk(196) : no(),
        intakeTempF: obd ? mk(88) : no(),
        oilTempF: obd ? mk(210) : no(),
        ambientTempF: obd ? mk(79) : no(),
        fuelLevelPct: obd ? mk(64) : no(),
        instantMpg: obd ? mk(round1(clamp(60 - this.speed * 0.4 - Math.max(0, this.longG) * 30, 4, 55))) : no(),
        avgMpg: obd ? mk(21.3) : no(),
        runTimeSec: obd ? mk(this.movingSec) : no(),
        baroKpa: obd ? mk(98) : no(),
        estHp: obd ? mk(Math.round((rpm / 5200) * 159 * (load / 100))) : no(),
        estTorqueLbFt: obd ? mk(Math.round(180 * (load / 100))) : no(),
        dtcCount: obd ? mk(0) : no(),
        // optional field — sim leaves it absent (a 0–60 only exists right after a run)
        zeroToSixtySec: no(),
      },
      body: {
        supported: false,
        reverseGear: no(),
        acOn: no(),
      },
    };
  }
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
