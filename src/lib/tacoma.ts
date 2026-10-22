/**
 * Low-poly wireframe of the owner's truck: a 3rd-gen (2016–2023) Toyota Tacoma
 * ACCESS CAB, long (6.1 ft) bed, SR 4x2 — built from Toyota's published dimensions,
 * not a downloaded model (license-clean, and few enough edges to project at 25 fps
 * on the Snapdragon 665).
 *
 *   overall length 212.3"  · width 74.4" (overfenders) · height 70.6"
 *   wheelbase 127.4"       · track 63.0 / 63.2"        · ground clearance 9.4"
 *   bed (inside) 73.7" long · 56.7" wide (41.5" between wells) · 19.1" deep
 *   tires 245/75R16 → Ø 30.5"
 * Stations not on the spec sheet (hood/cowl/roof breakpoints, door seams, front
 * overhang ≈ 34.4") are eyeballed from the body's proportions — tweak them here.
 *
 * PURE — no imports. Output is in SCENE units (truck length ≈ 3.4, the Signal Library
 * camera's framing), truck frame: x = right, y = up, z = forward-is-NEGATIVE (the nose
 * sits at −z), origin on the ground at mid-length.
 */

export type P3 = [number, number, number];
export type Polyline = P3[];

export interface TruckModel {
  /** primary silhouette: body shell, greenhouse, bed box */
  body: Polyline[];
  /** secondary lines: doors, glass, grille, lamps, mirrors, bed interior */
  detail: Polyline[];
  wheels: Polyline[];
  /** ground footprint (closed) */
  footprint: Polyline;
  /** roof-centre anchor for the up-vector / true-vertical reference */
  roof: P3;
  lengthIn: number;
}

// ---- published + eyeballed dimensions (inches) ----
const L = 212.3;
const WB = 127.4;
const FRONT_AXLE = 34.4; // front overhang
const REAR_AXLE = FRONT_AXLE + WB;
const HALF_W = 74.4 / 2; // 37.2 at the overfenders
const TRACK = 63.1;
const TIRE_R = 30.5 / 2;
const TIRE_W = 9.6;
const ROOF_Y = 70.6;
const BELT_Y = 50; // beltline (bottom of the side glass), also bed-rail height
const ROCKER_Y = 18;
const BED_FRONT = 131;
const BED_REAR = 206;
const BED_FLOOR_Y = 31;
const BED_IN_HALF = 56.7 / 2;
const WELL_IN_HALF = 41.5 / 2;
const ARCH_R = 17.5;

const SCALE = 3.4 / L; // scene units per inch
const S = (x: number, y: number, z: number): P3 => [x * SCALE, y * SCALE, (z - L / 2) * SCALE];
const mirror = (pl: Polyline): Polyline => pl.map(([x, y, z]) => [-x, y, z]);
const both = (pl: Polyline): Polyline[] => [pl, mirror(pl)];

/** Greenhouse tumblehome: side-glass plane half-width at height y. */
const glassX = (y: number) => 34 + ((y - BELT_Y) / (ROOF_Y - BELT_Y)) * (27 - 34);

function arc(cz: number, cy: number, r: number, x: number, a0: number, a1: number, n = 10): Polyline {
  const out: Polyline = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push(S(x, cy + Math.sin(a) * r, cz - Math.cos(a) * r));
  }
  return out;
}

function ring(cz: number, cy: number, r: number, x: number, n: number): Polyline {
  const out: Polyline = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push(S(x, cy + Math.sin(a) * r, cz + Math.cos(a) * r));
  }
  return out;
}

export function buildTacomaAccessCab(): TruckModel {
  const body: Polyline[] = [];
  const detail: Polyline[] = [];
  const wheels: Polyline[] = [];
  const X = HALF_W;

  // ---- side silhouette (each side): bumper → front arch → rocker → rear arch → tailgate
  const sideLower = (x: number): Polyline => [
    S(x - 2, 15, 0),
    S(x, 18, FRONT_AXLE - ARCH_R - 1),
    ...arc(FRONT_AXLE, TIRE_R, ARCH_R, x, 0.05 * Math.PI, 0.95 * Math.PI),
    S(x, ROCKER_Y, FRONT_AXLE + ARCH_R + 1),
    S(x, ROCKER_Y, 128),
    S(x, 20, BED_FRONT),
    S(x, 20, REAR_AXLE - ARCH_R - 1),
    ...arc(REAR_AXLE, TIRE_R, ARCH_R, x, 0.05 * Math.PI, 0.95 * Math.PI),
    S(x, 20, REAR_AXLE + ARCH_R + 1),
    S(x, 20, BED_REAR),
  ];
  // shoulder line: grille top → fender → beltline → cab back
  const sideShoulder = (x: number): Polyline => [
    S(x - 3, 43, 1),
    S(x - 1, 44.5, 12),
    S(x, 46.5, 48),
    S(34, BELT_Y, 52),
    S(34, BELT_Y, 128),
  ];
  for (const pl of [sideLower(X), sideShoulder(X)]) body.push(...both(pl));

  // ---- front face + hood
  body.push([S(-X + 2, 15, 0), S(X - 2, 15, 0)]); // bumper bottom
  body.push([S(-X + 3, 43, 1), S(X - 3, 43, 1)]); // hood leading edge
  for (const s of [1, -1]) body.push([S(s * (X - 2), 15, 0), S(s * (X - 3), 43, 1)]); // front corners
  body.push([S(-30, 46.5, 10), S(30, 46.5, 10)], [S(-31, 49.5, 48), S(31, 49.5, 48)]); // hood front + cowl
  for (const s of [1, -1]) body.push([S(s * 30, 46.5, 10), S(s * 31, 49.5, 48)]); // hood edges

  // ---- greenhouse: windshield, roof, cab back
  for (const s of [1, -1]) {
    body.push([S(s * 34, BELT_Y, 52), S(s * 27, ROOF_Y, 82)]); // A-pillar
    body.push([S(s * 27, ROOF_Y, 82), S(s * 27, ROOF_Y - 0.8, 124)]); // roof rail
    body.push([S(s * 27, ROOF_Y - 0.8, 124), S(s * 33, BELT_Y, 128)]); // C-pillar
    body.push([S(s * 34, BELT_Y, 128), S(s * 36, 20, 128)]); // cab back corner
  }
  body.push([S(-31, BELT_Y, 52), S(31, BELT_Y, 52)]); // windshield base
  body.push([S(-27, ROOF_Y, 82), S(27, ROOF_Y, 82)]); // windshield header
  body.push([S(-27, ROOF_Y - 0.8, 124), S(27, ROOF_Y - 0.8, 124)]); // roof rear
  body.push([S(-33, BELT_Y, 128), S(33, BELT_Y, 128)]); // cab back belt
  body.push([S(-36, 20, 128), S(36, 20, 128)]); // cab back bottom

  // ---- bed box (outer) + rails + tailgate
  for (const s of [1, -1]) {
    body.push([S(s * X, BELT_Y, BED_FRONT), S(s * X, BELT_Y, BED_REAR)]); // outer rail
    body.push([S(s * X, 20, BED_FRONT), S(s * X, BELT_Y, BED_FRONT)]); // bed front corner
    body.push([S(s * X, 20, BED_REAR), S(s * X, BELT_Y, BED_REAR)]); // bed rear corner
    detail.push([S(s * BED_IN_HALF, BELT_Y, BED_FRONT + 1.5), S(s * BED_IN_HALF, BELT_Y, BED_REAR - 1)]); // inner rail
  }
  body.push([S(-X, BELT_Y, BED_FRONT), S(X, BELT_Y, BED_FRONT)]); // bed front wall top
  body.push([S(-X, BELT_Y, BED_REAR), S(X, BELT_Y, BED_REAR)]); // tailgate top
  body.push([S(-X, 20, BED_REAR), S(X, 20, BED_REAR)]); // tailgate bottom
  body.push([S(-X + 2, 17, L), S(X - 2, 17, L), S(X - 2, 24, L), S(-X + 2, 24, L), S(-X + 2, 17, L)]); // rear bumper face
  for (const s of [1, -1]) body.push([S(s * (X - 2), 24, L), S(s * (X - 2), 24, BED_REAR)]);

  // bed interior: floor (pinched by the wheel wells), wells
  const zw0 = REAR_AXLE - 14;
  const zw1 = REAR_AXLE + 14;
  const floor: Polyline = [
    S(-BED_IN_HALF, BED_FLOOR_Y, BED_FRONT + 1.5),
    S(BED_IN_HALF, BED_FLOOR_Y, BED_FRONT + 1.5),
    S(BED_IN_HALF, BED_FLOOR_Y, zw0),
    S(WELL_IN_HALF, BED_FLOOR_Y, zw0),
    S(WELL_IN_HALF, BED_FLOOR_Y, zw1),
    S(BED_IN_HALF, BED_FLOOR_Y, zw1),
    S(BED_IN_HALF, BED_FLOOR_Y, BED_REAR - 1),
    S(-BED_IN_HALF, BED_FLOOR_Y, BED_REAR - 1),
    S(-BED_IN_HALF, BED_FLOOR_Y, zw1),
    S(-WELL_IN_HALF, BED_FLOOR_Y, zw1),
    S(-WELL_IN_HALF, BED_FLOOR_Y, zw0),
    S(-BED_IN_HALF, BED_FLOOR_Y, zw0),
    S(-BED_IN_HALF, BED_FLOOR_Y, BED_FRONT + 1.5),
  ];
  detail.push(floor);
  for (const s of [1, -1]) {
    detail.push([S(s * WELL_IN_HALF, BED_FLOOR_Y, zw0), S(s * WELL_IN_HALF, BED_FLOOR_Y + 10, zw0 + 4), S(s * WELL_IN_HALF, BED_FLOOR_Y + 10, zw1 - 4), S(s * WELL_IN_HALF, BED_FLOOR_Y, zw1)]);
  }

  // ---- doors + glass (Access Cab: front door + rear-hinged access door, no B-pillar)
  for (const s of [1, -1]) {
    const xs = s * X;
    detail.push([S(xs, 20, 56), S(xs, 46, 56), S(s * 34, BELT_Y, 58)]); // front door leading edge
    detail.push([S(xs, ROCKER_Y + 1, 100), S(xs, BELT_Y - 1, 100), S(s * glassX(68), 68, 100)]); // door/access seam
    detail.push([S(xs, 20, 126), S(s * 33.5, BELT_Y, 127)]); // access door trailing edge
    // front side glass (follows the A-pillar)
    detail.push([S(s * glassX(51), 51, 60), S(s * glassX(67), 67, 82), S(s * glassX(68), 68, 98), S(s * glassX(51), 51, 98), S(s * glassX(51), 51, 60)]);
    // access-door quarter glass
    detail.push([S(s * glassX(53), 53, 103), S(s * glassX(66), 66, 103), S(s * glassX(66), 66, 121), S(s * glassX(53), 53, 123), S(s * glassX(53), 53, 103)]);
    // mirror
    detail.push([S(s * 34, 52, 60), S(s * 41, 53, 61), S(s * 41, 58, 62), S(s * 34, 58, 61), S(s * 34, 52, 60)]);
    // headlamp sweeping back along the fender
    detail.push([S(s * 21, 39, 1.2), S(s * 33, 40, 2.5), S(s * 35.5, 43.5, 12), S(s * 24, 43.3, 3), S(s * 21, 39, 1.2)]);
    // tail lamp
    detail.push([S(xs, 34, BED_REAR), S(xs, 47, BED_REAR), S(xs, 47, BED_REAR - 3), S(xs, 34, BED_REAR - 3), S(xs, 34, BED_REAR)]);
    // overfender lips over the arches
    detail.push(arc(FRONT_AXLE, TIRE_R, ARCH_R + 2.5, xs + s * 0.01, 0.12 * Math.PI, 0.88 * Math.PI, 8));
    detail.push(arc(REAR_AXLE, TIRE_R, ARCH_R + 2.5, xs + s * 0.01, 0.12 * Math.PI, 0.88 * Math.PI, 8));
  }
  // rear window
  detail.push([S(-24, 54, 127.6), S(24, 54, 127.6), S(23, 66, 126), S(-23, 66, 126), S(-24, 54, 127.6)]);
  // big trapezoid grille (3rd-gen signature)
  detail.push([S(-21, 42, 1.5), S(21, 42, 1.5), S(23, 33, 0.8), S(16, 23, 0.4), S(-16, 23, 0.4), S(-23, 33, 0.8), S(-21, 42, 1.5)]);

  // ---- wheels: outer + inner tire faces, tread ties, rim
  for (const z of [FRONT_AXLE, REAR_AXLE]) {
    for (const s of [1, -1]) {
      const xo = s * (TRACK / 2 + TIRE_W / 2);
      const xi = s * (TRACK / 2 - TIRE_W / 2);
      wheels.push(ring(z, TIRE_R, TIRE_R, xo, 18), ring(z, TIRE_R, TIRE_R, xi, 12), ring(z, TIRE_R, 8, xo, 12));
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const y = TIRE_R + Math.sin(a) * TIRE_R;
        const zz = z + Math.cos(a) * TIRE_R;
        wheels.push([S(xo, y, zz), S(xi, y, zz)]);
      }
    }
  }

  const footprint: Polyline = [S(-X, 0, 0), S(X, 0, 0), S(X, 0, L), S(-X, 0, L), S(-X, 0, 0)];
  return { body, detail, wheels, footprint, roof: S(0, ROOF_Y, 103), lengthIn: L };
}

/** Built once — the model is static; only the pose changes per frame. */
export const TACOMA_ACCESS_CAB: TruckModel = buildTacomaAccessCab();
