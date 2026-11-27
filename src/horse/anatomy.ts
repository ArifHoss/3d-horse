/**
 * Horse anatomy, expressed as signed distance field primitives.
 *
 * Units are metres, in a 16hh (1.63 m at the withers) horse's proportions.
 * X points forward (the horse faces +X), Y up, Z to the horse's right.
 *
 * The trunk and neck are lofted chains of elliptical sections — that is how a
 * body reads in silhouette, and it keeps topline, barrel and flank under
 * independent control. Limbs are tapered cones; the head is a chain of
 * sections along the face axis.
 *
 * Conformation landmarks (side view, x/y):
 *   withers       0.25 / 1.63      croup         -0.52 / 1.63
 *   point of shoulder 0.45 / 1.14  point of buttock -0.90 / 1.27
 *   girth         0.30 / 0.97      flank         -0.40 / 1.10
 *   carpus        0.47 / 0.58      hock          -0.80 / 0.58
 *   fetlock       0.48 / 0.23      coronet        0.49 / 0.095
 *   poll          0.94 / 1.95      muzzle         1.35 / 1.47
 */

import { capsule, compile, cone, ellipsoid, sphere, subtract, type Prim, type Sdf } from "../core/sdf";

export type Vec3 = [number, number, number];

export interface LegJoints {
  root: Vec3;
  mid: Vec3;
  fetlock: Vec3;
  coronet: Vec3;
}

export interface Joints {
  frontL: LegJoints;
  frontR: LegJoints;
  hindL: LegJoints;
  hindR: LegJoints;
  pelvis: Vec3;
  spine: Vec3;
  chest: Vec3;
  neck1: Vec3;
  neck2: Vec3;
  head: Vec3;
  muzzle: Vec3;
  tail1: Vec3;
  tail2: Vec3;
  tail3: Vec3;
  earL: Vec3;
  earR: Vec3;
}

const SIDES = [1, -1] as const;

/* ------------------------------------------------------------------ *
 * Lofting
 * ------------------------------------------------------------------ */

type Section = {
  /** centre of the cross-section */
  c: Vec3;
  /** half height (top-bottom) and half width (side-side) */
  ry: number;
  rz: number;
  /** rotation of the section about Z (radians) */
  rot?: number;
  /** override for how far this section's ellipsoid reaches along X */
  rx?: number;
};

/** Interpolate a chain of sections into overlapping ellipsoids. */
function loft(sections: Section[], steps: number, rx: number, k: number): Prim[] {
  const out: Prim[] = [];
  for (let i = 0; i < sections.length - 1; i++) {
    const a = sections[i];
    const b = sections[i + 1];
    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      const e = t * t * (3 - 2 * t);
      const ax = a.rx ?? rx;
      const bx = b.rx ?? rx;
      out.push(
        ellipsoid(
          [
            a.c[0] + (b.c[0] - a.c[0]) * t,
            a.c[1] + (b.c[1] - a.c[1]) * t,
            a.c[2] + (b.c[2] - a.c[2]) * t,
          ],
          [ax + (bx - ax) * e, a.ry + (b.ry - a.ry) * e, a.rz + (b.rz - a.rz) * e],
          [0, 0, (a.rot ?? 0) + ((b.rot ?? 0) - (a.rot ?? 0)) * e],
          k,
        ),
      );
    }
  }
  const last = sections[sections.length - 1];
  out.push(ellipsoid(last.c, [last.rx ?? rx, last.ry, last.rz], [0, 0, last.rot ?? 0], k));
  return out;
}

/** Section from a topline/bottom/half-width spec. */
const sec = (x: number, top: number, bottom: number, hw: number, rot = 0, rx?: number): Section => ({
  c: [x, (top + bottom) / 2, 0],
  ry: (top - bottom) / 2,
  rz: hw,
  rot,
  rx,
});

/* ------------------------------------------------------------------ *
 * Trunk — front to back
 * ------------------------------------------------------------------ */

const BODY: Section[] = [
  sec(0.62, 1.46, 1.12, 0.125), // breast
  sec(0.50, 1.56, 1.04, 0.165), // chest
  sec(0.30, 1.625, 1.00, 0.185), // withers / girth
  sec(0.04, 1.585, 1.015, 0.196), // barrel
  sec(-0.28, 1.588, 1.06, 0.19), // loin
  sec(-0.55, 1.615, 1.13, 0.176), // croup
  sec(-0.76, 1.575, 1.16, 0.158, 0, 0.16), // buttock
  sec(-0.90, 1.495, 1.21, 0.132, 0, 0.12), // point of buttock
  sec(-0.975, 1.435, 1.28, 0.088, 0, 0.082), // tail head
];

/** Withers, crest and throat are separate so they can read as ridges. */
function trunkPrims(): Prim[] {
  const out = loft(BODY, 4, 0.175, 0.12);
  // withers ridge
  out.push(capsule([0.14, 1.60, 0], [0.36, 1.625, 0], 0.05, 0.13));
  // shoulder blades — the sloped mass in front of the barrel
  out.push(ellipsoid([0.42, 1.30, 0.135], [0.19, 0.235, 0.07], [0, 0, 0.55], 0.15));
  out.push(ellipsoid([0.42, 1.30, -0.135], [0.19, 0.235, 0.07], [0, 0, 0.55], 0.15));
  // tail head bump
  out.push(cone([-0.94, 1.49, 0], [-1.10, 1.28, 0], 0.075, 0.034, 0.07));
  // girth: the chest hangs a little deeper than the ellipse
  out.push(ellipsoid([0.28, 1.19, 0], [0.28, 0.17, 0.235], null, 0.17));
  return out;
}

/* ------------------------------------------------------------------ *
 * Neck and head
 * ------------------------------------------------------------------ */

const NECK_ANGLE = 0.66;
const NECK: Section[] = [
  sec(0.27, 1.62, 1.19, 0.158, NECK_ANGLE),
  sec(0.49, 1.755, 1.315, 0.15, NECK_ANGLE),
  sec(0.67, 1.865, 1.455, 0.138, NECK_ANGLE),
  sec(0.83, 1.952, 1.63, 0.12, NECK_ANGLE),
  sec(0.94, 1.99, 1.755, 0.1, NECK_ANGLE),
];

function neckPrims(): Prim[] {
  const out = loft(NECK, 4, 0.145, 0.10);
  // crest: a soft ridge along the top line of the neck
  out.push(capsule([0.26, 1.615, 0], [0.95, 1.99, 0], 0.06, 0.17));
  // throat: fill under the neck where it meets the chest
  out.push(ellipsoid([0.48, 1.38, 0], [0.235, 0.195, 0.15], [0, 0, 0.5], 0.19));
  return out;
}

/** The face axis: from the poll, 52° below horizontal. */
const FACE_ANGLE = -0.9076;
const FACE_DIR: Vec3 = [Math.cos(FACE_ANGLE), Math.sin(FACE_ANGLE), 0];
const POLL: Vec3 = [0.98, 1.98, 0];

/** A point `along` the face axis, `up` perpendicular to it. */
function facePoint(along: number, up: number): Vec3 {
  const nx = -Math.sin(FACE_ANGLE);
  const ny = Math.cos(FACE_ANGLE);
  return [POLL[0] + FACE_DIR[0] * along + nx * up, POLL[1] + FACE_DIR[1] * along + ny * up, 0];
}

function headPrims(): Prim[] {
  const out: Prim[] = [];
  // sections along the face axis: along, halfThickness, halfWidth, blend
  const face: Array<[number, number, number, number]> = [
    [0.0, 0.088, 0.09, 0.09], // poll
    [0.16, 0.115, 0.092, 0.10], // brow
    [0.33, 0.095, 0.072, 0.11], // mid face (dished)
    [0.455, 0.082, 0.058, 0.10], // nose bridge
    [0.552, 0.075, 0.05, 0.08], // muzzle
  ];
  for (const [along, ry, rz, k] of face) {
    const c = facePoint(along, 0);
    out.push(ellipsoid([c[0], c[1], 0], [0.115, ry, rz], [0, 0, FACE_ANGLE], k));
  }
  // jowl: the big round mass behind the jaw
  const jowl = facePoint(0.085, -0.088);
  out.push(ellipsoid([jowl[0], jowl[1], 0], [0.15, 0.15, 0.108], [0, 0, FACE_ANGLE], 0.10));
  // cheek
  const cheek = facePoint(0.30, -0.055);
  out.push(ellipsoid([cheek[0], cheek[1], 0], [0.122, 0.112, 0.086], [0, 0, FACE_ANGLE], 0.09));
  // the jaw's lower edge, from the throat forward to the chin
  const jawEdgeA = facePoint(0.12, -0.138);
  const jawEdgeB = facePoint(0.53, -0.044);
  out.push(cone([jawEdgeA[0], jawEdgeA[1], 0], [jawEdgeB[0], jawEdgeB[1], 0], 0.046, 0.03, 0.03));
  // the cheekbone runs from under the eye back to the jaw hinge
  const cheekA = facePoint(0.235, -0.062);
  const cheekB = facePoint(0.10, -0.105);
  out.push(cone([cheekA[0], cheekA[1], 0], [cheekB[0], cheekB[1], 0], 0.026, 0.022, 0.022));
  // lower jaw line
  const jawA = facePoint(0.085, -0.137);
  const jawB = facePoint(0.585, -0.046);
  out.push(cone([jawA[0], jawA[1], 0], [jawB[0], jawB[1], 0], 0.072, 0.052, 0.08));
  // nose end
  // the nose ends in a rounded button, not a ball
  const nose = facePoint(0.582, 0.004);
  out.push(ellipsoid([nose[0], nose[1], 0], [0.042, 0.05, 0.05], [0, 0, FACE_ANGLE], 0.045));

  // ears
  out.push(cone([0.95, 2.015, 0.052], [0.878, 2.255, 0.082], 0.058, 0.008, 0.03));
  out.push(cone([0.95, 2.015, -0.052], [0.878, 2.255, -0.082], 0.058, 0.008, 0.03));
  // the cup of each ear, scooped out of the front face
  const earCup = (s: number): number[] => [0.956, 2.085, 0.054 * s];
  out.push(subtract(ellipsoid(earCup(1), [0.032, 0.055, 0.018], [0, 0.18, 0], 0.012), 0.02));
  out.push(subtract(ellipsoid(earCup(-1), [0.032, 0.055, 0.018], [0, -0.18, 0], 0.012), 0.02));

  // eye sockets (eyeballs are separate meshes)
  const eye = facePoint(0.175, 0.012);
  out.push(subtract(sphere([eye[0], eye[1], 0.088], 0.034, 0.02), 0.014));
  out.push(subtract(sphere([eye[0], eye[1], -0.088], 0.034, 0.02), 0.014));

  // nostrils: shallow dimples on the surface only — cutting deeper hollows
  // the muzzle out from the inside
  const nostril = facePoint(0.5, 0.008);
  out.push(subtract(ellipsoid([nostril[0], nostril[1], 0.062], [0.038, 0.05, 0.034], [0, 0.3, 0], 0.018), 0.02));
  out.push(subtract(ellipsoid([nostril[0], nostril[1], -0.062], [0.038, 0.05, 0.034], [0, -0.3, 0], 0.018), 0.02));

  // mouth line
  const mouth = facePoint(0.6, -0.038);
  out.push(subtract(capsule([mouth[0], mouth[1], 0.054], [mouth[0], mouth[1], -0.054], 0.013, 0.02), 0.025));
  return out;
}

/* ------------------------------------------------------------------ *
 * Limbs
 * ------------------------------------------------------------------ */

function legPrims(side: number, front: boolean): Prim[] {
  const z = (front ? 0.175 : 0.18) * side;
  const s = (x: number, y: number): Vec3 => [x, y, z];
  if (front) {
    return [
      // shoulder mass, merged into the chest
      ellipsoid([0.435, 1.25, z], [0.125, 0.195, 0.095], [0, 0, 0.22], 0.16),
      // forearm
      cone(s(0.45, 1.17), s(0.47, 0.61), 0.155, 0.07, 0.07),
      // carpus
      sphere(s(0.472, 0.585), 0.074, 0.03),
      // cannon
      cone(s(0.475, 0.56), s(0.483, 0.25), 0.06, 0.05, 0.02),
      // fetlock
      sphere(s(0.485, 0.228), 0.063, 0.022),
      // pastern
      cone(s(0.486, 0.21), s(0.489, 0.10), 0.052, 0.06, 0.02),
      // coronary band + hoof wall
      cone(s(0.49, 0.095), s(0.493, 0.015), 0.062, 0.075, 0.015),
    ];
  }
  return [
    // quarter / thigh mass: the buttock and the stifle in one smooth form
    ellipsoid([-0.60, 1.26, z], [0.25, 0.235, 0.125], [0, 0, 0.16], 0.24),
    // gaskin (tibia)
    cone(s(-0.63, 1.08), s(-0.795, 0.575), 0.145, 0.058, 0.07),
    // point of hock
    sphere(s(-0.80, 0.555), 0.062, 0.03),
    // the calcaneus, sticking back from the joint
    ellipsoid([-0.856, 0.605, z], [0.036, 0.05, 0.028], [0, 0, -0.3], 0.015),
    ellipsoid([-0.822, 0.60, z], [0.05, 0.055, 0.042], [0, 0, 0.25], 0.03),
    // cannon
    cone(s(-0.802, 0.53), s(-0.786, 0.22), 0.046, 0.038, 0.018),
    sphere(s(-0.782, 0.198), 0.05, 0.02),
    cone(s(-0.781, 0.182), s(-0.777, 0.088), 0.042, 0.048, 0.018),
    cone(s(-0.775, 0.082), s(-0.772, 0.012), 0.05, 0.062, 0.014),
  ];
}

/** The whole horse, as a primitive list in rest pose. */
export function horsePrims(): Prim[] {
  const prims: Prim[] = [];
  prims.push(...trunkPrims());
  for (const side of SIDES) {
    prims.push(...legPrims(side, true));
    prims.push(...legPrims(side, false));
  }
  prims.push(...neckPrims());
  prims.push(...headPrims());
  return prims;
}

export function buildSdf(): Sdf {
  return compile(horsePrims());
}

/** Rest-pose joint positions — the rig's ground truth. */
export function joints(): Joints {
  return {
    frontL: {
      root: [0.45, 1.20, -0.16],
      mid: [0.475, 0.545, -0.155],
      fetlock: [0.49, 0.198, -0.15],
      coronet: [0.495, 0.082, -0.15],
    },
    frontR: {
      root: [0.45, 1.20, 0.16],
      mid: [0.475, 0.545, 0.155],
      fetlock: [0.49, 0.198, 0.15],
      coronet: [0.495, 0.082, 0.15],
    },
    hindL: {
      root: [-0.52, 1.28, -0.165],
      mid: [-0.80, 0.555, -0.15],
      fetlock: [-0.782, 0.198, -0.15],
      coronet: [-0.777, 0.082, -0.15],
    },
    hindR: {
      root: [-0.52, 1.28, 0.165],
      mid: [-0.80, 0.555, 0.15],
      fetlock: [-0.782, 0.198, 0.15],
      coronet: [-0.777, 0.082, 0.15],
    },
    pelvis: [-0.58, 1.31, 0],
    spine: [-0.05, 1.29, 0],
    chest: [0.34, 1.27, 0],
    neck1: [0.30, 1.45, 0],
    neck2: [0.62, 1.71, 0],
    head: [0.95, 1.96, 0],
    muzzle: [1.35, 1.50, 0],
    tail1: [-1.0, 1.44, 0],
    tail2: [-1.07, 1.24, 0],
    tail3: [-1.09, 0.97, 0],
    earL: [0.935, 2.07, -0.062],
    earR: [0.935, 2.07, 0.062],
  };
}

export const SDF_BOUNDS: { min: Vec3; max: Vec3 } = {
  min: [-1.26, -0.05, -0.42],
  max: [1.52, 2.30, 0.42],
};
