/**
 * Tier A — accelerometer/gyro via expo-sensors, turned into vehicle-frame g.
 *
 * The head unit is mounted at an unknown fixed angle, so raw axes aren't the
 * truck's. All the rotation/gravity math lives in the pure, tested src/lib/imu.ts;
 * this file is just the wiring: feed accelerometer samples in, read smoothed
 * longitudinal/lateral g + pitch/roll out, and run the two-step calibration.
 *
 * Native only — reached solely through LiveDataSource.
 */
import { Accelerometer } from 'expo-sensors';
import {
  buildCalibration,
  estimateGravity,
  identityCalibration,
  initImuState,
  processSample,
  toDeg,
  type Calibration,
  type ImuState,
  type Vec3,
} from '../../lib/imu';

export interface SensorSnapshot {
  longG: number | null;
  latG: number | null;
  pitchDeg: number | null;
  rollDeg: number | null;
  online: boolean;
}

const SAMPLE_MS = 20; // ~50 Hz (Android caps at 200 Hz without a special perm)
const CAL_WINDOW_MS = 1500;

export class SensorProvider {
  private sub: { remove: () => void } | null = null;
  private cal: Calibration = identityCalibration();
  private state: ImuState = initImuState(this.cal.gravityDev);
  private lastAt: number | null = null;
  private online = false;

  private out: SensorSnapshot = {
    longG: null,
    latG: null,
    pitchDeg: null,
    rollDeg: null,
    online: false,
  };

  // calibration capture
  private capturing: null | { samples: Vec3[]; subtractGravity: boolean } = null;

  setCalibration(cal: Calibration) {
    this.cal = cal;
    this.state = initImuState(cal.gravityDev);
  }
  getCalibration(): Calibration {
    return this.cal;
  }

  async start(): Promise<void> {
    const available = await Accelerometer.isAvailableAsync().catch(() => false);
    if (!available) {
      this.online = false;
      return;
    }
    Accelerometer.setUpdateInterval(SAMPLE_MS);
    this.sub = Accelerometer.addListener(({ x, y, z }) => this.onSample([x, y, z]));
    this.online = true;
  }

  stop(): void {
    this.sub?.remove();
    this.sub = null;
    this.online = false;
  }

  private onSample(accelG: Vec3) {
    const now = Date.now();
    const dt = this.lastAt ? Math.min(0.1, (now - this.lastAt) / 1000) : SAMPLE_MS / 1000;
    this.lastAt = now;

    if (this.capturing) this.capturing.samples.push(accelG);

    const { state, out } = processSample(this.state, this.cal, accelG, dt);
    this.state = state;
    this.out = {
      longG: out.longitudinal,
      latG: out.lateral,
      pitchDeg: toDeg(out.pitch),
      rollDeg: toDeg(out.roll),
      online: true,
    };
  }

  /** newest longitudinal-g, for the signature ring buffer (held between samples). */
  getCurrentLongG(): number {
    return this.out.longG ?? 0;
  }

  getSnapshot(): SensorSnapshot {
    return { ...this.out, online: this.online };
  }

  private capture(subtractGravity: boolean): Promise<Vec3[]> {
    return new Promise((resolve) => {
      this.capturing = { samples: [], subtractGravity };
      setTimeout(() => {
        const s = this.capturing?.samples ?? [];
        this.capturing = null;
        resolve(s);
      }, CAL_WINDOW_MS);
    });
  }

  /**
   * Step A — parked & level: learn the gravity vector (device-up). Sets pitch/roll
   * correctly; horizontal axes stay until a forward calibration resolves yaw.
   * Returns the new calibration (persist it via settings).
   */
  async calibrateLevel(): Promise<Calibration> {
    const samples = await this.capture(false);
    const gravity = estimateGravity(samples);
    // keep a prior forward hint if we have one; else seed forward from current R row 0
    const fwdHint = this.cal.R[0] as Vec3;
    this.setCalibration(buildCalibration(gravity, fwdHint));
    return this.cal;
  }

  /**
   * Step B — gentle straight pull from a stop: the mean horizontal acceleration
   * points along vehicle-forward, resolving the yaw ambiguity. Run after level.
   */
  async calibrateForward(): Promise<Calibration> {
    const samples = await this.capture(true);
    if (!samples.length) return this.cal;
    const mean = estimateGravity(samples); // mean accel during the pull (gravity + forward)
    const fwdHint: Vec3 = [
      mean[0] - this.cal.gravityDev[0],
      mean[1] - this.cal.gravityDev[1],
      mean[2] - this.cal.gravityDev[2],
    ];
    this.setCalibration(buildCalibration(this.cal.gravityDev, fwdHint));
    return this.cal;
  }
}
