/**
 * The horse: mesh, rig, hair, eyes and the animation controller.
 */

import * as THREE from "three";
import { buildSdf, joints, SDF_BOUNDS, type Joints, type Vec3 } from "./anatomy";
import { surfaceNets, type MeshData } from "../core/isosurface";
import { adjacency, computeSkin, legChains, Rig, type LegChain } from "./rig";
import { GAITS, gaitSpeed, hoofTargets, solveLeg, type GaitName } from "./gaits";
import { coatColors, hairColors, COATS, type Coat } from "./coat";
import { buildMane, buildTail } from "./hair";
import { clamp, damp, frac, lerp, smoothstep, TAU } from "../core/math";

export interface HoofEvent {
  leg: number;
  x: number;
  z: number;
  strength: number;
}

const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpV = new THREE.Vector3();

export class Horse {
  readonly group = new THREE.Group();
  readonly rig: Rig;
  readonly chains: LegChain[];
  readonly joints: Joints;
  readonly body: THREE.SkinnedMesh;
  readonly mane: THREE.SkinnedMesh;
  readonly tail: THREE.SkinnedMesh;
  readonly eyes: THREE.Mesh[] = [];
  readonly stats: { vertices: number; triangles: number; buildMs: number };

  coat: Coat = COATS[0];
  private bodyData!: MeshData;
  private maneData!: MeshData;
  private tailData!: MeshData;

  // ---- animation state
  gaitName: GaitName = "stand";
  private prevName: GaitName = "stand";
  private blend = 1;
  phase = 0;
  time = 0;
  speed = 0;
  /** rear action progress 0..1 (0 = not rearing) */
  rear = 0;
  private rearing = false;
  private look = new THREE.Vector3(0, 1.2, 4);
  private lookWeight = 0;
  private headYaw = 0;
  private headPitch = 0;
  private earFlick = [0, 0];
  private earTimer = 2.5;
  private events: HoofEvent[] = [];
  private prevSwing = [0, 0, 0, 0];
  private hoofPos = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private targetsA = [0, 1, 2, 3].map(() => ({ x: 0, y: 0, z: 0, swing: 0, phase: 0 }));
  private targetsB = [0, 1, 2, 3].map(() => ({ x: 0, y: 0, z: 0, swing: 0, phase: 0 }));

  constructor(onProgress?: (f: number, label: string) => void) {
    const t0 = performance.now();
    const sdf = buildSdf();
    const mesh = surfaceNets(sdf, SDF_BOUNDS.min, SDF_BOUNDS.max, {
      h: 0.0205,
      smoothIterations: 3,
      projectIterations: 2,
      aoStrength: 0.62,
      onProgress,
    });

    this.bodyData = mesh;
    this.joints = joints();
    this.rig = new Rig(this.joints);
    this.chains = legChains(this.joints);

    // ---- body mesh -----------------------------------------------------
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(coatColors(mesh, this.coat), 3));
    geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));

    const nbrs = adjacency(mesh.vertexCount, mesh.indices);
    const skin = computeSkin(this.rig, mesh, nbrs, 4);
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skin.index, 4));
    geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skin.weight, 4));
    geo.computeBoundingSphere();

    const mat = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.66,
      metalness: 0,
      // coat sheen: the soft, slightly directional highlight horsehair has
      sheen: 0.42,
      sheenRoughness: 0.6,
      sheenColor: new THREE.Color("#e6cfae"),
    });

    this.body = new THREE.SkinnedMesh(geo, mat);
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.body.frustumCulled = false;

    // ---- hair ----------------------------------------------------------
    const maneData = buildMane(this.joints);
    const tailData = buildTail(this.joints);
    this.maneData = maneData;
    this.tailData = tailData;
    this.mane = this.makeHair(maneData, "mane");
    this.tail = this.makeHair(tailData, "tail");

    // ---- assemble ------------------------------------------------------
    this.group.add(this.rig.root);
    this.group.add(this.body);
    this.group.add(this.mane);
    this.group.add(this.tail);
    this.group.updateMatrixWorld(true);
    this.body.bind(this.rig.skeleton);
    this.mane.bind(this.rig.skeleton);
    this.tail.bind(this.rig.skeleton);

    // ---- eyes ----------------------------------------------------------
    const eyeMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x140d09),
      roughness: 0.08,
      metalness: 0.0,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
    });
    const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const headBone = this.rig.byName.get("head")!;
    const headRest = this.joints.head;
    for (const side of [1, -1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.042, 24, 18), eyeMat);
      eye.position.set(1.097 - headRest[0], 1.849 - headRest[1], 0.084 * side);
      headBone.add(eye);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 10, 8), glintMat);
      glint.position.set(0.026, 0.019, 0.028 * side);
      eye.add(glint);
      this.eyes.push(eye);
    }

    this.stats = {
      vertices: mesh.vertexCount,
      triangles: mesh.triangleCount,
      buildMs: performance.now() - t0,
    };
    this.rig.reset();
    this.rig.apply();
  }

  private makeHair(data: MeshData, kind: "mane" | "tail"): THREE.SkinnedMesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(hairColors(data.vertexCount, this.coat.mane, kind === "mane" ? 3 : 9), 3));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    const nbrs = adjacency(data.vertexCount, data.indices);
    const skin = computeSkin(this.rig, data, nbrs, 3);
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skin.index, 4));
    geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skin.weight, 4));
    geo.computeBoundingSphere();

    const mat = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.42,
      metalness: 0,
      sheen: 1,
      sheenRoughness: 0.3,
      sheenColor: new THREE.Color("#8a7a6a"),
      side: THREE.DoubleSide,
    });
    const m = new THREE.SkinnedMesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = false;
    m.frustumCulled = false;
    return m;
  }

  /** Change the coat — only the vertex colours change, the mesh stays. */
  setCoat(index: number) {
    this.coat = COATS[index];
    if (!this.bodyData) return;
    const bodyGeo = this.body.geometry;
    (bodyGeo.getAttribute("color") as THREE.BufferAttribute).array.set(coatColors(this.bodyData, this.coat));
    bodyGeo.getAttribute("color").needsUpdate = true;
    const recolor = (mesh: THREE.SkinnedMesh, data: MeshData, seed: number) => {
      (mesh.geometry.getAttribute("color") as THREE.BufferAttribute).array.set(
        hairColors(data.vertexCount, this.coat.mane, seed),
      );
      mesh.geometry.getAttribute("color").needsUpdate = true;
    };
    recolor(this.mane, this.maneData, 3);
    recolor(this.tail, this.tailData, 9);
  }

  setGait(name: GaitName) {
    if (name === this.gaitName) return;
    this.prevName = this.gaitName;
    this.gaitName = name;
    this.blend = 0;
  }

  setLookTarget(p: THREE.Vector3) {
    this.look.copy(p);
  }

  /** How much the head follows the look target (0 = ignores it). */
  setLookWeight(w: number) {
    this.lookWeight = clamp(w, 0, 1);
  }

  triggerRear() {
    if (!this.rearing) {
      this.rearing = true;
    }
  }

  drainEvents(): HoofEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  update(dt: number) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    const g = GAITS[this.gaitName];
    const gp = GAITS[this.prevName];
    this.blend = Math.min(1, this.blend + dt / 0.30);
    const bl = smoothstep(0, 1, this.blend);

    // gait phase, advanced at the blended cadence
    const cycle = lerp(gp.cycle, g.cycle, bl);
    const moving = g.stance > 0 || gp.stance > 0;
    if (moving) this.phase = frac(this.phase + dt / cycle);

    // ---- speed & ground -------------------------------------------------
    this.speed = lerp(gaitSpeed(gp), gaitSpeed(g), bl);

    // ---- hoof targets ---------------------------------------------------
    hoofTargets(g, this.phase, this.targetsA);
    hoofTargets(gp, this.phase, this.targetsB);

    // ---- body motion ----------------------------------------------------
    const wave = (count: number, phaseOffset: number) =>
      count > 0 ? Math.sin((this.phase * count + phaseOffset) * TAU) : 0;

    const bobAmp = lerp(gp.bobAmp, g.bobAmp, bl);
    const bobCount = Math.max(g.bobCount, gp.bobCount);
    const bobPhase = lerp(gp.bobPhase, g.bobPhase, bl);
    let bob = bobAmp * wave(bobCount, bobPhase);
    let pitch = lerp(gp.pitchAmp, g.pitchAmp, bl) * wave(Math.max(g.pitchCount, 1), lerp(gp.pitchPhase, g.pitchPhase, bl));
    let roll = lerp(gp.swayAmp, g.swayAmp, bl) * wave(1, 0.1);

    // breathing and weight shift when idle
    const idle = 1 - smoothstep(0, 0.25, this.speed);
    bob += Math.sin(this.time * 1.5) * 0.004 * idle;
    roll += Math.sin(this.time * 0.42) * 0.006 * idle;

    // ---- rear action ----------------------------------------------------
    if (this.rearing) {
      // 0.0 -> 0.22 up, 0.22 -> 0.72 hold, 0.72 -> 1.0 down
      const rate = this.rear < 0.22 ? 0.22 / 0.55 : this.rear < 0.72 ? 0.5 / 1.3 : 0.28 / 0.65;
      this.rear = Math.min(1, this.rear + dt * rate);
      if (this.rear >= 1) {
        this.rearing = false;
        this.rear = 0;
      }
    }
    const rearAmount = this.rear > 0
      ? this.rear < 0.25 ? smoothstep(0, 0.25, this.rear)
        : this.rear < 0.72 ? 1
          : 1 - smoothstep(0.72, 1, this.rear)
      : 0;

    pitch += rearAmount * 0.72;
    bob -= rearAmount * 0.06;

    // body transform: pitch about the hind hooves when rearing, else the body centre
    const pivot = rearAmount > 0.01
      ? tmpV.set(-0.78, 0.02, 0)
      : tmpV.set(0.05, 1.28, 0);
    this.rig.bodyPivot.copy(pivot);
    this.rig.bodyRotation.setFromEuler(tmpE.set(0, 0, pitch));
    this.rig.bodyRotation.multiply(tmpQ.setFromEuler(new THREE.Euler(roll, 0, 0)));
    this.rig.bodyOffset.set(0, bob, 0);

    // ---- body bones -----------------------------------------------------
    this.rig.setBodyBone("pelvis");
    // spine bend, neck lift, head nod
    const neckLift = lerp(gp.neckPitch, g.neckPitch, bl) + rearAmount * 0.18
      + Math.sin(this.time * 1.1) * 0.012 * idle;
    const headNodAmp = lerp(gp.nodAmp, g.nodAmp, bl);
    const headNod = headNodAmp * wave(Math.max(g.nodCount, 1), 0.35);
    const bend = -pitch * 0.25 + Math.sin(this.phase * TAU) * 0.006;

    this.rig.rotateLocal("spine", bend * 0.6, 0, 0);
    this.rig.rotateLocal("chest", bend * 0.4 + pitch * 0.15, 0, 0);
    this.rig.rotateLocal("neck1", neckLift * 0.45 + headNod * 0.35, this.headYaw * 0.35, 0);
    this.rig.rotateLocal("neck2", neckLift * 0.5 + headNod * 0.4, this.headYaw * 0.35, 0);
    this.rig.rotateLocal("head", neckLift * 0.35 + headNod * 0.5 + lerp(gp.headPitch, g.headPitch, bl), this.headYaw * 0.3, 0);

    // ears flick
    this.earTimer -= dt;
    if (this.earTimer <= 0) {
      this.earTimer = 2.5 + Math.random() * 5;
      const which = Math.random() > 0.5 ? 0 : 1;
      this.earFlick[which] = 1;
    }
    for (let i = 0; i < 2; i++) {
      this.earFlick[i] = Math.max(0, this.earFlick[i] - dt * 3.2);
      const f = Math.sin(this.earFlick[i] * Math.PI) * 0.5;
      const name = i === 0 ? "earL" : "earR";
      this.rig.rotateLocal(name, -f * 0.6, 0, (i === 0 ? 1 : -1) * f * 0.4 + (i === 0 ? -0.05 : 0.05));
    }

    // tail
    const swish = lerp(gp.tailSwish, g.tailSwish, bl);
    const tailLift = lerp(gp.tailLift, g.tailLift, bl) + rearAmount * 0.15;
    const tw = Math.sin(this.time * 1.35) * 0.5 + Math.sin(this.time * 0.61 + 1.3) * 0.5;
    this.rig.rotateLocal("tail1", -tailLift, tw * 0.22 * swish, 0);
    this.rig.rotateLocal("tail2", -tailLift * 0.6 + Math.sin(this.time * 1.7 + 0.4) * 0.05 * swish, tw * 0.26 * swish, 0);
    this.rig.rotateLocal("tail3", -tailLift * 0.4 + Math.sin(this.time * 2.1 + 1.1) * 0.07 * swish, tw * 0.3 * swish, 0);

    // ---- head look-at ----------------------------------------------------
    const headBonePos = this.rig.world.get("head")!.p;
    tmpV.copy(this.look).sub(headBonePos);
    const desiredYaw = clamp(Math.atan2(-tmpV.z, tmpV.x), -0.9, 0.9) * this.lookWeight;
    const desiredPitch = clamp(Math.atan2(tmpV.y, Math.hypot(tmpV.x, tmpV.z)), -0.5, 0.6) * this.lookWeight;
    this.headYaw = damp(this.headYaw, desiredYaw, 3.4, dt);
    this.headPitch = damp(this.headPitch, desiredPitch, 3.0, dt);
    if (Math.abs(desiredYaw) > 0.001) {
      // apply as a yaw offset on top of the nod
      const n1 = this.rig.world.get("neck1")!;
      const n2 = this.rig.world.get("neck2")!;
      tmpQ.setFromAxisAngle(tmpV.set(0, 1, 0), this.headYaw * 0.35);
      n1.q.premultiply(tmpQ);
      tmpQ.setFromAxisAngle(tmpV.set(0, 1, 0), this.headYaw * 0.35);
      n2.q.premultiply(tmpQ);
      const hq = this.rig.world.get("head")!;
      tmpQ.setFromAxisAngle(tmpV.set(0, 1, 0), this.headYaw * 0.3);
      hq.q.premultiply(tmpQ);
      tmpQ.setFromAxisAngle(tmpV.set(0, 0, 1), -this.headPitch * 0.25);
      hq.q.premultiply(tmpQ);
    }

    // ---- legs ------------------------------------------------------------
    for (let i = 0; i < 4; i++) {
      const chain = this.chains[i];
      const a = this.targetsA[i];
      const b = this.targetsB[i];
      const tx = lerp(b.x, a.x, bl);
      const ty = lerp(b.y, a.y, bl);
      const swing = lerp(b.swing, a.swing, bl);
      const restX = chain.restCoronet[0];
      const restZ = chain.restCoronet[2];
      const standY = chain.restCoronet[1];

      let hx = restX + tx;
      let hy = standY + ty;
      let hz = restZ;
      let useSwing = swing;

      // while rearing, the front hooves leave the ground and paw
      if (rearAmount > 0.01 && chain.front) {
        const paw = Math.sin(this.time * 7 + (i === 0 ? 0 : 1.7)) * 0.5 + 0.5;
        const lift = rearAmount;
        hx = lerp(hx, restX + 0.30 + paw * 0.12, lift);
        hy = lerp(hy, standY + 0.62 + paw * 0.22, lift);
        useSwing = Math.max(useSwing, lift * 0.9);
      }

      this.hoofPos[i].set(hx, hy, hz);
      solveLeg(this.rig, chain, { hoof: this.hoofPos[i], swing: useSwing });

      // hoof-beat events on touchdown
      if (this.prevSwing[i] > 0.35 && useSwing <= 0.12 && this.speed > 0.1) {
        const strength = clamp(this.speed / 6, 0.25, 1);
        this.events.push({ leg: i, x: hx, z: hz, strength });
      }
      this.prevSwing[i] = useSwing;
    }

    this.rig.apply();
  }

  /** World position of a hoof (for audio panning / dust). */
  hoofWorld(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.hoofPos[i]).applyMatrix4(this.group.matrixWorld);
  }
}
