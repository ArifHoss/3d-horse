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
      out.push(
        ellipsoid(
          [
            a.c[0] + (b.c[0] - a.c[0]) * t,
            a.c[1] + (b.c[1] - a.c[1]) * t,
            a.c[2] + (b.c[2] - a.c[2]) * t,
          ],
          [rx, a.ry + (b.ry - a.ry) * e, a.rz + (b.rz - a.rz) * e],
          [0, 0, (a.rot ?? 0) + ((b.rot ?? 0) - (a.rot ?? 0)) * e],
          k,
        ),
      );
    }
  }
  const last = sections[sections.length - 1];
  out.push(ellipsoid(last.c, [rx, last.ry, last.rz], [0, 0, last.rot ?? 0], k));
  return out;
}

/** Section from a topline/bottom/half-width spec. */
const sec = (x: number, top: number, bottom: number, hw: number, rot = 0): Section => ({
  c: [x, (top + bottom) / 2, 0],
  ry: (top - bottom) / 2,
  rz: hw,
  rot,
});

/* ------------------------------------------------------------------ *
 * Trunk — front to back
 * ------------------------------------------------------------------ */

const BODY: Section[] = [
  sec(0.55, 1.47, 1.08, 0.135), // breast
  sec(0.44, 1.56, 1.01, 0.175), // chest
  sec(0.28, 1.625, 0.975, 0.20), // withers / girth
  sec(0.04, 1.59, 0.98, 0.215), // barrel
  sec(-0.26, 1.57, 1.025, 0.21), // loin
  sec(-0.52, 1.63, 1.09, 0.225), // croup
  sec(-0.72, 1.60, 1.14, 0.205), // buttock
  sec(-0.86, 1.50, 1.19, 0.155), // point of buttock
  sec(-0.955, 1.42, 1.27, 0.095), // tail head
];

/** Withers, crest and throat are separate so they can read as ridges. */
function trunkPrims(): Prim[] {
  const out = loft(BODY, 4, 0.19, 0.12);
  // withers ridge
  out.push(capsule([0.12, 1.60, 0], [0.34, 1.628, 0], 0.055, 0.13));
  // shoulder blades — the sloped mass in front of the barrel
  out.push(ellipsoid([0.40, 1.30, 0.145], [0.20, 0.235, 0.075], [0, 0, 0.55], 0.15));
  out.push(ellipsoid([0.40, 1.30, -0.145], [0.20, 0.235, 0.075], [0, 0, 0.55], 0.15));
  // tail head bump
  out.push(sphere([-0.955, 1.455, 0], 0.075, 0.10));
  // girth: the chest hangs a little deeper than the ellipse
  out.push(ellipsoid([0.26, 1.16, 0], [0.30, 0.19, 0.255], null, 0.17));
  return out;
}

/* ------------------------------------------------------------------ *
 * Neck and head
 * ------------------------------------------------------------------ */

const NECK_ANGLE = 0.66;
const NECK: Section[] = [
  sec(0.28, 1.60, 1.22, 0.185, NECK_ANGLE),
  sec(0.48, 1.705, 1.345, 0.18, NECK_ANGLE),
  sec(0.66, 1.815, 1.475, 0.168, NECK_ANGLE),
  sec(0.82, 1.915, 1.63, 0.142, NECK_ANGLE),
  sec(0.925, 1.955, 1.73, 0.115, NECK_ANGLE),
];

function neckPrims(): Prim[] {
  const out = loft(NECK, 4, 0.17, 0.11);
  // crest: a soft ridge along the top line of the neck
  out.push(capsule([0.32, 1.60, 0], [0.93, 1.955, 0], 0.068, 0.13));
  // throat: fill under the neck where it meets the chest
  out.push(ellipsoid([0.50, 1.40, 0], [0.22, 0.175, 0.16], [0, 0, 0.5], 0.16));
  return out;
}

/** The face axis: from the poll, 52° below horizontal. */
const FACE_ANGLE = -0.9076;
const FACE_DIR: Vec3 = [Math.cos(FACE_ANGLE), Math.sin(FACE_ANGLE), 0];
const POLL: Vec3 = [0.97, 1.955, 0];

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
    [0.0, 0.095, 0.10, 0.09], // poll
    [0.15, 0.125, 0.11, 0.10], // brow
    [0.32, 0.11, 0.09, 0.11], // mid face (dished)
    [0.46, 0.098, 0.085, 0.10], // nose bridge
    [0.57, 0.095, 0.09, 0.08], // muzzle
  ];
  for (const [along, ry, rz, k] of face) {
    const c = facePoint(along, 0);
    out.push(ellipsoid([c[0], c[1], 0], [0.125, ry, rz], [0, 0, FACE_ANGLE], k));
  }
  // jowl: the big round mass behind the jaw
  const jowl = facePoint(0.09, -0.095);
  out.push(ellipsoid([jowl[0], jowl[1], 0], [0.175, 0.17, 0.13], [0, 0, FACE_ANGLE], 0.11));
  // cheek
  const cheek = facePoint(0.30, -0.05);
  out.push(ellipsoid([cheek[0], cheek[1], 0], [0.13, 0.125, 0.10], [0, 0, FACE_ANGLE], 0.09));
  // lower jaw line
  const jawA = facePoint(0.09, -0.145);
  const jawB = facePoint(0.58, -0.05);
  out.push(cone([jawA[0], jawA[1], 0], [jawB[0], jawB[1], 0], 0.082, 0.06, 0.08));
  // nose end
  const nose = facePoint(0.60, -0.012);
  out.push(sphere([nose[0], nose[1], 0], 0.088, 0.04));

  // ears
  out.push(cone([0.955, 2.015, 0.055], [0.895, 2.175, 0.08], 0.048, 0.011, 0.025));
  out.push(cone([0.955, 2.015, -0.055], [0.895, 2.175, -0.08], 0.048, 0.011, 0.025));

  // eye sockets (eyeballs are separate meshes)
  const eye = facePoint(0.175, 0.012);
  out.push(subtract(sphere([eye[0], eye[1], 0.098], 0.045, 0.02), 0.018));
  out.push(subtract(sphere([eye[0], eye[1], -0.098], 0.045, 0.02), 0.018));

  // nostrils
  const nostril = facePoint(0.545, -0.028);
  out.push(subtract(ellipsoid([nostril[0], nostril[1], 0.048], [0.04, 0.03, 0.026], [0, 0.4, 0], 0.015), 0.02));
  out.push(subtract(ellipsoid([nostril[0], nostril[1], -0.048], [0.04, 0.03, 0.026], [0, -0.4, 0], 0.015), 0.02));

  // mouth line
  const mouth = facePoint(0.65, -0.042);
  out.push(subtract(capsule([mouth[0], mouth[1], 0.04], [mouth[0], mouth[1], -0.04], 0.01, 0.01), 0.012));
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
    // quarter / thigh mass
    ellipsoid([-0.53, 1.25, z], [0.22, 0.30, 0.15], [0, 0, 0.14], 0.19),
    // gaskin (tibia)
    cone(s(-0.56, 0.98), s(-0.795, 0.60), 0.15, 0.071, 0.06),
    // point of hock
    sphere(s(-0.80, 0.585), 0.071, 0.03),
    // cannon
    cone(s(-0.802, 0.56), s(-0.784, 0.25), 0.058, 0.05, 0.02),
    sphere(s(-0.78, 0.228), 0.063, 0.022),
    cone(s(-0.779, 0.21), s(-0.775, 0.10), 0.052, 0.06, 0.02),
    cone(s(-0.773, 0.095), s(-0.77, 0.015), 0.062, 0.075, 0.015),
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
      root: [0.45, 1.14, -0.175],
      mid: [0.472, 0.585, -0.17],
      fetlock: [0.485, 0.228, -0.165],
      coronet: [0.49, 0.095, -0.165],
    },
    frontR: {
      root: [0.45, 1.14, 0.175],
      mid: [0.472, 0.585, 0.17],
      fetlock: [0.485, 0.228, 0.165],
      coronet: [0.49, 0.095, 0.165],
    },
    hindL: {
      root: [-0.52, 1.26, -0.18],
      mid: [-0.80, 0.585, -0.165],
      fetlock: [-0.78, 0.228, -0.165],
      coronet: [-0.773, 0.095, -0.165],
    },
    hindR: {
      root: [-0.52, 1.26, 0.18],
      mid: [-0.80, 0.585, 0.165],
      fetlock: [-0.78, 0.228, 0.165],
      coronet: [-0.773, 0.095, 0.165],
    },
    pelvis: [-0.56, 1.32, 0],
    spine: [-0.02, 1.30, 0],
    chest: [0.36, 1.28, 0],
    neck1: [0.32, 1.44, 0],
    neck2: [0.62, 1.67, 0],
    head: [0.94, 1.94, 0],
    muzzle: [1.35, 1.47, 0],
    tail1: [-0.92, 1.45, 0],
    tail2: [-1.02, 1.28, 0],
    tail3: [-1.05, 1.05, 0],
    earL: [0.93, 2.05, -0.067],
    earR: [0.93, 2.05, 0.067],
  };
}

export const SDF_BOUNDS: { min: Vec3; max: Vec3 } = {
  min: [-1.18, -0.10, -0.46],
  max: [1.48, 2.28, 0.46],
};
