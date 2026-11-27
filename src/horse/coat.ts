/**
 * Coat colour: base colour, dark points, white markings and the muscle sheen
 * that comes from AO. Everything is computed from the rest position, so the
 * markings are baked into the vertices and travel with the deformation.
 */

import * as THREE from "three";
import type { MeshData } from "../core/isosurface";
import { clamp, hash3, noise3, smoothstep } from "../core/math";

export interface Coat {
  id: string;
  name: string;
  body: string;
  points: string;
  mane: string;
  muzzle: string;
  hoof: string;
  /** white markings: 0..1 strength */
  socks: [number, number, number, number]; // frontL, frontR, hindL, hindR
  blaze: number;
  star: number;
}

export const COATS: Coat[] = [
  {
    id: "bay", name: "Bay",
    body: "#6a3818", points: "#0f0b09", mane: "#0d0a09", muzzle: "#1a1210", hoof: "#191413",
    socks: [1, 0, 0, 0.55], blaze: 1, star: 0.9,
  },
  {
    id: "chestnut", name: "Chestnut",
    body: "#8c4a24", points: "#7f4420", mane: "#b3603a", muzzle: "#6b3a1c", hoof: "#2b2420",
    socks: [1, 0.7, 0, 0], blaze: 1, star: 0.4,
  },
  {
    id: "black", name: "Black",
    body: "#221b18", points: "#181312", mane: "#121010", muzzle: "#201a17", hoof: "#1c1917",
    socks: [0, 0, 1, 0], blaze: 0.6, star: 0.5,
  },
  {
    id: "grey", name: "Dapple grey",
    body: "#9d9a95", points: "#7e7b76", mane: "#cfcbc4", muzzle: "#6b6862", hoof: "#33302c",
    socks: [0.5, 0.8, 0.5, 0.6], blaze: 0.8, star: 0.6,
  },
  {
    id: "buckskin", name: "Buckskin",
    body: "#a5763f", points: "#241a14", mane: "#1a1210", muzzle: "#2c211a", hoof: "#2a231e",
    socks: [0, 0, 0, 0], blaze: 0, star: 0.5,
  },
];

const linear = (hex: string) => new THREE.Color(hex).convertSRGBToLinear();

/** Per-vertex colour from the rest position. */
export function coatColors(mesh: MeshData, coat: Coat): Float32Array {
  const body = linear(coat.body);
  const points = linear(coat.points);
  const muzzle = linear(coat.muzzle);
  const white = linear("#e9e3d6");
  const out = new Float32Array(mesh.vertexCount * 3);

  // leg centres, for socks
  const legs: Array<[number, number, number, number]> = [
    [0.495, -0.15, coat.socks[0], 0], // front left
    [0.495, 0.15, coat.socks[1], 0], // front right
    [-0.78, -0.15, coat.socks[2], 1], // hind left
    [-0.78, 0.15, coat.socks[3], 1], // hind right
  ];
  const sockTop = [0.26, 0.22, 0.19, 0.23];

  for (let v = 0; v < mesh.vertexCount; v++) {
    const x = mesh.positions[v * 3];
    const y = mesh.positions[v * 3 + 1];
    const z = mesh.positions[v * 3 + 2];

    // start from the body colour, with a little organic variation
    let r = body.r, g = body.g, b = body.b;
    const grain = noise3(x * 26, y * 26, z * 26) * 0.5 + noise3(x * 9, y * 9, z * 9) * 0.5;
    const grain2 = noise3(x * 60 + 4, y * 60, z * 60);
    const k = 1 + grain * 0.05 + grain2 * 0.02;
    r *= k; g *= k; b *= k;

    // dapples for greys
    if (coat.id === "grey") {
      const d = noise3(x * 16, y * 16, z * 16) + noise3(x * 34, y * 34, z * 34) * 0.5;
      if (d > 0.15) {
        r *= 0.86; g *= 0.86; b *= 0.87;
      }
    }

    // dark points: lower legs, muzzle, ear edges
    let pointMix = 0;
    for (const [lx, lz, , ] of legs) {
      const d = Math.hypot(x - lx, z - lz);
      // black from just below the knee / hock down, with a soft corona
      const byHeight = smoothstep(0.60, 0.52, y);
      const byDistance = smoothstep(0.15, 0.10, d);
      pointMix = Math.max(pointMix, byHeight * byDistance);
    }
    // muzzle
    const muzzleMix = smoothstep(1.16, 1.26, x) * smoothstep(1.72, 1.58, y);
    // ears
    const earMix = smoothstep(2.06, 2.14, y) * 0.85;
    pointMix = Math.max(pointMix, earMix);

    r = r + (points.r - r) * pointMix;
    g = g + (points.g - g) * pointMix;
    b = b + (points.b - b) * pointMix;

    // muzzle is a slightly warmer, softer dark
    r = r + (muzzle.r - r) * muzzleMix * 0.8;
    g = g + (muzzle.g - g) * muzzleMix * 0.8;
    b = b + (muzzle.b - b) * muzzleMix * 0.8;

    // white socks, with a noisy coronary band
    for (let i = 0; i < legs.length; i++) {
      const [lx, lz, strength] = legs[i];
      if (strength <= 0) continue;
      const d = Math.hypot(x - lx, z - lz);
      if (d > 0.2) continue;
      const wobble = noise3(x * 18, y * 40, z * 18) * 0.05;
      const top = sockTop[i] * (0.7 + 0.3 * strength) + wobble;
      const m = smoothstep(top + 0.02, top - 0.03, y) * smoothstep(0.2, 0.12, d) * strength;
      if (m > 0) {
        r += (white.r - r) * m;
        g += (white.g - g) * m;
        b += (white.b - b) * m;
      }
    }

    // face frame: along the face axis (from the poll, 52° below horizontal)
    const fx = x - 0.98;
    const fy = y - 1.98;
    const along = fx * 0.6157 + fy * -0.788;

    // blaze down the face
    if (coat.blaze > 0) {
      const across = Math.abs(z);
      const wobble = noise3(x * 26, y * 26, z * 26) * 0.016;
      const width = 0.013 + Math.max(0, along) * 0.03 + wobble;
      const m =
        smoothstep(width + 0.014, width - 0.014, across) *
        smoothstep(0.08, 0.16, along) *
        smoothstep(0.66, 0.56, along) *
        coat.blaze;
      if (m > 0) {
        r += (white.r - r) * m;
        g += (white.g - g) * m;
        b += (white.b - b) * m;
      }
    }

    // the nose itself stays dark under a blaze, as it does on a real bay
    const noseTip = smoothstep(0.56, 0.66, along) * 0.9;
    if (noseTip > 0.001) {
      r += (muzzle.r - r) * noseTip;
      g += (muzzle.g - g) * noseTip;
      b += (muzzle.b - b) * noseTip;
    }

    // lips: a dark line where the mouth closes
    const lipBand = Math.abs(fx * 0.788 + fy * 0.6157 + 0.05);
    if (along > 0.5 && lipBand < 0.016) {
      const m = smoothstep(0.017, 0.004, lipBand) * 0.75;
      r += (muzzle.r - r) * m;
      g += (muzzle.g - g) * m;
      b += (muzzle.b - b) * m;
    }

    // star on the forehead
    if (coat.star > 0) {
      const d = Math.hypot(x - 1.07, y - 1.90, Math.abs(z) * 1.2);
      const m = smoothstep(0.055, 0.02, d) * coat.star;
      if (m > 0) {
        r += (white.r - r) * m;
        g += (white.g - g) * m;
        b += (white.b - b) * m;
      }
    }

    // ambient occlusion from the SDF darkens creases
    const ao = mesh.ao[v];
    const shade = 0.55 + 0.45 * ao;
    r *= shade; g *= shade; b *= shade;

    out[v * 3] = r;
    out[v * 3 + 1] = g;
    out[v * 3 + 2] = b;
  }
  return out;
}

/** Colour for the hair meshes (mane and tail). */
export function hairColors(count: number, base: string, seed = 3): Float32Array {
  const c = linear(base);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const k = 0.82 + hash3(i, seed, 7) * 0.36;
    out[i * 3] = c.r * k;
    out[i * 3 + 1] = c.g * k;
    out[i * 3 + 2] = c.b * k;
  }
  return out;
}

export function clamp01(v: number) {
  return clamp(v, 0, 1);
}
