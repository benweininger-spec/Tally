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
// altitude profile — mirrors ALT_SAMPLE_MI / ALT_SLOTS in src/lib/derive.ts (inlined:
// this file must stay free of runtime imports for the Node verifier)
const ALT_SAMPLE_MI = 0.02;
const ALT_SLOTS = 250;
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
  private gallons = 0; // MAF-style fuel burned while "OBD" is connected
  private transTemp = 150; // °F, warms toward ~175 while driving

  // discrete
  private trackIndex = 0;
  private trackPosMs = 42000;

  // history ring buffers
  private histLongG: number[];
  private histSpeed: number[];
  private histAlt: number[] = [];
  private altNextAt = 0; // trip distance (mi) of the next altitude sample

  // rolling terrain: altitude as a function of DISTANCE (amplitude ft, wavelength mi,
  // phase) — so climbing/descending tracks the miles driven and the grade is coherent
  private terrain: [number, number, number][] = [];
  private terrainBase = 1284;

  constructor(options: SimOptions = {}) {
    this.opts = {
      tickMs: options.tickMs ?? 50, // 20fps — see LiveDataSource; the follower keeps gauges smooth
      obdConnected: options.obdConnected ?? true,
      seed: options.seed ?? 1337,
    };
    this.rngState = this.opts.seed >>> 0;
    this.histLongG = new Array(HISTORY_LEN).fill(0);
    this.histSpeed = new Array(HISTORY_LEN).fill(this.speed);

    // seeded rolling hills: a long swell, mid rollers, short dips (max grade ≈ 15%)
    this.terrain = [
      [140, 3.0, this.rnd() * Math.PI * 2],
      [40, 0.8, this.rnd() * Math.PI * 2],
      [8, 0.2, this.rnd() * Math.PI * 2],
    ];
    // pre-fill the last ~5 mi so the profile reads complete from the first frame
    for (let i = ALT_SLOTS - 1; i >= 0; i--) this.histAlt.push(this.terrainAt(this.trip - i * ALT_SAMPLE_MI));
    this.altNextAt = this.trip + ALT_SAMPLE_MI;
    this.altitude = this.terrainAt(this.trip);
  }

  private terrainAt(mi: number): number {
    let alt = this.terrainBase;
    for (const [amp, wl, ph] of this.terrain) alt += amp * Math.sin((2 * Math.PI * mi) / wl + ph);
    return alt;
  }

  /** terrain slope at `mi`, ft per ft (rise / run) */
  private slopeAt(mi: number): number {
    let dAltPerMi = 0;
    for (const [amp, wl, ph] of this.terrain) dAltPerMi += ((amp * 2 * Math.PI) / wl) * Math.cos((2 * Math.PI * mi) / wl + ph);
    return dAltPerMi / 5280;
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

  // null = follow the wall clock (7am–7pm); true/false = force day / night (SET → SIM)
  private daylightOverride: boolean | null = null;
  setDaylightOverride(v: boolean | null) {
    this.daylightOverride = v;
  }
  getDaylightOverride(): boolean | null {
    return this.daylightOverride;
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
    return { longG: this.histLongG, speed: this.histSpeed, altitude: this.histAlt };
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

    // trip + electrical
    this.trip += (this.speed * dt) / 3600;
    if (this.opts.obdConnected) {
      // fuel: miles / instant mpg while moving, ~0.25 gal/h at idle
      const dMi = (this.speed * dt) / 3600;
      this.gallons += this.speed >= 1 ? dMi / this.simInstantMpg() : (0.25 * dt) / 3600;
    }
    this.transTemp += ((150 + this.speed * 0.4) - this.transTemp) * dt * 0.02;

    // terrain follows distance; pitch leans toward the road grade (plus body motion)
    this.altitude = this.terrainAt(this.trip) + (this.rnd() - 0.5) * 0.6;
    const gradeDeg = (Math.atan(this.slopeAt(this.trip)) * 180) / Math.PI;
    this.pitch = clamp(this.pitch + (gradeDeg - this.pitch) * 0.05 + (this.rnd() - 0.5) * 0.6, -16, 18);
    this.roll = clamp(this.roll + (this.rnd() - 0.5) * 0.5 - this.roll * 0.03, -14, 14);
    while (this.trip >= this.altNextAt) {
      this.histAlt.push(this.altitude);
      if (this.histAlt.length > ALT_SLOTS) this.histAlt.shift();
      this.altNextAt += ALT_SAMPLE_MI;
    }
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

  /** Tacoma-believable: ~24–26 cruising at 40–50, single digits pulling away, high coasting. */
  private simInstantMpg(): number {
    const cruise = 26 - Math.abs(this.speed - 45) * 0.12;
    const accel = Math.max(0, this.longG) * 45;
    const coast = this.longG < -0.04 ? 18 : 0;
    return clamp(cruise - accel + coast, 5, 60);
  }

  /** gal/h: speed ÷ mpg on the move, ~0.3 at idle (the 2TR-FE measured 0.30 at 750 rpm) */
  private simFuelRate(): number {
    return this.speed >= 1 ? this.speed / this.simInstantMpg() : 0.3;
  }

  // ---- derive an OBD view from physical state (when "connected") ----
  /**
   * The truck's real driveline: AC60E 6-speed ratios × K (axle 3.909, 245/75R16 ≈ 43.1
   * rpm/mph per unit ratio — the same numbers src/lib/gear.ts reads gears back out of; kept
   * inline because this file must stay runtime-self-contained). Upshift points by speed.
   */
  private deriveRpm(): number {
    const ratios = [3.6, 2.09, 1.488, 1.0, 0.687, 0.58];
    const upAt = [0, 13, 22, 32, 41, 48]; // mph where each gear takes over
    let g = 0;
    for (let i = upAt.length - 1; i >= 0; i--) {
      if (this.speed >= upAt[i]) {
        g = i;
        break;
      }
    }
    const rpm = this.speed * 43.1 * ratios[g] * (g < 2 ? 1.06 : 1); // a little converter slip low
    return clamp(Math.max(720, rpm), 700, 5200);
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
        fuelGallons: obd ? mk(Math.round(this.gallons * 1000) / 1000) : no(),
      },
      system: {
        voltage: mk(round1(this.voltage)),
        unitVoltage: mk(round1(this.voltage - 0.3)), // the head unit sees a bit less than the alternator
        now: Date.now(),
        isDaylight: this.daylightOverride ?? (hour >= 7 && hour < 19),
        headlights: null,
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
        // the real 2TR-FE doesn't report tank level (no PID 2F) — the sim matches, so the
        // preview shows the fill-up estimate path the truck actually uses
        fuelLevelPct: no(),
        instantMpg: obd ? mk(round1(this.simInstantMpg())) : no(),
        avgMpg: obd ? mk(21.3) : no(),
        runTimeSec: obd ? mk(this.movingSec) : no(),
        baroKpa: obd ? mk(98) : no(),
        estHp: obd ? mk(Math.round((rpm / 5200) * 159 * (load / 100))) : no(),
        estTorqueLbFt: obd ? mk(Math.round(180 * (load / 100))) : no(),
        // one demo code so the CHECK ENGINE card shows its populated state in the preview
        dtcCount: obd ? mk(1) : no(),
        milOn: obd,
        dtcCodes: obd ? mk(['P0420']) : no(),
        stftPct: obd ? mk(round1(4 * Math.sin(this.frame / 37) + (this.rnd() - 0.5))) : no(),
        ltftPct: obd ? mk(2.3) : no(),
        mapKpa: obd ? mk(Math.round(28 + load * 0.7)) : no(),
        ecuVolts: obd ? mk(round1(this.voltage)) : no(),
        transTempF: obd ? mk(Math.round(this.transTemp)) : no(),
        // a believable last run so the ENGINE face's 0–60 tile is lit in the preview
        zeroToSixtySec: obd ? mk(9.4) : no(),
        fuelRateGph: obd ? mk(Math.round(this.simFuelRate() * 100) / 100) : no(),
        // gal/h → g/s: ×3600 / (14.7 AFR × 6.17 lb/gal × 453.592 g/lb)
        mafGps: obd ? mk(round1(this.simFuelRate() / 0.0874)) : no(),
        ecuSpeedMph: obd ? mk(Math.round(this.speed * 1.02)) : no(),
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
