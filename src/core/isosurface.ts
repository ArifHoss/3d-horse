/**
 * Isosurface extraction: naive surface nets (dual contouring without QEF),
 * followed by Taubin smoothing, a couple of Newton projections back onto the
 * true isosurface, SDF-gradient normals and SDF ambient occlusion.
 *
 * The result is a watertight, smooth, well-shaded mesh with roughly one vertex
 * per surface-crossing cell — cheap enough to rebuild in flight.
 */

import { gradient, type Sdf } from "./sdf";

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** SDF-based ambient occlusion, 0 (occluded) .. 1 (open) */
  ao: Float32Array;
  vertexCount: number;
  triangleCount: number;
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

export interface IsoOptions {
  h?: number;
  smoothIterations?: number;
  smoothLambda?: number;
  smoothMu?: number;
  projectIterations?: number;
  aoSamples?: number;
  aoStrength?: number;
  onProgress?: (fraction: number, label: string) => void;
}

const EDGE_TABLE: number[][] = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

export function surfaceNets(
  f: Sdf,
  min: [number, number, number],
  max: [number, number, number],
  opts: IsoOptions = {},
): MeshData {
  const h = opts.h ?? 0.022;
  const progress = opts.onProgress ?? (() => {});

  const nx = Math.ceil((max[0] - min[0]) / h) + 1;
  const ny = Math.ceil((max[1] - min[1]) / h) + 1;
  const nz = Math.ceil((max[2] - min[2]) / h) + 1;
  const N = nx * ny * nz;
  const field = new Float32Array(N);

  // --- sample ------------------------------------------------------------
  for (let k = 0; k < nz; k++) {
    const z = min[2] + k * h;
    for (let j = 0; j < ny; j++) {
      const y = min[1] + j * h;
      const row = nx * (j + ny * k);
      for (let i = 0; i < nx; i++) {
        field[row + i] = f(min[0] + i * h, y, z);
      }
    }
    if ((k & 15) === 0) progress(0.05 + 0.55 * (k / nz), "sampling field");
  }

  // A surface that touches the sampling box gets clipped into an open hole,
  // which reads as a mysterious flat disc. Say so instead of shipping it.
  let touches = false;
  for (let k = 0; k < nz && !touches; k++)
    for (let j = 0; j < ny && !touches; j++)
      for (let i = 0; i < nx; i++) {
        if (i !== 0 && i !== nx - 1 && j !== 0 && j !== ny - 1 && k !== 0 && k !== nz - 1) continue;
        if (field[i + nx * (j + ny * k)] < 0) { touches = true; break; }
      }
  if (touches) console.warn("isosurface: field is negative on the sampling boundary — bounds too tight");

  const cx = nx - 1;
  const cy = ny - 1;
  const cz = nz - 1;
  const cellCount = cx * cy * cz;
  const cellVert = new Int32Array(cellCount).fill(-1);

  const pos: number[] = [];
  const corner = new Float32Array(8);

  // --- vertex per crossing cell -----------------------------------------
  const off = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const o = off[c];
          const v = field[(i + o[0]) + nx * ((j + o[1]) + ny * (k + o[2]))];
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;

        let sx = 0, sy = 0, sz = 0, cnt = 0;
        for (let e = 0; e < 12; e++) {
          const [a, b] = EDGE_TABLE[e];
          const va = corner[a];
          const vb = corner[b];
          if ((va < 0) === (vb < 0)) continue;
          const t = va / (va - vb);
          const oa = off[a];
          const ob = off[b];
          sx += oa[0] + (ob[0] - oa[0]) * t;
          sy += oa[1] + (ob[1] - oa[1]) * t;
          sz += oa[2] + (ob[2] - oa[2]) * t;
          cnt++;
        }
        if (!cnt) continue;
        const idx = pos.length / 3;
        pos.push(
          min[0] + (i + sx / cnt) * h,
          min[1] + (j + sy / cnt) * h,
          min[2] + (k + sz / cnt) * h,
        );
        cellVert[i + cx * (j + cy * k)] = idx;
      }
    }
    if ((k & 15) === 0) progress(0.62 + 0.2 * (k / cz), "building surface");
  }

  // --- quads per crossing grid edge --------------------------------------
  const tris: number[] = [];
  const vCell = (i: number, j: number, k: number) =>
    cellVert[i + cx * (j + cy * k)];

  const quad = (a: number, b: number, c: number, d: number) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    tris.push(a, b, c, a, c, d);
  };

  // x edges
  for (let k = 1; k < cz; k++) {
    for (let j = 1; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        const v0 = field[i + nx * (j + ny * k)];
        const v1 = field[i + 1 + nx * (j + ny * k)];
        if ((v0 < 0) === (v1 < 0)) continue;
        quad(vCell(i, j - 1, k - 1), vCell(i, j, k - 1), vCell(i, j, k), vCell(i, j - 1, k));
      }
    }
  }
  // y edges
  for (let k = 1; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 1; i < cx; i++) {
        const v0 = field[i + nx * (j + ny * k)];
        const v1 = field[i + nx * (j + 1 + ny * k)];
        if ((v0 < 0) === (v1 < 0)) continue;
        quad(vCell(i - 1, j, k - 1), vCell(i, j, k - 1), vCell(i, j, k), vCell(i - 1, j, k));
      }
    }
  }
  // z edges
  for (let k = 0; k < cz; k++) {
    for (let j = 1; j < cy; j++) {
      for (let i = 1; i < cx; i++) {
        const v0 = field[i + nx * (j + ny * k)];
        const v1 = field[i + nx * (j + ny * (k + 1))];
        if ((v0 < 0) === (v1 < 0)) continue;
        quad(vCell(i - 1, j - 1, k), vCell(i, j - 1, k), vCell(i, j, k), vCell(i - 1, j, k));
      }
    }
  }

  const vertexCount = pos.length / 3;
  progress(0.84, "smoothing");

  // --- Taubin smoothing over the quad connectivity ------------------------
  const neighbours = buildNeighbours(vertexCount, tris);
  taubin(pos, neighbours, vertexCount, opts.smoothIterations ?? 3,
    opts.smoothLambda ?? 0.6, opts.smoothMu ?? -0.63);

  // --- project onto the true isosurface, then normals + AO ---------------
  const grad = [0, 0, 0];
  const projectIters = opts.projectIterations ?? 2;
  const aoStrength = opts.aoStrength ?? 1;
  const aoSamples = opts.aoSamples ?? 5;
  const ao = new Float32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    let x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    for (let it = 0; it < projectIters; it++) {
      const d = f(x, y, z);
      gradient(f, x, y, z, h * 0.4, grad);
      x -= grad[0] * d;
      y -= grad[1] * d;
      z -= grad[2] * d;
    }
    pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;

    // SDF ambient occlusion
    let occ = 0;
    let w = 1;
    for (let s = 0; s < aoSamples; s++) {
      const hh = 0.015 + 0.03 * 2 ** s;
      const dd = f(x + grad[0] * hh, y + grad[1] * hh, z + grad[2] * hh);
      occ += (hh - dd) * w;
      w *= 0.7;
    }
    ao[v] = Math.max(0, 1 - aoStrength * 1.6 * occ);
    if ((v & 2047) === 0) progress(0.84 + 0.15 * (v / vertexCount), "shading");
  }

  // final normals from the SDF gradient (perfectly smooth)
  const normals = new Float32Array(vertexCount * 3);
  for (let v = 0; v < vertexCount; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    gradient(f, x, y, z, h * 0.4, grad);
    normals[v * 3] = grad[0];
    normals[v * 3 + 1] = grad[1];
    normals[v * 3 + 2] = grad[2];
  }

  // --- winding: orient every triangle against the field gradient ---------
  const indices = new Uint32Array(tris.length);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
    const cx2 = pos[c * 3], cy2 = pos[c * 3 + 1], cz2 = pos[c * 3 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx2 - ax, e2y = cy2 - ay, e2z = cz2 - az;
    const nx2 = e1y * e2z - e1z * e2y;
    const ny2 = e1z * e2x - e1x * e2z;
    const nz2 = e1x * e2y - e1y * e2x;
    const gx = normals[a * 3] + normals[b * 3] + normals[c * 3];
    const gy = normals[a * 3 + 1] + normals[b * 3 + 1] + normals[c * 3 + 1];
    const gz = normals[a * 3 + 2] + normals[b * 3 + 2] + normals[c * 3 + 2];
    if (nx2 * gx + ny2 * gy + nz2 * gz < 0) {
      indices[t] = a; indices[t + 1] = c; indices[t + 2] = b;
    } else {
      indices[t] = a; indices[t + 1] = b; indices[t + 2] = c;
    }
  }

  progress(1, "done");
  return {
    positions: new Float32Array(pos),
    normals,
    indices,
    ao,
    vertexCount,
    triangleCount: tris.length / 3,
    bounds: { min, max },
  };
}

function buildNeighbours(vertexCount: number, tris: number[]): number[][] {
  const sets: Set<number>[] = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) sets[i] = new Set();
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    sets[a].add(b); sets[a].add(c);
    sets[b].add(a); sets[b].add(c);
    sets[c].add(a); sets[c].add(b);
  }
  return sets.map((s) => Array.from(s));
}

/** Taubin λ|μ smoothing — removes grid staircase without shrinking the mesh. */
function taubin(
  pos: number[],
  neighbours: number[][],
  count: number,
  iterations: number,
  lambda: number,
  mu: number,
) {
  const tmp = new Float32Array(count * 3);
  const step = (factor: number) => {
    for (let v = 0; v < count; v++) {
      const nb = neighbours[v];
      if (!nb.length) {
        tmp[v * 3] = pos[v * 3];
        tmp[v * 3 + 1] = pos[v * 3 + 1];
        tmp[v * 3 + 2] = pos[v * 3 + 2];
        continue;
      }
      let ax = 0, ay = 0, az = 0;
      for (let n = 0; n < nb.length; n++) {
        const o = nb[n] * 3;
        ax += pos[o]; ay += pos[o + 1]; az += pos[o + 2];
      }
      const inv = 1 / nb.length;
      tmp[v * 3] = pos[v * 3] + (ax * inv - pos[v * 3]) * factor;
      tmp[v * 3 + 1] = pos[v * 3 + 1] + (ay * inv - pos[v * 3 + 1]) * factor;
      tmp[v * 3 + 2] = pos[v * 3 + 2] + (az * inv - pos[v * 3 + 2]) * factor;
    }
    for (let v = 0; v < count; v++) {
      pos[v * 3] = tmp[v * 3];
      pos[v * 3 + 1] = tmp[v * 3 + 1];
      pos[v * 3 + 2] = tmp[v * 3 + 2];
    }
  };
  for (let i = 0; i < iterations; i++) {
    step(lambda);
    step(mu);
  }
}
