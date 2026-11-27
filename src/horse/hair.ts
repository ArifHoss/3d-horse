/**
 * Hair: mane, forelock and tail.
 *
 * Strands are built in rest space as tapered ribbons and skinned to the neck
 * and tail bones. The roots are anchored to the real skin by marching the
 * signed distance field outward, so hair sits on the surface instead of
 * disappearing inside it.
 */

import type { MeshData } from "../core/isosurface";
import { buildSdf } from "./anatomy";
import { clamp, hash3 } from "../core/math";
import type { Joints, Vec3 } from "./anatomy";

interface RibbonBuilder {
  positions: number[];
  indices: number[];
  count: number;
}

/**
 * One tapered ribbon along `pts`. `axis` picks which way the ribbon's width
 * runs; hair uses two perpendicular ribbons per strand so it has volume from
 * every angle instead of vanishing edge-on.
 */
function addRibbon(b: RibbonBuilder, pts: Vec3[], widths: number[], axis: "z" | "x" = "z") {
  const base = b.count;
  for (let i = 0; i < pts.length; i++) {
    const w = widths[i];
    if (axis === "z") {
      b.positions.push(pts[i][0], pts[i][1], pts[i][2] - w * 0.5);
      b.positions.push(pts[i][0], pts[i][1], pts[i][2] + w * 0.5);
    } else {
      b.positions.push(pts[i][0] - w * 0.5, pts[i][1], pts[i][2]);
      b.positions.push(pts[i][0] + w * 0.5, pts[i][1], pts[i][2]);
    }
    b.count += 2;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = base + i * 2;
    b.indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
}

function toMeshData(b: RibbonBuilder): MeshData {
  const positions = new Float32Array(b.positions);
  const normals = new Float32Array(positions.length);
  for (let v = 0; v < b.count; v++) {
    normals[v * 3] = 0;
    normals[v * 3 + 1] = 0;
    normals[v * 3 + 2] = 1;
  }
  return {
    positions,
    normals,
    indices: new Uint32Array(b.indices),
    ao: new Float32Array(b.count).fill(1),
    vertexCount: b.count,
    triangleCount: b.indices.length / 3,
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
  };
}

type Sdf = (x: number, y: number, z: number) => number;

/**
 * March from `p` along `dir` until the field is `clearance` outside the skin.
 * Used to find where the body's surface is, so hair can lie on top of it.
 */
function pushOut(sdf: Sdf, p: Vec3, dir: Vec3, clearance = 0.008, maxDist = 0.5): Vec3 {
  const at = (t: number) => sdf(p[0] + dir[0] * t, p[1] + dir[1] * t, p[2] + dir[2] * t);
  if (at(0) >= clearance) return [p[0], p[1], p[2]];
  let lo = 0;
  let hi = maxDist;
  if (at(hi) < clearance) return [p[0] + dir[0] * lo, p[1] + dir[1] * lo, p[2] + dir[2] * lo];
  // coarse scan then bisect
  let t = lo;
  for (let i = 0; i < 24; i++) {
    const next = lo + ((hi - lo) * (i + 1)) / 24;
    if (at(next) >= clearance) {
      hi = next;
      break;
    }
    lo = next;
    t = next;
  }
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) * 0.5;
    if (at(mid) >= clearance) hi = mid;
    else lo = mid;
  }
  t = hi;
  return [p[0] + dir[0] * t, p[1] + dir[1] * t, p[2] + dir[2] * t];
}

/**
 * The top of the neck, found by marching the field upward from inside the
 * neck — the crest ridge sits above the lofted sections, so hand-placed
 * numbers drift off the surface.
 */
function crestPoint(sdf: Sdf, t: number): Vec3 {
  const x = 0.31 + t * 0.63;
  let lo = 1.55 + t * 0.36; // inside the neck
  let hi = lo + 0.35;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) * 0.5;
    if (sdf(x, mid, 0) < 0.004) lo = mid;
    else hi = mid;
  }
  return [x, hi, 0];
}

export function buildMane(joints: Joints, seed = 1): MeshData {
  const sdf = buildSdf();
  const b: RibbonBuilder = { positions: [], indices: [], count: 0 };
  const strands = 170;

  for (let i = 0; i < strands; i++) {
    const u = i / (strands - 1);
    const t = 0.005 + u * 0.985;
    const root = crestPoint(sdf, t);
    const h1 = hash3(i, seed, 1);
    const h2 = hash3(i, seed, 2);
    const h3 = hash3(i, seed, 3);

    const endFade = Math.min(1, Math.sin(Math.min(1, Math.max(0, u)) * Math.PI) * 2.2);
    const length = (0.11 + h2 * 0.22) * endFade + 0.02;
    const width = 0.010 + h1 * 0.012;
    const layer = h3 > 0.72 ? 0.02 + h1 * 0.012 : 0.001 + h1 * 0.009;

    const pts: Vec3[] = [];
    const widths: number[] = [];
    const segments = 5;
    // hang from the crest, drifting slightly back
    for (let s = 0; s <= segments; s++) {
      const v = s / segments;
      const x = root[0] - 0.02 * v - 0.09 * v * v + (h2 - 0.5) * 0.03 * v;
      const y = root[1] - v * length * 0.97;
      // snap the first two thirds onto the neck's side, then let it hang free
      let out: Vec3;
      if (v < 0.12) {
        // the root sits on the crest itself
        out = [x, y + 0.008 + h1 * 0.006, 0.012 + h1 * 0.02];
      } else if (v < 0.75) {
        out = pushOut(sdf, [x, y, 0], [0, 0, 1], 0.006 + layer);
      } else {
        out = [x - 0.01, y, anchoredZ(pts, v)];
      }
      pts.push(out);
      widths.push(width * (1 - v * 0.8));
    }
    addRibbon(b, pts, widths, "z");
    addRibbon(b, pts, widths.map((w) => w * 0.7), "x");
  }

  // forelock: falls forward over the forehead, between the ears
  for (let i = 0; i < 34; i++) {
    const h1 = hash3(i, seed + 7, 5);
    const h2 = hash3(i, seed + 7, 6);
    const root: Vec3 = [1.0 - h1 * 0.015, 1.995, (h2 - 0.5) * 0.17];
    const pts: Vec3[] = [];
    const widths: number[] = [];
    const length = 0.10 + h1 * 0.10;
    for (let s = 0; s <= 5; s++) {
      const v = s / 5;
      const p: Vec3 = [root[0] + 0.10 * v, root[1] - length * v * 0.95, root[2]];
      const out = pushOut(sdf, p, [0.788, 0.616, 0], 0.006);
      pts.push([out[0] + (h2 - 0.5) * 0.012, out[1], out[2] + (h2 - 0.5) * 0.05 * v]);
      widths.push(0.011 * (1 - v * 0.75));
    }
    addRibbon(b, pts, widths);
  }

  void joints;
  return toMeshData(b);
}

/** continue from the previous anchored point with a gentle outward drift */
function anchoredZ(pts: Vec3[], v: number): number {
  const last = pts[pts.length - 1];
  if (!last) return 0.16;
  return last[2] + 0.004 + v * 0.01;
}

export function buildTail(joints: Joints, seed = 2): MeshData {
  const b: RibbonBuilder = { positions: [], indices: [], count: 0 };
  // the dock: the fleshy base, from the croup back and down
  const dockA: Vec3 = [-0.955, 1.485, 0];
  const dockB: Vec3 = [-1.095, 1.30, 0];
  const strands = 380;

  for (let i = 0; i < strands; i++) {
    const h1 = hash3(i, seed, 11);
    const h2 = hash3(i, seed, 12);
    const h3 = hash3(i, seed, 13);
    // roots are spread along the dock, so hair leaves the body as a mass
    const du = 0.08 + h3 * 0.92;
    const root: Vec3 = [
      dockA[0] + (dockB[0] - dockA[0]) * du,
      dockA[1] + (dockB[1] - dockA[1]) * du,
      0,
    ];
    const length = 0.58 + h1 * 0.40 - du * 0.12;
    // a dense core with long outer strands that fall in a curtain
    const core = i < 60;
    const zoff = core ? (h2 - 0.5) * 0.03 : (h2 - 0.5) * 0.085;
    const back = 0.10 + h3 * 0.16;
    const width = core ? 0.06 + h1 * 0.035 : 0.03 + h1 * 0.03;
    const pts: Vec3[] = [];
    const widths: number[] = [];
    const segments = 6;
    for (let s = 0; s <= segments; s++) {
      const v = s / segments;
      // the dock drops close to the body before the hair fans out
      const drop = v < 0.2 ? v / 0.2 : 1;
      pts.push([
        root[0] - back * v * (1 - 0.4 * v) - v * v * 0.03 + (h1 - 0.5) * 0.05 * v,
        root[1] - length * v * (0.93 + 0.07 * (1 - v)),
        root[2] + zoff * drop * v * 1.05,
      ]);
      // narrow at the dock, widest in the middle, tapering to the ends
      widths.push(width * (0.35 + 0.85 * Math.sin(Math.PI * Math.min(1, v * 1.1))) * (1 - v * 0.25));
    }
    addRibbon(b, pts, widths, "z");
    addRibbon(b, pts, widths.map((w) => w * 0.8), "x");
  }

  void joints;
  return toMeshData(b);
}
