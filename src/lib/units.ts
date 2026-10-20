/**
 * Pure unit conversions for the live data layer.
 *
 * The UI contract (src/data/types.ts) fixes the units it renders: **mph, °F,
 * feet, volts, degrees, kPa**. Hardware speaks something else — GPS gives m/s
 * and meters, OBD gives °C and km/h. Every conversion the LiveDataSource needs
 * lives here, as pure functions with NO imports, so:
 *   - `LiveDataSource` stays a thin wiring layer (it converts at the source), and
 *   - `scripts/verify.ts` can exercise the math under
 *     `node --experimental-strip-types` with no native deps.
 *
 * Keep this file runtime-self-contained (no imports). See docs/ARCHITECTURE.md.
 */

// ---- physical constants -----------------------------------------------------
export const MPS_PER_MPH = 0.44704;            // 1 mph = 0.44704 m/s
export const METERS_PER_FOOT = 0.3048;
export const METERS_PER_MILE = 1609.344;
export const G_MPS2 = 9.80665;                 // standard gravity
export const EARTH_RADIUS_M = 6371008.8;       // mean Earth radius (IUGG)

// ---- speed ------------------------------------------------------------------
/** GPS speed (m/s) -> mph. Negative/NaN inputs clamp to 0. */
export function mpsToMph(mps: number): number {
  if (!Number.isFinite(mps) || mps < 0) return 0;
  return mps / MPS_PER_MPH;
}

/** OBD PID 0D vehicle speed (km/h) -> mph. */
export function kmhToMph(kmh: number): number {
  return kmh * 0.621371192237334;
}

// ---- distance / altitude ----------------------------------------------------
/** GPS altitude (m) -> feet. */
export function metersToFeet(m: number): number {
  return m / METERS_PER_FOOT;
}

/** meters -> miles (trip integration). */
export function metersToMiles(m: number): number {
  return m / METERS_PER_MILE;
}

// ---- temperature ------------------------------------------------------------
/** OBD temperatures arrive in °C -> °F. */
export function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32;
}

// ---- g-force ----------------------------------------------------------------
/** Accelerometer reading in m/s² -> g. (expo-sensors already reports g, but
 *  DeviceMotion.acceleration is m/s² — convert when needed.) */
export function mps2ToG(a: number): number {
  return a / G_MPS2;
}

// ---- heading ----------------------------------------------------------------
/** Normalize any degree value into [0, 360). */
export function normalizeDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  return ((deg % 360) + 360) % 360;
}

// ---- geo --------------------------------------------------------------------
export interface LatLon {
  lat: number;
  lon: number;
}

/**
 * Great-circle distance between two lat/lon points, in METERS (haversine).
 * Used to integrate trip distance from successive GPS fixes — robust to the
 * `coords.speed` field being unavailable on some fixes.
 */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
