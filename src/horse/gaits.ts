/**
 * Gaits and the leg solver.
 *
 * A gait is a set of four phase-offset footfall patterns plus body motion
 * parameters. The horse runs on a treadmill: the ground scrolls backwards at
 * the gait's speed, and a planted hoof is fixed in world space for the whole
 * of its stance, which is what makes it look like it is really pushing off.
 */

import * as THREE from "three";
import type { LegChain, Rig } from "./rig";
import { clamp, frac, lerp, smootherstep, smoothstep } from "../core/math";

export type GaitName = "stand" | "walk" | "trot" | "canter" | "gallop" | "rear";

export interface GaitDef {
  name: GaitName;
  label: string;
  /** seconds per stride cycle */
  cycle: number;
  /** fraction of the cycle a hoof is planted */
  duty: number;
  /** metres a hoof travels backwards relative to the body while planted */
  stance: number;
  /** the hind limbs are longer and travel further */
  stanceHind: number;
  /** swing arc height (m) */
  lift: number;
  /** phase offsets in cycles: [frontL, frontR, hindL, hindR] */
  phases: [number, number, number, number];
  /** body bob (m), bobs per cycle, phase offset */
  bobAmp: number;
  bobCount: number;
  bobPhase: number;
  /** body pitch (rad) and its frequency in cycles */
  pitchAmp: number;
  pitchCount: number;
  pitchPhase: number;
  /** lateral sway (m) */
  swayAmp: number;
  /** neck / head pose offsets (rad) plus nod */
  neckPitch: number;
  headPitch: number;
  nodAmp: number;
  nodCount: number;
  /** tail lift and swish */
  tailLift: number;
  tailSwish: number;
  /** how much the scapula helps the reach (0..1) */
  scapula: number;
}

export const GAITS: Record<GaitName, GaitDef> = {
  stand: {
    name: "stand", label: "Stand",
    cycle: 1.0, duty: 1, stance: 0, stanceHind: 0, lift: 0,
    phases: [0, 0, 0, 0],
    bobAmp: 0, bobCount: 0, bobPhase: 0,
    pitchAmp: 0, pitchCount: 0, pitchPhase: 0, swayAmp: 0,
    neckPitch: 0, headPitch: 0, nodAmp: 0, nodCount: 0,
    tailLift: 0, tailSwish: 0.35, scapula: 0,
  },
  walk: {
    name: "walk", label: "Walk",
    cycle: 1.08, duty: 0.62, stance: 0.48, stanceHind: 0.58, lift: 0.10,
    phases: [0.0, 0.5, 0.25, 0.75],
    bobAmp: 0.012, bobCount: 2, bobPhase: 0.25,
    pitchAmp: 0.012, pitchCount: 2, pitchPhase: 0.1, swayAmp: 0.012,
    neckPitch: 0.02, headPitch: 0.02, nodAmp: 0.045, nodCount: 2,
    tailLift: -0.02, tailSwish: 0.5, scapula: 1,
  },
  trot: {
    name: "trot", label: "Trot",
    cycle: 0.72, duty: 0.44, stance: 0.54, stanceHind: 0.66, lift: 0.17,
    phases: [0.0, 0.5, 0.5, 0.0],
    bobAmp: 0.028, bobCount: 2, bobPhase: 0.22,
    pitchAmp: 0.02, pitchCount: 2, pitchPhase: 0.05, swayAmp: 0.016,
    neckPitch: 0.0, headPitch: -0.04, nodAmp: 0.055, nodCount: 2,
    tailLift: 0.10, tailSwish: 0.6, scapula: 1,
  },
  canter: {
    name: "canter", label: "Canter",
    cycle: 0.60, duty: 0.36, stance: 0.58, stanceHind: 0.70, lift: 0.22,
    phases: [0.34, 0.68, 0.0, 0.34],
    bobAmp: 0.045, bobCount: 1, bobPhase: 0.4,
    pitchAmp: 0.05, pitchCount: 1, pitchPhase: 0.3, swayAmp: 0.01,
    neckPitch: -0.05, headPitch: -0.06, nodAmp: 0.07, nodCount: 1,
    tailLift: 0.22, tailSwish: 0.7, scapula: 1,
  },
  gallop: {
    name: "gallop", label: "Gallop",
    cycle: 0.44, duty: 0.27, stance: 0.62, stanceHind: 0.72, lift: 0.26,
    phases: [0.46, 0.58, 0.0, 0.12],
    bobAmp: 0.06, bobCount: 1, bobPhase: 0.45,
    pitchAmp: 0.09, pitchCount: 1, pitchPhase: 0.35, swayAmp: 0.008,
    neckPitch: -0.10, headPitch: -0.10, nodAmp: 0.09, nodCount: 1,
    tailLift: 0.36, tailSwish: 0.9, scapula: 1,
  },
  rear: {
    name: "rear", label: "Rear",
    cycle: 1.0, duty: 1, stance: 0, stanceHind: 0, lift: 0,
    phases: [0, 0, 0, 0],
    bobAmp: 0, bobCount: 0, bobPhase: 0,
    pitchAmp: 0, pitchCount: 0, pitchPhase: 0, swayAmp: 0,
    neckPitch: 0.1, headPitch: 0.05, nodAmp: 0, nodCount: 0,
    tailLift: 0.2, tailSwish: 0.2, scapula: 0,
  },
};

/** Ground speed of a gait, m/s — derived, so hooves never slide. */
export function gaitSpeed(g: GaitDef): number {
  if (g.duty <= 0 || g.stance === 0) return 0;
  return g.stance / (g.duty * g.cycle);
}

export interface HoofTarget {
  x: number;
  z: number;
  y: number;
  /** 0 = planted, 1 = fully in swing */
  swing: number;
  /** progress through the cycle, 0..1 */
  phase: number;
}

/**
 * Where each hoof wants to be, in horse-local space, at a given gait phase.
 * `strideScale` lets gaits blend (the targets are interpolated by the caller).
 */
export function hoofTargets(g: GaitDef, phase: number, out: HoofTarget[]) {
  for (let i = 0; i < 4; i++) {
    const legPhase = frac(phase + g.phases[i]);
    const o = out[i];
    const stance = i < 2 ? g.stance : g.stanceHind;
    o.phase = legPhase;
    if (g.duty >= 1 || stance <= 0) {
      o.x = 0;
      o.y = 0;
      o.z = 0;
      o.swing = 0;
      continue;
    }
    const half = stance * 0.5;
    if (legPhase < g.duty) {
      const s = legPhase / g.duty;
      o.x = half - s * stance;
      o.y = 0;
      o.swing = 0;
    } else {
      const s = (legPhase - g.duty) / (1 - g.duty);
      o.x = -half + smootherstep(0, 1, s) * stance;
      o.y = g.lift * Math.pow(Math.sin(Math.PI * s), 0.85);
      o.swing = Math.sin(Math.PI * clamp(s));
    }
    // hooves track slightly inside the shoulder line at speed
    o.z = 0;
  }
}

/* ------------------------------------------------------------------ *
 * IK
 * ------------------------------------------------------------------ */

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _tmpQ = new THREE.Quaternion();
const _restDir = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const FORWARD_Z = new THREE.Vector3(0, 0, 1);

function quatFromTo(from: THREE.Vector3, to: THREE.Vector3, out: THREE.Quaternion) {
  return out.setFromUnitVectors(from, to);
}

export interface LegPoseInput {
  /** desired hoof contact point, horse-local space */
  hoof: THREE.Vector3;
  /** 0 planted .. 1 airborne */
  swing: number;
  /** extra pastern tilt while swinging (rad) */
  tilt?: number;
}

/**
 * Solve one leg's joints and write the bone transforms into the rig.
 *
 * Ground space is absolute: the hoof target is where the foot should touch
 * down, the body transform only moves the limb's root. Targets beyond the
 * limb's reach are projected back onto it, so the leg never detaches.
 */
export function solveLeg(rig: Rig, chain: LegChain, input: LegPoseInput) {
  const hoofWant = input.hoof;
  const swing = input.swing;

  // ---- limb root -------------------------------------------------------
  const body = rig.bodyRotation;
  let rootPos: THREE.Vector3;
  if (chain.front && chain.scapula) {
    // The scapula rocks with the leg: this is where a horse's front-limb
    // reach comes from, and it reads as the shoulder moving under the skin.
    const pivotRest = rig.rest.get(chain.scapula)!.p;
    const dx = clamp(hoofWant.x - chain.restCoronet[0], -0.5, 0.5);
    const angle = dx * 0.45;
    _a.set(chain.restRoot[0] - pivotRest.x, chain.restRoot[1] - pivotRest.y, 0);
    _a.applyAxisAngle(FORWARD_Z, angle);
    rootPos = new THREE.Vector3(
      pivotRest.x + _a.x + dx * 0.15,
      pivotRest.y + _a.y - Math.abs(dx) * 0.03,
      chain.restRoot[2],
    );
    const sp = rig.world.get(chain.scapula)!;
    rig.toBody(new THREE.Vector3(pivotRest.x + dx * 0.05, pivotRest.y, pivotRest.z), sp.p);
    sp.q.copy(body).multiply(_tmpQ.setFromAxisAngle(FORWARD_Z, angle * 0.9));
    rig.toBody(rootPos, rootPos);
  } else {
    rootPos = rig.toBody(new THREE.Vector3(chain.restRoot[0], chain.restRoot[1], chain.restRoot[2]));
  }

  // ---- fetlock target: pastern length above the hoof --------------------
  const tilt = (input.tilt ?? 0.35) * swing;
  const pLen = chain.pasternLength;
  const fetlockWant = new THREE.Vector3(
    hoofWant.x - Math.sin(tilt) * pLen,
    hoofWant.y + Math.cos(tilt) * pLen,
    hoofWant.z,
  );

  // ---- two-bone IK ------------------------------------------------------
  const dir = _v.copy(fetlockWant).sub(rootPos);
  const dist = dir.length();
  const maxReach = (chain.l1 + chain.l2) * 0.998;
  const minReach = Math.abs(chain.l1 - chain.l2) + 0.03;
  const clamped = clamp(dist, minReach, maxReach);
  dir.normalize();

  const a = (chain.l1 * chain.l1 - chain.l2 * chain.l2 + clamped * clamped) / (2 * clamped);
  const h = Math.sqrt(Math.max(0, chain.l1 * chain.l1 - a * a));

  // pole: front knees fold backwards, hocks point backwards
  const poleDir = chain.front ? _a.set(1, 0.05, 0) : _a.set(-1, 0.05, 0);
  poleDir.sub(_b.copy(dir).multiplyScalar(poleDir.dot(dir))).normalize();

  const mid = new THREE.Vector3().copy(rootPos).addScaledVector(dir, a).addScaledVector(poleDir, h);
  const fetlock = new THREE.Vector3().copy(rootPos).addScaledVector(dir, clamped);
  // if the target was out of reach, carry the whole hoof with it
  const hoof = new THREE.Vector3().copy(hoofWant).add(fetlock).sub(fetlockWant);

  // ---- write bones ------------------------------------------------------
  const boneA = rig.world.get(chain.root)!;
  boneA.p.copy(rootPos);
  const restA = rig.rest.get(chain.root)!;
  _restDir.copy(restA.end).sub(restA.p).normalize();
  _b.copy(mid).sub(rootPos).normalize();
  boneA.q.copy(quatFromTo(_restDir, _b, _tmpQ));

  const boneB = rig.world.get(chain.mid)!;
  boneB.p.copy(mid);
  const restB = rig.rest.get(chain.mid)!;
  _restDir.copy(restB.end).sub(restB.p).normalize();
  _b.copy(fetlock).sub(mid).normalize();
  boneB.q.copy(quatFromTo(_restDir, _b, _tmpQ));

  const boneC = rig.world.get(chain.pastern)!;
  boneC.p.copy(fetlock);
  const restC = rig.rest.get(chain.pastern)!;
  _restDir.copy(restC.end).sub(restC.p).normalize();
  _b.copy(hoof).sub(fetlock).normalize();
  boneC.q.copy(quatFromTo(_restDir, _b, _tmpQ));

  // the hoof stays flat on the ground when planted and hangs from the
  // pastern when it is in the air
  const boneD = rig.world.get(chain.hoof)!;
  boneD.p.copy(hoof);
  const restD = rig.rest.get(chain.hoof)!;
  _restDir.copy(restD.end).sub(restD.p).normalize();
  _b.copy(DOWN).lerp(_a.copy(hoof).sub(fetlock).normalize(), swing * 0.6).normalize();
  boneD.q.copy(quatFromTo(_restDir, _b, _tmpQ));
}
