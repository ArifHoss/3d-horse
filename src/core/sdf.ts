/**
 * Signed distance field primitives and a compiled evaluator.
 *
 * Everything is scalar/plain-number in the hot loop: evaluating a 1.4M point
 * grid several times per load is the one place where allocation would hurt.
 *
 * Conventions: X forward, Y up, Z to the horse's right.
 */

import { smin, smax } from "./blend";

export type Prim = {
  kind: "sphere" | "ellipsoid" | "capsule" | "cone" | "box";
  /** center (sphere/ellipsoid/box) or segment start (capsule/cone) */
  cx: number;
  cy: number;
  cz: number;
  /** radii (ellipsoid), radius (sphere/capsule), r1 (cone) or half-extents (box) */
  rx: number;
  ry: number;
  rz: number;
  /** segment end (capsule/cone) */
  dx: number;
  dy: number;
  dz: number;
  /** cone end radius */
  r2: number;
  /** inverse rotation matrix (row-major, world -> local) for oriented prisms */
  ix: number;
  iy: number;
  iz: number;
  jx: number;
  jy: number;
  jz: number;
  kx: number;
  ky: number;
  kz: number;
  /** smooth-union blend radius with the accumulated field */
  k: number;
  /** subtract instead of union */
  sub: boolean;
  /** bounding radius from the primitive's centre, for culling */
  bound: number;
};

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const;

function base(): Prim {
  return {
    kind: "sphere",
    cx: 0, cy: 0, cz: 0,
    rx: 0, ry: 0, rz: 0,
    dx: 0, dy: 0, dz: 0,
    r2: 0,
    ix: 1, iy: 0, iz: 0,
    jx: 0, jy: 1, jz: 0,
    kx: 0, ky: 0, kz: 1,
    k: 0.05,
    sub: false,
    bound: 0,
  };
}

export const sphere = (c: number[], r: number, k = 0.06): Prim => {
  const p = base();
  p.kind = "sphere";
  p.cx = c[0]; p.cy = c[1]; p.cz = c[2];
  p.rx = r;
  p.k = k;
  p.bound = r;
  return p;
};

/** Ellipsoid, optionally rotated by an euler triple (radians, XYZ order). */
export const ellipsoid = (c: number[], r: number[], euler: [number, number, number] | null, k = 0.08): Prim => {
  const p = base();
  p.kind = "ellipsoid";
  p.cx = c[0]; p.cy = c[1]; p.cz = c[2];
  p.rx = r[0]; p.ry = r[1]; p.rz = r[2];
  p.k = k;
  p.bound = Math.max(r[0], r[1], r[2]);
  if (euler) {
    const [rx, ry, rz] = euler;
    // R = Rz*Ry*Rx ; store inverse (transpose) rows
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);
    // world -> local rows of R^T
    p.ix = cz * cy; p.iy = sz * cy; p.iz = -sy;
    p.jx = cz * sy * sx - sz * cx;
    p.jy = sz * sy * sx + cz * cx;
    p.jz = cy * sx;
    p.kx = cz * sy * cx + sz * sx;
    p.ky = sz * sy * cx - cz * sx;
    p.kz = cy * cx;
    p.bound *= 1.0;
  } else {
    p.ix = IDENTITY[0]; p.iy = IDENTITY[1]; p.iz = IDENTITY[2];
    p.jx = IDENTITY[3]; p.jy = IDENTITY[4]; p.jz = IDENTITY[5];
    p.kx = IDENTITY[6]; p.ky = IDENTITY[7]; p.kz = IDENTITY[8];
  }
  return p;
};

/** Capsule between two points, constant radius. */
export const capsule = (a: number[], b: number[], r: number, k = 0.05): Prim => {
  const p = base();
  p.kind = "capsule";
  p.cx = a[0]; p.cy = a[1]; p.cz = a[2];
  p.dx = b[0] - a[0]; p.dy = b[1] - a[1]; p.dz = b[2] - a[2];
  p.rx = r;
  p.k = k;
  p.bound = Math.hypot(p.dx, p.dy, p.dz) / 2 + r;
  // re-centre the bound at the segment midpoint using the sphere/box centre
  p.bound = Math.hypot(p.dx, p.dy, p.dz) + r + 0.001;
  return p;
};

/** Round cone (tapered capsule) between two points with radii r1 -> r2. */
export const cone = (a: number[], b: number[], r1: number, r2: number, k = 0.05): Prim => {
  const p = capsule(a, b, r1, k);
  p.kind = "cone";
  p.r2 = r2;
  p.bound = Math.hypot(p.dx, p.dy, p.dz) + Math.max(r1, r2) + 0.001;
  return p;
};

/** Oriented box. */
export const box = (c: number[], half: number[], euler: [number, number, number], k = 0.02): Prim => {
  const p = ellipsoid(c, half, euler, k);
  p.kind = "box";
  p.bound = Math.hypot(half[0], half[1], half[2]);
  return p;
};

export const subtract = (p: Prim, k = 0.02): Prim => {
  p.sub = true;
  p.k = k;
  return p;
};

/* ------------------------------------------------------------------ *
 * Brep/sdf algos
 * ------------------------------------------------------------------ */

function evalPrim(p: Prim, px: number, py: number, pz: number): number {
  switch (p.kind) {
    case "sphere": {
      return Math.hypot(px - p.cx, py - p.cy, pz - p.cz) - p.rx;
    }
    case "ellipsoid": {
      const qx0 = px - p.cx, qy0 = py - p.cy, qz0 = pz - p.cz;
      const qx = p.ix * qx0 + p.iy * qy0 + p.iz * qz0;
      const qy = p.jx * qx0 + p.jy * qy0 + p.jz * qz0;
      const qz = p.kx * qx0 + p.ky * qy0 + p.kz * qz0;
      const ax = qx / p.rx, ay = qy / p.ry, az = qz / p.rz;
      const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
      const bx = ax / p.rx, by = ay / p.ry, bz = az / p.rz;
      const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
      if (k1 < 1e-9) return -Math.min(p.rx, p.ry, p.rz);
      return (k0 * (k0 - 1)) / k1;
    }
    case "capsule": {
      const pax = px - p.cx, pay = py - p.cy, paz = pz - p.cz;
      const len2 = p.dx * p.dx + p.dy * p.dy + p.dz * p.dz;
      let t = len2 > 1e-12 ? (pax * p.dx + pay * p.dy + paz * p.dz) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = pax - p.dx * t, ey = pay - p.dy * t, ez = paz - p.dz * t;
      return Math.sqrt(ex * ex + ey * ey + ez * ez) - p.rx;
    }
    case "cone": {
      // iq's sdRoundCone — exact distance to a tapered capsule
      const pax = px - p.cx, pay = py - p.cy, paz = pz - p.cz;
      const bx = p.dx, by = p.dy, bz = p.dz;
      const r1 = p.rx, r2 = p.r2;
      const l2 = bx * bx + by * by + bz * bz;
      if (l2 < 1e-12) return Math.hypot(pax, pay, paz) - Math.max(r1, r2);
      const rr = r1 - r2;
      const a2 = l2 - rr * rr;
      const il2 = 1 / l2;
      const y = pax * bx + pay * by + paz * bz;
      const z = y - l2;
      const xa = pax * l2 - bx * y;
      const ya = pay * l2 - by * y;
      const za = paz * l2 - bz * y;
      const x2 = xa * xa + ya * ya + za * za;
      const y2 = y * y * l2;
      const z2 = z * z * l2;
      const k = Math.sign(rr) * rr * rr * x2;
      if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
      if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
      return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
    }
    case "box": {
      const qx0 = px - p.cx, qy0 = py - p.cy, qz0 = pz - p.cz;
      const qx = Math.abs(p.ix * qx0 + p.iy * qy0 + p.iz * qz0) - p.rx;
      const qy = Math.abs(p.jx * qx0 + p.jy * qy0 + p.jz * qz0) - p.ry;
      const qz = Math.abs(p.kx * qx0 + p.ky * qy0 + p.kz * qz0) - p.rz;
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
      return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, qy, qz), 0);
    }
  }
}

export type Sdf = (x: number, y: number, z: number) => number;

/** Compile a primitive list into a single field function with distance culling. */
export function compile(prims: Prim[]): Sdf {
  const n = prims.length;
  const P = prims;
  return (x, y, z) => {
    let d = 1e9;
    for (let i = 0; i < n; i++) {
      const p = P[i];
      if (!p.sub) {
        // cull: distance to the primitive's bounding sphere
        const bx = x - p.cx, by = y - p.cy, bz = z - p.cz;
        const bd = Math.sqrt(bx * bx + by * by + bz * bz) - p.bound;
        if (bd > Math.abs(d) + p.k) continue;
        const di = evalPrim(p, x, y, z);
        d = smin(d, di, p.k);
      }
    }
    for (let i = 0; i < n; i++) {
      const p = P[i];
      if (p.sub) d = smax(d, -evalPrim(p, x, y, z), p.k);
    }
    return d;
  };
}

/** Central-difference gradient — returns into a scratch triple. */
export function gradient(f: Sdf, x: number, y: number, z: number, eps: number, out: number[]): number[] {
  out[0] = f(x + eps, y, z) - f(x - eps, y, z);
  out[1] = f(x, y + eps, z) - f(x, y - eps, z);
  out[2] = f(x, y, z + eps) - f(x, y, z - eps);
  const l = Math.hypot(out[0], out[1], out[2]) || 1;
  out[0] /= l; out[1] /= l; out[2] /= l;
  return out;
}
