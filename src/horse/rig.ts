/**
 * The rig: a bone hierarchy derived from the same joint table that placed the
 * anatomy, plus automatic skin weights computed from bone proximity and
 * smoothed across the mesh.
 *
 * Bones are authored in world space: the animation sets a world position and
 * rotation per bone, and `apply()` converts those into the local transforms
 * the skeleton needs. That keeps leg IK free of parent-accumulation maths.
 */

import * as THREE from "three";
import type { Joints, Vec3 } from "./anatomy";
import type { MeshData } from "../core/isosurface";

export interface BoneSpec {
  name: string;
  parent: string | null;
  rest: Vec3;
  /** end of the bone segment: used for skin weighting */
  end: Vec3;
  /** whether the bone participates in skinning */
  skin: boolean;
  /** world-space pivots for the leg bones are computed by IK, not by rotation */
  kind: "body" | "leg" | "tail" | "ear";
}

export interface LegChain {
  side: "L" | "R";
  front: boolean;
  /** bone names from the top of the chain down */
  scapula?: string;
  root: string;
  mid: string;
  pastern: string;
  hoof: string;
  /** rest joint positions */
  restRoot: Vec3;
  restMid: Vec3;
  restFetlock: Vec3;
  restCoronet: Vec3;
  /** lengths of the two IK segments */
  l1: number;
  l2: number;
  pasternLength: number;
  hoofLength: number;
  z: number;
}

const v3 = (a: Vec3 | number[]) => new THREE.Vector3(a[0], a[1], a[2]);

export function boneSpecs(j: Joints): BoneSpec[] {
  const specs: BoneSpec[] = [
    { name: "root", parent: null, rest: [0, 0, 0], end: [0, 0.5, 0], skin: false, kind: "body" },
    { name: "pelvis", parent: "root", rest: j.pelvis, end: j.spine, skin: true, kind: "body" },
    { name: "spine", parent: "pelvis", rest: j.spine, end: j.chest, skin: true, kind: "body" },
    { name: "chest", parent: "spine", rest: j.chest, end: j.neck1, skin: true, kind: "body" },
    { name: "neck1", parent: "chest", rest: j.neck1, end: j.neck2, skin: true, kind: "body" },
    { name: "neck2", parent: "neck1", rest: j.neck2, end: j.head, skin: true, kind: "body" },
    { name: "head", parent: "neck2", rest: j.head, end: j.muzzle, skin: true, kind: "body" },
    { name: "tail1", parent: "pelvis", rest: j.tail1, end: j.tail2, skin: true, kind: "tail" },
    { name: "tail2", parent: "tail1", rest: j.tail2, end: j.tail3, skin: true, kind: "tail" },
    { name: "tail3", parent: "tail2", rest: j.tail3, end: [j.tail3[0] - 0.04, j.tail3[1] - 0.32, 0], skin: true, kind: "tail" },
  ];

  const earEnd = (side: number): Vec3 => [j.earL[0] - 0.05, j.earL[1] + 0.14, 0.083 * side];
  specs.push(
    { name: "earL", parent: "head", rest: [j.earL[0], j.earL[1], -Math.abs(j.earL[2])], end: earEnd(-1), skin: true, kind: "ear" },
    { name: "earR", parent: "head", rest: [j.earR[0], j.earR[1], Math.abs(j.earR[2])], end: earEnd(1), skin: true, kind: "ear" },
  );

  for (const side of ["L", "R"] as const) {
    const sign = side === "L" ? -1 : 1;
    const front = side === "L" ? j.frontL : j.frontR;
    const hind = side === "L" ? j.hindL : j.hindR;

    // front leg: scapula -> shoulder -> carpus -> pastern -> hoof
    specs.push({
      name: `scapula${side}`,
      parent: "chest",
      rest: [0.235, 1.505, front.root[2]],
      end: front.root,
      skin: true,
      kind: "leg",
    });
    specs.push(
      { name: `shoulder${side}`, parent: `scapula${side}`, rest: front.root, end: front.mid, skin: true, kind: "leg" },
      { name: `carpus${side}`, parent: `shoulder${side}`, rest: front.mid, end: front.fetlock, skin: true, kind: "leg" },
      { name: `pasternF${side}`, parent: `carpus${side}`, rest: front.fetlock, end: front.coronet, skin: true, kind: "leg" },
      { name: `hoofF${side}`, parent: `pasternF${side}`, rest: front.coronet, end: [front.coronet[0], front.coronet[1] - 0.1, front.coronet[2]], skin: true, kind: "leg" },
    );
    // hind leg: hip -> hock -> pastern -> hoof
    specs.push(
      { name: `hip${side}`, parent: "pelvis", rest: hind.root, end: hind.mid, skin: true, kind: "leg" },
      { name: `hock${side}`, parent: `hip${side}`, rest: hind.mid, end: hind.fetlock, skin: true, kind: "leg" },
      { name: `pasternH${side}`, parent: `hock${side}`, rest: hind.fetlock, end: hind.coronet, skin: true, kind: "leg" },
      { name: `hoofH${side}`, parent: `pasternH${side}`, rest: hind.coronet, end: [hind.coronet[0], hind.coronet[1] - 0.1, hind.coronet[2]], skin: true, kind: "leg" },
    );
    void sign;
  }

  return specs;
}

export function legChains(j: Joints): LegChain[] {
  const make = (side: "L" | "R", front: boolean): LegChain => {
    const leg = front ? (side === "L" ? j.frontL : j.frontR) : side === "L" ? j.hindL : j.hindR;
    const l1 = Math.hypot(leg.mid[0] - leg.root[0], leg.mid[1] - leg.root[1], leg.mid[2] - leg.root[2]);
    const l2 = Math.hypot(leg.fetlock[0] - leg.mid[0], leg.fetlock[1] - leg.mid[1], leg.fetlock[2] - leg.mid[2]);
    const pasternLength = Math.hypot(leg.coronet[0] - leg.fetlock[0], leg.coronet[1] - leg.fetlock[1], leg.coronet[2] - leg.fetlock[2]);
    const hoofLength = 0.095;
    return {
      side,
      front,
      scapula: front ? `scapula${side}` : undefined,
      root: front ? `shoulder${side}` : `hip${side}`,
      mid: front ? `carpus${side}` : `hock${side}`,
      pastern: front ? `pasternF${side}` : `pasternH${side}`,
      hoof: front ? `hoofF${side}` : `hoofH${side}`,
      restRoot: leg.root,
      restMid: leg.mid,
      restFetlock: leg.fetlock,
      restCoronet: leg.coronet,
      l1,
      l2,
      pasternLength,
      hoofLength,
      z: leg.root[2],
    };
  };
  return [make("L", true), make("R", true), make("L", false), make("R", false)];
}

/* ------------------------------------------------------------------ *
 * Rig
 * ------------------------------------------------------------------ */

type WorldXform = { p: THREE.Vector3; q: THREE.Quaternion };

export class Rig {
  readonly specs: BoneSpec[];
  readonly bones: THREE.Bone[] = [];
  readonly byName = new Map<string, THREE.Bone>();
  readonly rest = new Map<string, { p: THREE.Vector3; end: THREE.Vector3 }>();
  readonly world = new Map<string, WorldXform>();
  readonly order: string[] = [];
  readonly root!: THREE.Bone;
  skeleton: THREE.Skeleton;

  /**
   * The body transform: a rigid rotation of the whole body about `bodyPivot`
   * plus an offset. Leg joints are solved in ground space, so the body can bob
   * and pitch without the hooves leaving the ground.
   */
  bodyPivot = new THREE.Vector3(0.05, 1.28, 0);
  bodyRotation = new THREE.Quaternion();
  bodyOffset = new THREE.Vector3();

  /** Map a rest-space point through the body transform. */
  toBody(p: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(p).sub(this.bodyPivot).applyQuaternion(this.bodyRotation).add(this.bodyPivot).add(this.bodyOffset);
  }

  /** Place a body bone from the rest pose through the body transform. */
  setBodyBone(name: string, localQuat?: THREE.Quaternion) {
    const w = this.world.get(name)!;
    const rest = this.rest.get(name)!.p;
    this.toBody(rest, w.p);
    w.q.copy(this.bodyRotation);
    if (localQuat) w.q.multiply(localQuat);
  }

  constructor(joints: Joints) {
    this.specs = boneSpecs(joints);
    const byName = new Map<string, THREE.Bone>();
    for (const spec of this.specs) {
      const bone = new THREE.Bone();
      bone.name = spec.name;
      byName.set(spec.name, bone);
      this.byName.set(spec.name, bone);
      this.bones.push(bone);
      this.rest.set(spec.name, { p: v3(spec.rest), end: v3(spec.end) });
      this.world.set(spec.name, { p: v3(spec.rest), q: new THREE.Quaternion() });
    }
    for (const spec of this.specs) {
      const bone = byName.get(spec.name)!;
      if (spec.parent) byName.get(spec.parent)!.add(bone);
      else this.root = bone;
    }
    // hierarchy order (parents first)
    const visit = (name: string) => {
      this.order.push(name);
      for (const spec of this.specs) if (spec.parent === name) visit(spec.name);
    };
    visit("root");
    // rest local transforms
    for (const name of this.order) {
      const spec = this.specs.find((s) => s.name === name)!;
      const bone = byName.get(name)!;
      if (spec.parent) {
        const parentRest = this.rest.get(spec.parent)!.p;
        bone.position.copy(v3(spec.rest)).sub(parentRest);
      } else {
        bone.position.copy(v3(spec.rest));
      }
      bone.quaternion.identity();
    }
    // The bind pose is the rest pose: compute the bone inverses from it.
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.bones);
    this.skeleton.calculateInverses();
  }

  /** Restore every world transform to the rest pose. */
  reset() {
    for (const name of this.order) {
      const rest = this.rest.get(name)!;
      const w = this.world.get(name)!;
      w.p.copy(rest.p);
      w.q.identity();
    }
  }

  setWorldPos(name: string, p: THREE.Vector3) {
    this.world.get(name)!.p.copy(p);
  }

  setWorldQuat(name: string, q: THREE.Quaternion) {
    this.world.get(name)!.q.copy(q);
  }

  /** Rotate a bone (and its subtree) in its parent's frame. */
  rotateLocal(name: string, x: number, y: number, z: number) {
    const w = this.world.get(name)!;
    const parentName = this.specs.find((s) => s.name === name)!.parent;
    const pq = parentName ? this.world.get(parentName)!.q : new THREE.Quaternion();
    const local = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, "YXZ"));
    w.q.copy(pq).multiply(local);
    // recompute the bone's own position from the parent's transform
    if (parentName) {
      const parent = this.world.get(parentName)!;
      const restOffset = v3(this.specs.find((s) => s.name === name)!.rest).sub(this.rest.get(parentName)!.p);
      w.p.copy(parent.p).add(restOffset.applyQuaternion(parent.q));
    }
  }

  /** Write the authored world transforms into the scene graph. */
  apply() {
    const pq = new THREE.Quaternion();
    const pp = new THREE.Vector3();
    for (const name of this.order) {
      const bone = this.byName.get(name)!;
      const w = this.world.get(name)!;
      const spec = this.specs.find((s) => s.name === name)!;
      if (spec.parent) {
        const parentWorld = this.world.get(spec.parent)!;
        pq.copy(parentWorld.q).invert();
        pp.copy(w.p).sub(parentWorld.p).applyQuaternion(pq);
        bone.position.copy(pp);
        bone.quaternion.copy(pq).multiply(w.q);
      } else {
        bone.position.copy(w.p);
        bone.quaternion.copy(w.q);
      }
      bone.updateMatrix();
      bone.matrixWorld.multiplyMatrices(
        spec.parent ? this.byName.get(spec.parent)!.matrixWorld : new THREE.Matrix4(),
        bone.matrix,
      );
    }
    this.skeleton.update();
  }
}

/* ------------------------------------------------------------------ *
 * Skin weights
 * ------------------------------------------------------------------ */

function distanceToSegment(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): number {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = px - (ax + dx * t), ey = py - (ay + dy * t), ez = pz - (az + dz * t);
  return Math.sqrt(ex * ex + ey * ey + ez * ez);
}

/**
 * Compute skin indices/weights: nearest bone segments by inverse-distance,
 * then Laplacian-smoothed over the mesh so joints bend smoothly.
 */
export function computeSkin(
  rig: Rig,
  mesh: MeshData,
  neighbours: number[][],
  maxInfluences = 4,
): { index: Uint16Array; weight: Float32Array } {
  // Three.js always reads four influences per vertex.
  const slots = 4;
  const skinned = rig.specs.filter((s) => s.skin);
  // skin indices address the skeleton's own bone array, which includes
  // non-deforming bones such as the root
  const skeletonIndex = skinned.map((s) => rig.bones.findIndex((b) => b.name === s.name));
  const nb = skinned.length;
  const nv = mesh.vertexCount;

  // raw inverse-distance weights, top-k
  const weights: Float32Array[] = [];
  const power = 5;
  for (let v = 0; v < nv; v++) {
    const x = mesh.positions[v * 3];
    const y = mesh.positions[v * 3 + 1];
    const z = mesh.positions[v * 3 + 2];
    const d: number[] = new Array(nb);
    for (let b = 0; b < nb; b++) {
      const spec = skinned[b];
      const r = rig.rest.get(spec.name)!;
      d[b] = distanceToSegment(x, y, z, r.p.x, r.p.y, r.p.z, r.end.x, r.end.y, r.end.z);
    }
    // top-k by inverse distance
    const order = Array.from({ length: nb }, (_, i) => i).sort((a, b) => d[a] - d[b]);
    const w = new Float32Array(nb);
    let sum = 0;
    for (let k = 0; k < Math.min(maxInfluences, nb); k++) {
      const b = order[k];
      const dd = Math.max(d[b], 0.008);
      const ww = 1 / Math.pow(dd, power);
      w[b] = ww;
      sum += ww;
    }
    if (sum > 0) for (let b = 0; b < nb; b++) w[b] /= sum;
    weights.push(w);
  }

  // smooth across the surface so joints deform gradually
  const tmp = new Float32Array(nb);
  for (let iter = 0; iter < 6; iter++) {
    const next: Float32Array[] = new Array(nv);
    for (let v = 0; v < nv; v++) {
      const w = weights[v];
      const acc = new Float32Array(nb);
      const nbrs = neighbours[v];
      if (!nbrs || nbrs.length === 0) {
        acc.set(w);
      } else {
        const inv = 1 / nbrs.length;
        for (const n of nbrs) {
          const nw = weights[n];
          for (let b = 0; b < nb; b++) acc[b] += nw[b] * inv;
        }
        for (let b = 0; b < nb; b++) acc[b] = w[b] * 0.6 + acc[b] * 0.4;
      }
      // prune to the strongest influences and renormalise
      let total = 0;
      for (let b = 0; b < nb; b++) total += acc[b];
      if (total > 0) for (let b = 0; b < nb; b++) acc[b] /= total;
      next[v] = acc;
    }
    for (let v = 0; v < nv; v++) weights[v] = next[v];
  }

  const index = new Uint16Array(nv * slots);
  const weight = new Float32Array(nv * slots);
  for (let v = 0; v < nv; v++) {
    const w = weights[v];
    const order = Array.from({ length: nb }, (_, i) => i).sort((a, b) => w[b] - w[a]);
    let sum = 0;
    tmp.fill(0);
    const n = Math.min(maxInfluences, slots);
    for (let k = 0; k < n; k++) {
      const b = order[k];
      sum += w[b];
      tmp[k] = w[b];
    }
    for (let k = 0; k < slots; k++) {
      index[v * slots + k] = k < n ? skeletonIndex[order[k]] : 0;
      weight[v * slots + k] = sum > 0 ? tmp[k] / sum : k === 0 ? 1 : 0;
    }
  }
  return { index, weight };
}

/** Rebuild mesh adjacency (used for smoothing). */
export function adjacency(vertexCount: number, indices: Uint32Array): number[][] {
  const sets: Set<number>[] = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) sets[i] = new Set();
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    sets[a].add(b); sets[a].add(c);
    sets[b].add(a); sets[b].add(c);
    sets[c].add(a); sets[c].add(b);
  }
  return sets.map((s) => Array.from(s));
}
