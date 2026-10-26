/**
 * Tier A — GPS via expo-location. Converts at the source to the UI's units
 * (mph / degrees / feet) using the pure helpers in src/lib/units.ts, and derives
 * trip distance (haversine integration), moving time, and average speed.
 *
 * Native only — reached solely through LiveDataSource (dynamic-imported on native),
 * so expo-location never lands in the web bundle.
 *
 * Freshness honesty: each field carries its OWN last-real-update timestamp, so a
 * value carried forward across a fix that lacked it (e.g. heading reads -1 while
 * stopped) ages to stale/absent instead of being stamped fresh. `gpsFix` is
 * derived from fix recency, not latched, so it goes false when GPS is lost.
 */
import * as Location from 'expo-location';
import { haversineMeters, metersToFeet, metersToMiles, mpsToMph, normalizeDeg } from '../../lib/units';

export interface LocationSnapshot {
  speedMph: number | null;
  headingDeg: number | null;
  altitudeFt: number | null;
  distanceMi: number;
  movingTimeSec: number;
  avgSpeedMph: number;
  satellites: number | null; // expo-location doesn't expose this → null
  gpsFix: boolean;
  lat: number | null;
  lon: number | null;
  lastFixAt: number | null;
  // per-field freshness (epoch ms of the last REAL value, or null if never)
  speedAt: number | null;
  headingAt: number | null;
  altitudeAt: number | null;
  permission: 'granted' | 'denied' | 'undetermined';
}

type Stored = Omit<LocationSnapshot, 'gpsFix'>;

const MOVING_MPH = 1.0; // below this we treat the truck as stopped (ignore jitter)
const GPS_STALE_MS = 5000; // a fix older than this means we've lost the fix
const MIN_MOVE_M = 2.5; // displacement noise floor for the no-GPS-speed fallback path

export class LocationProvider {
  private sub: Location.LocationSubscription | null = null;
  private snap: Stored = {
    speedMph: null,
    headingDeg: null,
    altitudeFt: null,
    distanceMi: 0,
    movingTimeSec: 0,
    avgSpeedMph: 0,
    satellites: null,
    lat: null,
    lon: null,
    lastFixAt: null,
    speedAt: null,
    headingAt: null,
    altitudeAt: null,
    permission: 'undetermined',
  };

  async start(): Promise<void> {
    // CHECK before requesting: on this unit a request — even an already-granted one —
    // flashes Android's permission screen, which pauses the app (and, before the
    // keep-alive, froze OBD setup mid-handshake). Only ask when actually missing.
    let { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') ({ status } = await Location.requestForegroundPermissionsAsync());
    this.snap.permission =
      status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
    if (status !== 'granted') return;

    this.sub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 500,
        distanceInterval: 0,
      },
      (pos) => this.onPosition(pos)
    );
  }

  stop(): void {
    this.sub?.remove();
    this.sub = null;
  }

  private onPosition(pos: Location.LocationObject) {
    const c = pos.coords;
    const now = pos.timestamp || Date.now();
    const prevAt = this.snap.lastFixAt;
    const prevLat = this.snap.lat;
    const prevLon = this.snap.lon;
    const acc = typeof c.accuracy === 'number' && c.accuracy > 0 ? c.accuracy : 999;
    const dt = prevAt != null ? (now - prevAt) / 1000 : 0;
    const meters =
      prevLat != null && prevLon != null
        ? haversineMeters({ lat: prevLat, lon: prevLon }, { lat: c.latitude, lon: c.longitude })
        : 0;
    // displacement big enough to be real motion, not GPS noise
    const realMove = prevAt != null && dt > 0 && meters > Math.max(MIN_MOVE_M, 2 * acc);

    // speed: prefer the GPS Doppler value (reads ~0 when parked); only fall back to
    // displacement/dt when it clears the noise floor, so parked jitter can't fake speed.
    const haveGpsSpeed = typeof c.speed === 'number' && c.speed >= 0;
    let speedMph = this.snap.speedMph;
    let speedAt = this.snap.speedAt;
    if (haveGpsSpeed) {
      speedMph = Math.max(0, mpsToMph(c.speed as number));
      speedAt = now;
    } else if (realMove) {
      speedMph = Math.max(0, mpsToMph(meters / dt));
      speedAt = now;
    } else if (prevAt != null) {
      speedMph = 0; // we have a fix and aren't moving → genuinely stopped
      speedAt = now;
    }

    // heading: expo-location reports -1 when course is unknown (stationary / low speed)
    let headingDeg = this.snap.headingDeg;
    let headingAt = this.snap.headingAt;
    if (typeof c.heading === 'number' && c.heading >= 0) {
      headingDeg = normalizeDeg(c.heading);
      headingAt = now; // only advance the timestamp when a REAL heading arrived
    }

    let altitudeFt = this.snap.altitudeFt;
    let altitudeAt = this.snap.altitudeAt;
    if (typeof c.altitude === 'number') {
      altitudeFt = metersToFeet(c.altitude);
      altitudeAt = now;
    }

    // trip integration — only while genuinely moving (kills GPS creep on both paths)
    const moving = haveGpsSpeed ? mpsToMph(c.speed as number) >= MOVING_MPH : realMove;
    let distanceMi = this.snap.distanceMi;
    let movingTimeSec = this.snap.movingTimeSec;
    if (moving && dt > 0 && dt < 10) {
      distanceMi += metersToMiles(meters);
      movingTimeSec += dt;
    }
    const avgSpeedMph = movingTimeSec > 0 ? distanceMi / (movingTimeSec / 3600) : 0;

    this.snap = {
      speedMph,
      headingDeg,
      altitudeFt,
      distanceMi,
      movingTimeSec,
      avgSpeedMph,
      satellites: null,
      lat: c.latitude,
      lon: c.longitude,
      lastFixAt: now,
      speedAt,
      headingAt,
      altitudeAt,
      permission: 'granted',
    };
  }

  getSnapshot(): LocationSnapshot {
    // gpsFix is derived from fix recency, not latched — so it drops to false when
    // GPS is lost (tunnel/garage/antenna), matching reality.
    const gpsFix = this.snap.lastFixAt != null && Date.now() - this.snap.lastFixAt < GPS_STALE_MS;
    return { ...this.snap, gpsFix };
  }
}
