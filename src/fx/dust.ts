/**
 * Hoof dust: a small particle system that puffs where a hoof lands and drifts
 * backwards with the ground.
 */

import * as THREE from "three";

const MAX = 420;

const vertexShader = /* glsl */ `
  attribute float aAlpha;
  attribute float aSize;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * (300.0 / max(0.001, -mv.z));
  }
`;

const fragmentShader = /* glsl */ `
  varying float vAlpha;
  uniform vec3 uColor;
  void main() {
    vec2 p = gl_PointCoord - vec2(0.5);
    float d = length(p) * 2.0;
    float a = smoothstep(1.0, 0.15, d) * vAlpha;
    if (a <= 0.002) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

export class Dust {
  readonly points: THREE.Points;
  private geo: THREE.BufferGeometry;
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private alpha = new Float32Array(MAX);
  private cursor = 0;
  private material: THREE.ShaderMaterial;

  constructor() {
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1000);
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uColor: { value: new THREE.Color("#b8ab8a").convertSRGBToLinear() } },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  /** Puff of dust at a world position. */
  spawn(p: THREE.Vector3, strength: number, groundSpeed: number) {
    const count = 3 + Math.round(strength * 9);
    for (let i = 0; i < count; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
      const spread = 0.12 + Math.random() * 0.2;
      this.pos[k * 3] = p.x + (Math.random() - 0.5) * spread;
      this.pos[k * 3 + 1] = p.y + Math.random() * 0.05;
      this.pos[k * 3 + 2] = p.z + (Math.random() - 0.5) * spread;
      // kick up and back, then be carried by the ground
      this.vel[k * 3] = -groundSpeed * (0.15 + Math.random() * 0.35) + (Math.random() - 0.5) * 0.5;
      this.vel[k * 3 + 1] = 0.35 + Math.random() * 0.7 * (0.4 + strength);
      this.vel[k * 3 + 2] = (Math.random() - 0.5) * 0.6;
      this.maxLife[k] = 0.55 + Math.random() * 0.75;
      this.life[k] = this.maxLife[k];
      this.size[k] = 0.16 + Math.random() * 0.3;
      this.alpha[k] = 0;
    }
  }

  update(dt: number, groundSpeed: number) {
    if (dt <= 0) return;
    for (let k = 0; k < MAX; k++) {
      if (this.life[k] <= 0) {
        this.alpha[k] = 0;
        continue;
      }
      this.life[k] -= dt;
      const t = Math.max(0, this.life[k] / this.maxLife[k]);
      // fade in fast, out slow
      this.alpha[k] = Math.min(1, t * 2.2) * 0.42 * t;
      this.size[k] += dt * 0.35;
      this.vel[k * 3 + 1] -= dt * 0.55;
      const drag = Math.exp(-dt * 1.8);
      this.vel[k * 3] *= drag;
      this.vel[k * 3 + 1] *= drag;
      this.vel[k * 3 + 2] *= drag;
      this.pos[k * 3] += this.vel[k * 3] * dt;
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt;
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      // the ground is moving under the horse
      this.pos[k * 3] -= groundSpeed * dt * 0.55;
      if (this.pos[k * 3 + 1] < 0.01) {
        this.pos[k * 3 + 1] = 0.01;
        this.vel[k * 3 + 1] *= -0.25;
      }
    }
    this.geo.getAttribute("position").needsUpdate = true;
    this.geo.getAttribute("aAlpha").needsUpdate = true;
    this.geo.getAttribute("aSize").needsUpdate = true;
  }
}
