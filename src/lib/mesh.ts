/**
 * Attitude Mesh geometry (Signal Library study 07) — the truck's wireframe on
 * scrolling terrain, seen from a fixed 3/4 camera, rotated by roll then pitch. Tilt is
 * EXAGGERATED (default ×1.8) so a 3° camber still reads; the UI must say so and show
 * the true angles beside it.
 *
 * PURE — type-only imports. The truck model (src/lib/tacoma.ts) is passed in, so this
 * file stays runnable by the Node verifier. Emits SVG path strings for either renderer.
 *
 * Truck frame: x = right, y = up, nose at −z. The terrain scrolls toward −z as you
 * drive, so the truck is placed on the road turned 180° (truckToWorld): nose into the
 * oncoming ground, seen from the rear-left 3/4. Tilt is applied in the TRUCK frame
 * first, so pitch / roll keep their meaning. NOTE the design prototype also had both
 * tilt signs inverted (+pitch dropped the nose, +roll raised the right side) and drove
 * the truck backwards; tiltTransform follows the IMU convention and verify.ts pins both.
 */
import type { P3, Polyline, TruckModel } from './tacoma';

export const MESH_TILT_GAIN = 1.8;
const CAM = { D: 9, yaw: -0.62, el: 0.44 };
export const GRID_ALPHAS = [0.3, 0.22, 0.14, 0.07] as const; // bucketed line alphas

type V2 = [number, number];
const f = (n: number) => (Math.round(n * 10) / 10).toString();

/** Default zoom: the real Access Cab is longer/lower than the study's toy truck. */
export const MESH_ZOOM = 1.7;

/** Perspective projector for a w×h viewport (ground origin at (w/2, 0.66h), focal 1.3h·zoom). */
export function makeProjector(w: number, h: number, zoom = 1) {
  const cx = w / 2;
  const cy = h * 0.66; // a touch lower than the study's 0.6h: room for the up-vector
  const fl = h * 1.3 * zoom;
  const cyw = Math.cos(CAM.yaw);
  const syw = Math.sin(CAM.yaw);
  const ce = Math.cos(CAM.el);
  const se = Math.sin(CAM.el);
  return (x: number, y: number, z: number): V2 => {
    const x1 = x * cyw - z * syw;
    const z1 = x * syw + z * cyw;
    const y2 = y * ce + z1 * se;
    const z2 = -y * se + z1 * ce;
    const d = Math.max(0.5, z2 + CAM.D);
    return [cx + (x1 * fl) / d, cy - (y2 * fl) / d];
  };
}

/** Rolling terrain height at (x, world z). */
export const terrainHeight = (x: number, zw: number) =>
  0.1 * Math.sin(x * 1.3 + 0.7) * Math.sin(zw * 0.8) + 0.05 * Math.sin(zw * 2.1 + x);

export interface MeshFrame {
  /** terrain grid, one path per GRID_ALPHAS bucket */
  grid: string[];
  /** footprint shadow (filled) */
  shadow: string;
  body: string;
  detail: string;
  wheels: string;
  /** dashed true-vertical through the roof */
  vertical: string;
  /** the truck's own up-vector (accent) — its lean against `vertical` IS the tilt */
  up: string;
}

const bucket = (alpha: number) => {
  let best = 0;
  for (let i = 1; i < GRID_ALPHAS.length; i++) if (Math.abs(alpha - GRID_ALPHAS[i]) < Math.abs(alpha - GRID_ALPHAS[best])) best = i;
  return best;
};

/** Truck frame → road: turned 180° about vertical so the nose heads into the scrolling ground. */
export const truckToWorld = ([x, y, z]: P3): P3 => [-x, y, -z];

/**
 * Body rotation for an attitude, in the IMU convention: +pitch = nose UP, +roll =
 * right side DOWN. Roll about the long axis, then pitch about the lateral axis.
 */
export function tiltTransform(pitchDeg: number, rollDeg: number, gain = MESH_TILT_GAIN) {
  const k = (gain * Math.PI) / 180;
  const pr = (Number.isFinite(pitchDeg) ? pitchDeg : 0) * k;
  const rr = (Number.isFinite(rollDeg) ? rollDeg : 0) * k;
  const cp = Math.cos(pr);
  const sp = Math.sin(pr);
  const cr = Math.cos(rr);
  const sr = Math.sin(rr);
  return ([x, y, z]: P3): P3 => {
    // roll: right side (+x) goes down, roof leans right
    const x1 = x * cr + y * sr;
    const y1 = -x * sr + y * cr;
    // pitch: nose (−z) comes up
    return [x1, y1 * cp - z * sp, y1 * sp + z * cp];
  };
}

/**
 * One frame. `distM` scrolls the terrain (metres travelled); pitch/roll in degrees
 * (IMU convention). `model` is the truck wireframe (TACOMA_ACCESS_CAB).
 */
export function meshFrame(o: {
  w: number;
  h: number;
  distM: number;
  pitchDeg: number;
  rollDeg: number;
  model: TruckModel;
  gain?: number;
  zoom?: number;
}): MeshFrame {
  const P = makeProjector(o.w, o.h, o.zoom ?? MESH_ZOOM);
  const sc = (Number.isFinite(o.distM) ? o.distM : 0) * 0.3;
  const off = ((sc % 1) + 1) % 1;
  const grid: string[] = GRID_ALPHAS.map(() => '');
  const add = (b: number, d: string) => (grid[b] += (grid[b] ? ' ' : '') + d);

  // longitudinal lines (fade toward the sides)
  for (let i = -6; i <= 6; i++) {
    let d = '';
    for (let k = 0; k <= 21; k++) {
      const z = -4.5 + k * 0.5;
      const q = P(i, terrainHeight(i, z + sc), z);
      d += `${k ? ' L' : 'M'} ${f(q[0])} ${f(q[1])}`;
    }
    add(bucket(0.3 * (1 - Math.abs(i) / 7)), d);
  }
  // cross lines scrolling toward the viewer (fade with distance from the truck)
  for (let j = -4; j <= 7; j++) {
    const z = j - off;
    if (z < -4.5 || z > 6) continue;
    let d = '';
    for (let k = 0; k <= 24; k++) {
      const x = -6 + k * 0.5;
      const q = P(x, terrainHeight(x, z + sc), z);
      d += `${k ? ' L' : 'M'} ${f(q[0])} ${f(q[1])}`;
    }
    add(bucket(0.3 * (1 - Math.abs(z - 0.75) / 6.5)), d);
  }

  const T = tiltTransform(o.pitchDeg, o.rollDeg, o.gain);
  const proj = (pl: Polyline, tilt: boolean) => {
    let d = '';
    for (let i = 0; i < pl.length; i++) {
      const v = truckToWorld(tilt ? T(pl[i]) : pl[i]);
      const q = P(v[0], v[1], v[2]);
      d += `${i ? ' L' : 'M'} ${f(q[0])} ${f(q[1])} `;
    }
    return d;
  };
  const group = (pls: Polyline[]) => pls.map((pl) => proj(pl, true)).join('').trim();

  const r = o.model.roof;
  const lift = 0.9; // scene units above the roof
  return {
    grid,
    shadow: proj(o.model.footprint, false).trim() + ' Z',
    body: group(o.model.body),
    detail: group(o.model.detail),
    wheels: group(o.model.wheels),
    vertical: proj([[r[0], 0, r[2]], [r[0], r[1] + lift, r[2]]], false).trim(),
    up: proj([r, [r[0], r[1] + lift, r[2]]], true).trim(),
  };
}
