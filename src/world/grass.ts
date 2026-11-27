/**
 * The field: a single-draw-call grass carpet that scrolls under the horse.
 *
 * Blades are baked into one buffer with a per-vertex "root + bend + level"
 * description, then the vertex shader displaces them. Root positions wrap
 * modulo the tile length in the travel direction, so the field is endless
 * without ever touching the CPU.
 */

import * as THREE from "three";
import { fbm2, rng } from "../core/math";

export interface GrassOptions {
  count?: number;
  radius?: number;
  tile?: number;
  seed?: number;
  palette?: { base: THREE.Color; tip: THREE.Color; dry: THREE.Color };
}

const DEFAULT_PALETTE = {
  base: new THREE.Color("#3a5620").convertSRGBToLinear(),
  tip: new THREE.Color("#b9d275").convertSRGBToLinear(),
  dry: new THREE.Color("#bdaa6d").convertSRGBToLinear(),
};

const vertexShader = /* glsl */ `
  attribute vec3 aRoot;
  attribute vec3 aBlade;   // x: height, y: width, z: phase
  attribute vec2 aBend;
  attribute vec3 aColor;
  attribute float aLevel;  // 0 at the root, 1 at the tip

  uniform float uTime;
  uniform float uScroll;
  uniform float uTile;
  uniform float uWind;
  uniform float uRadius;

  varying vec3 vColor;
  varying float vLevel;
  varying float vLight;
  varying float vDist;

  void main() {
    // wrap along the travel direction so the field is endless
    vec3 root = aRoot;
    root.x = mod(root.x - uScroll + uTile * 0.5, uTile) - uTile * 0.5;
    root.z = mod(root.z, uTile) - uTile * 0.5;

    float t = aLevel;
    float phase = aBlade.z;
    // wind: a slow gust plus a fast flutter
    float gust = sin(uTime * 0.9 + root.x * 0.16 + root.z * 0.11) * 0.5 + 0.5;
    float flutter = sin(uTime * 3.1 + phase * 6.2831) * 0.5 + 0.5;
    float sway = (gust * 0.7 + flutter * 0.3) * uWind;

    vec3 p = root;
    p.xz += aBend * (t * t) * (aBlade.x * 0.55 + sway * 0.05);
    p.y += t * aBlade.x;
    // widen around the blade's axis, tapering to a point at the tip
    vec2 perp = vec2(-aBend.y, aBend.x);
    float side = position.x < 0.0 ? -1.0 : 1.0;
    p.xz += perp * side * aBlade.y * 0.5 * (1.0 - t * 0.8);
    // the tip leans over a little further than the base
    p.xz += perp * side * aBlade.y * 0.0;

    // fade the carpet out at the edge of the field so it never shows a rim
    float radius = length(root.xz);
    float edge = 1.0 - smoothstep(uRadius * 0.55, uRadius * 0.97, radius);
    p.y *= mix(0.35, 1.0, edge);

    vLevel = t;
    vColor = aColor * mix(0.55, 1.0, edge);
    // fake lighting: blades facing the sun catch more light
    vec3 sunDir = normalize(vec3(0.42, 0.62, 0.66));
    vLight = 0.62 + 0.5 * abs(dot(normalize(vec3(aBend.x, 0.75, aBend.y)), sunDir));

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uBase;
  uniform vec3 uTip;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform vec3 uSunColor;

  varying vec3 vColor;
  varying float vLevel;
  varying float vLight;
  varying float vDist;

  void main() {
    vec3 col = vColor;
    // slight backlight on the tips
    col += uSunColor * pow(vLevel, 3.0) * 0.05;
    col *= vLight;
    float fog = 1.0 - exp(-pow(uFogDensity * vDist, 2.0));
    col = mix(col, uFogColor, fog);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createGrass(opts: GrassOptions = {}): {
  mesh: THREE.Mesh;
  update: (dt: number, scrollSpeed: number) => void;
  material: THREE.ShaderMaterial;
} {
  const count = opts.count ?? 42000;
  const radius = opts.radius ?? 42;
  const tile = opts.tile ?? 90;
  const palette = opts.palette ?? DEFAULT_PALETTE;
  const rand = rng(opts.seed ?? 7);

  const levels = [0, 1];
  const verts = levels.length * 2;
  const positions = new Float32Array(count * verts * 3);
  const roots = new Float32Array(count * verts * 3);
  const blades = new Float32Array(count * verts * 3);
  const bends = new Float32Array(count * verts * 2);
  const colors = new Float32Array(count * verts * 3);
  const levelAttr = new Float32Array(count * verts);
  const indices = new Uint32Array(count * (verts - 2) * 3 + count * 3);

  let vi = 0;
  let ii = 0;
  const base = new THREE.Color();
  const tip = new THREE.Color();
  const dry = new THREE.Color();

  // blades are generated in tufts: a few blades sharing a root cluster
  let i = 0;
  while (i < count) {
    const u = rand();
    const r = radius * Math.sqrt(u);
    const a = rand() * Math.PI * 2;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;

    // drier patches from low frequency noise
    const dryMix = Math.min(1, Math.max(0, fbm2(cx * 0.13, cz * 0.13, 3) * 1.6));
    const tuftSize = 5 + Math.floor(rand() * 7);
    const tuftRadius = 0.02 + rand() * 0.05;
    const tuftHeight = 0.085 + rand() * 0.13 + (r < 10 ? 0.05 : 0);
    const tuftBend = rand() * Math.PI * 2;

    for (let b = 0; b < tuftSize && i < count; b++, i++) {
      const ta = rand() * Math.PI * 2;
      const tr = tuftRadius * Math.sqrt(rand());
      const rx = cx + Math.cos(ta) * tr;
      const rz = cz + Math.sin(ta) * tr;

      const height = tuftHeight * (0.55 + rand() * 0.75);
      const width = 0.019 + rand() * 0.022;
      const bendAngle = tuftBend + (rand() - 0.5) * 0.9;
      const bx = Math.cos(bendAngle);
      const bz = Math.sin(bendAngle);
      const phase = rand();

      base.copy(palette.base).lerp(palette.dry, dryMix * 0.45);
      tip.copy(palette.tip).lerp(palette.dry, dryMix * 0.8);
      const shade = 0.72 + rand() * 0.5;

      const first = vi;
      for (let l = 0; l < levels.length; l++) {
        const t = levels[l];
        for (let sd = 0; sd < 2; sd++) {
          roots[vi * 3] = rx;
          roots[vi * 3 + 1] = 0;
          roots[vi * 3 + 2] = rz;
          blades[vi * 3] = height;
          blades[vi * 3 + 1] = width;
          blades[vi * 3 + 2] = phase;
          bends[vi * 2] = bx;
          bends[vi * 2 + 1] = bz;
          positions[vi * 3] = sd === 0 ? -1 : 1;
          positions[vi * 3 + 1] = 0;
          positions[vi * 3 + 2] = 0;
          const c = base.clone().lerp(tip, Math.pow(t, 0.8));
          colors[vi * 3] = c.r * shade;
          colors[vi * 3 + 1] = c.g * shade;
          colors[vi * 3 + 2] = c.b * shade;
          levelAttr[vi] = t;
          vi++;
        }
      }
      for (let l = 0; l < levels.length - 1; l++) {
        const a0 = first + l * 2;
        const a1 = a0 + 1;
        const b0 = a0 + 2;
        const b1 = a0 + 3;
        indices[ii++] = a0; indices[ii++] = b0; indices[ii++] = a1;
        indices[ii++] = a1; indices[ii++] = b0; indices[ii++] = b1;
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aRoot", new THREE.BufferAttribute(roots, 3));
  geo.setAttribute("aBlade", new THREE.BufferAttribute(blades, 3));
  geo.setAttribute("aBend", new THREE.BufferAttribute(bends, 2));
  geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("aLevel", new THREE.BufferAttribute(levelAttr, 1));
  geo.setIndex(new THREE.BufferAttribute(indices.subarray(0, ii), 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius + 10);

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uTile: { value: tile },
      uWind: { value: 1 },
      uRadius: { value: radius },
      uBase: { value: palette.base },
      uTip: { value: palette.tip },
      uFogColor: { value: new THREE.Color("#cfdfe8").convertSRGBToLinear() },
      uFogDensity: { value: 0.043 },
      uSunColor: { value: new THREE.Color("#fff3d8").convertSRGBToLinear() },
    },
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;

  let scroll = 0;
  const update = (dt: number, speed: number) => {
    scroll += speed * dt;
    material.uniforms.uTime.value += dt;
    material.uniforms.uScroll.value = scroll;
  };

  return { mesh, update, material };
}

/** Ground plane the grass grows out of. */
export function createGround(_palette = DEFAULT_PALETTE, radius = 120): THREE.Mesh {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n =
        fbm2(x * 0.055, y * 0.055, 4) * 0.5 +
        fbm2(x * 0.22, y * 0.22, 3) * 0.3 +
        fbm2(x * 0.9, y * 0.9, 2) * 0.2;
      const v = 0.5 + n * 0.5;
      // canvas values are read as sRGB, so write sRGB numbers here
      const k = 0.78 + v * 0.42;
      const shade = Math.max(0, n) * 0.55;
      const r = 42 + shade * 26;
      const g = 56 + shade * 24;
      const b = 28 + shade * 16;
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, r * k);
      img.data[i + 1] = Math.min(255, g * k);
      img.data[i + 2] = Math.min(255, b * k);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(9, 9);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  const geo = new THREE.PlaneGeometry(radius * 2, radius * 2, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}
