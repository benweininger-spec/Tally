/**
 * Data contract for the dashboard.
 *
 * Everything the UI renders comes through this layer. The render tree NEVER
 * imports a concrete source (sim, GPS, OBD) — it binds to `DashboardData` only.
 * Swapping `SimulatedDataSource` for a future `LiveDataSource` must not touch a
 * single component. See docs/ARCHITECTURE.md.
 *
 * Tiers (from docs/design-brief.md §3):
 *   A — live now: GPS, onboard sensors, system voltage
 *   B — phone & media over Bluetooth / local apps
 *   C — full OBD2 (dongle on order; design for it, light it up on connect)
 *   D — head-unit CAN body signals (walled off; not a real source)
 */

/** Whether a signal is currently feeding real data. */
export type SignalStatus = 'live' | 'stale' | 'absent';

/**
 * A single readout. `value` is null whenever `status !== 'live'`.
 * The whole point: a field can exist in the layout while being `absent`,
 * so the UI can decide to hide it, dim it, or show a connect affordance —
 * never a broken empty gauge.
 */
export interface Signal<T> {
  value: T | null;
  status: SignalStatus;
  /** epoch ms of last real update, if ever */
  updatedAt: number | null;
}

export const absent = <T>(): Signal<T> => ({ value: null, status: 'absent', updatedAt: null });
export const live = <T>(value: T, at = Date.now()): Signal<T> => ({ value, status: 'live', updatedAt: at });

/** Convenience: is there a usable value right now? */
export const has = <T>(s: Signal<T>): s is Signal<T> & { value: T } =>
  s.status !== 'absent' && s.value !== null;

// ----------------------------------------------------------------------------
// Tier A — GPS + onboard sensors + system (live today, zero hardware)
// ----------------------------------------------------------------------------
export interface MotionData {
  speedMph: Signal<number>;
  headingDeg: Signal<number>;
  altitudeFt: Signal<number>;
  /** longitudinal g: + = accel, - = braking */
  longG: Signal<number>;
  /** lateral g: + = right, - = left */
  latG: Signal<number>;
  pitchDeg: Signal<number>;
  rollDeg: Signal<number>;
}

export interface TripData {
  distanceMi: Signal<number>;
  movingTimeSec: Signal<number>;
  avgSpeedMph: Signal<number>;
  /**
   * Fuel burned this session (gallons), integrated from MAF while OBD is connected
   * (live: the FuelAccum; sim: synthetic from instant MPG). Absent without OBD — the
   * long-term MPG log only scores miles that have gallons against them.
   */
  fuelGallons: Signal<number>;
}

export interface SystemData {
  /** unit input voltage — close to battery, self-measured (not CAN) */
  voltage: Signal<number>;
  /** the head unit's OWN 12 V input (CarManager), never merged with OBD — the
   *  ENGINE face shows it beside the ECU voltage (battery vs alternator) */
  unitVoltage: Signal<number>;
  /** ISO-ish wall clock, updated by the source */
  now: number;
  isDaylight: boolean;
  /** head-unit headlight (ILLUMI) line; null = unit doesn't report it. AUTO theme prefers this. */
  headlights: boolean | null;
  gpsFix: boolean;
  satellites: Signal<number>;
  wifi: boolean;
  lte: boolean;
  sensorsOnline: boolean;
}

// ----------------------------------------------------------------------------
// Tier B — phone & media (Bluetooth A2DP / AVRCP, local apps)
// ----------------------------------------------------------------------------
export interface NowPlaying {
  title: string;
  artist: string;
  album: string;
  /** local/remote art uri; null = render the placeholder tile */
  artUri: string | null;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  source: string; // e.g. "BLUETOOTH A2DP"
}

export interface MediaData {
  nowPlaying: Signal<NowPlaying>;
  volume: Signal<number>; // 0..1
}

// ----------------------------------------------------------------------------
// Tier C — full OBD2 (absent until the ELM327/OBDLink dongle connects)
// Naturally aspirated 2TR-FE: NO boost/turbo data by design.
// ----------------------------------------------------------------------------
export interface ObdData {
  connected: boolean;
  rpm: Signal<number>;
  throttlePct: Signal<number>;
  engineLoadPct: Signal<number>;
  coolantTempF: Signal<number>;
  intakeTempF: Signal<number>;
  oilTempF: Signal<number>;
  ambientTempF: Signal<number>;
  fuelLevelPct: Signal<number>;
  instantMpg: Signal<number>;
  avgMpg: Signal<number>;
  runTimeSec: Signal<number>;
  baroKpa: Signal<number>;
  estHp: Signal<number>;
  estTorqueLbFt: Signal<number>;
  dtcCount: Signal<number>;
  /** check-engine lamp (PID 01 bit 7); false while unknown */
  milOn: boolean;
  /** stored trouble codes (Mode 03), e.g. ["P0420"]; absent until read */
  dtcCodes: Signal<string[]>;
  /** short / long term fuel trim, bank 1 (%; + = ECU adding fuel) */
  stftPct: Signal<number>;
  ltftPct: Signal<number>;
  /** intake manifold absolute pressure (kPa) */
  mapKpa: Signal<number>;
  /** ECU control-module voltage (PID 42) — alternator output with the engine running */
  ecuVolts: Signal<number>;
  /** EXPERIMENTAL Toyota ATF temperature (°F) — absent unless a probe answered */
  transTempF: Signal<number>;
  /**
   * Last completed 0–60 mph time (s). OPTIONAL + absent by default (live: GPS-armed,
   * holds a value after a run). Rendered by the ENGINE face's 0–60 tile.
   */
  zeroToSixtySec?: Signal<number>;
}

// ----------------------------------------------------------------------------
// Tier D — head-unit CAN body signals. Walled off (no public API).
// Modeled only so the UI can *acknowledge* it exists; never depended upon.
// ----------------------------------------------------------------------------
export interface BodyData {
  supported: boolean; // false in this build — requires MCU serial reverse-eng
  reverseGear: Signal<boolean>;
  acOn: Signal<boolean>;
}

// ----------------------------------------------------------------------------
// The full snapshot the UI renders from.
// ----------------------------------------------------------------------------
export interface DashboardData {
  motion: MotionData;
  trip: TripData;
  system: SystemData;
  media: MediaData;
  obd: ObdData;
  body: BodyData;
  /** monotonic frame counter from the source */
  frame: number;
}

/**
 * Rolling history buffers the signature element reads each frame.
 * Kept outside `DashboardData` because it is high-frequency and append-only;
 * the source owns the ring buffers and exposes a cheap read.
 */
export interface History {
  /** longitudinal g samples, oldest -> newest, fixed length */
  longG: number[];
  /** speed samples, oldest -> newest, fixed length */
  speed: number[];
  /**
   * altitude (ft), sampled every ALT_SAMPLE_MI (0.02 mi) of trip distance — NOT per
   * tick — oldest -> newest, up to ALT_SLOTS (250 ≈ 5 mi). Grows from empty in live
   * mode until the first fixes arrive.
   */
  altitude: number[];
}

/**
 * The only surface the app depends on. Sim today, live tomorrow.
 */
export interface DataSource {
  start(): void;
  stop(): void;
  getSnapshot(): DashboardData;
  getHistory(): History;
  /** returns an unsubscribe fn; called on every frame tick */
  subscribe(listener: (data: DashboardData) => void): () => void;
}
