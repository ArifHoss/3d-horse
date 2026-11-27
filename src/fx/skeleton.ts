/**
 * X-ray skeleton: bones drawn as glowing rods over the ghosted body.
 */

import * as THREE from "three";
import type { Rig } from "../horse/rig";

const UP = new THREE.Vector3(0, 1, 0);

export class SkeletonView {
  readonly group = new THREE.Group();
  private rods: THREE.Mesh[] = [];
  private joints: THREE.Mesh[] = [];
  private specNames: Array<{ name: string; parent: string | null }> = [];
  private rig: Rig;

  constructor(rig: Rig) {
    this.rig = rig;
    const rodGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    const rodMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#54d8e8"),
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
    });
    const jointGeo = new THREE.SphereGeometry(1, 10, 8);
    const jointMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#bff4ff"),
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });

    for (const spec of rig.specs) {
      if (spec.name === "root") continue;
      const rod = new THREE.Mesh(rodGeo, rodMat);
      rod.frustumCulled = false;
      rod.renderOrder = 21;
      this.group.add(rod);
      this.rods.push(rod);
      this.specNames.push({ name: spec.name, parent: spec.parent });

      const joint = new THREE.Mesh(jointGeo, jointMat);
      joint.frustumCulled = false;
      joint.renderOrder = 22;
      this.group.add(joint);
      this.joints.push(joint);
    }
    this.group.visible = false;
  }

  setVisible(visible: boolean) {
    this.group.visible = visible;
  }

  update() {
    if (!this.group.visible) return;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const mat = new THREE.Matrix4();

    for (let i = 0; i < this.rods.length; i++) {
      const { name, parent } = this.specNames[i];
      const rod = this.rods[i];
      // the root sits at the origin, so its "bone" would be a rod to nowhere
      const hasParentBone = parent !== null && parent !== "root";
      rod.visible = hasParentBone;
      a.copy(this.rig.world.get(name)!.p);
      b.copy(this.rig.world.get(hasParentBone ? parent! : name)!.p);
      dir.copy(a).sub(b);
      const len = dir.length() || 1e-4;
      dir.normalize();
      q.setFromUnitVectors(UP, dir);
      const radius = 0.011 + Math.min(0.01, len * 0.02);
      scale.set(radius, len, radius);
      mat.compose(a.clone().add(b).multiplyScalar(0.5), q, scale);
      rod.matrixAutoUpdate = false;
      rod.matrix.copy(mat);

      const joint = this.joints[i];
      const jr = 0.016 + (name === "head" ? 0.02 : 0);
      joint.matrixAutoUpdate = false;
      joint.matrix.compose(a, new THREE.Quaternion(), new THREE.Vector3(jr, jr, jr));
    }
  }
}
