import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Horse } from "./horse/horse";
import type { GaitName } from "./horse/gaits";

const app = document.getElementById("app")!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x27351f);
scene.fog = new THREE.Fog(0x27351f, 12, 40);

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 200);
const params = new URLSearchParams(location.search);
const camParam = params.get("cam");
const lookParam = params.get("look");
const target = lookParam
  ? new THREE.Vector3(...lookParam.split(",").map(Number))
  : new THREE.Vector3(0.15, 1.0, 0);
if (camParam) {
  const [x, y, z] = camParam.split(",").map(Number);
  camera.position.set(x, y, z);
} else {
  camera.position.set(0.6, 1.45, 4.6);
}
camera.lookAt(target);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(target);
controls.enableDamping = true;
controls.minDistance = 1.2;
controls.maxDistance = 14;
controls.maxPolarAngle = Math.PI * 0.495;
controls.update();

scene.add(new THREE.HemisphereLight(0xd8e9ff, 0x556b3a, 1.1));
const sun = new THREE.DirectionalLight(0xfff0d8, 3.0);
sun.position.set(5, 8, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -3.5;
sun.shadow.camera.right = 3.5;
sun.shadow.camera.top = 3.5;
sun.shadow.camera.bottom = -3.5;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 25;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.02;
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(30, 64),
  new THREE.MeshStandardMaterial({ color: 0x54703c, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const horse = new Horse();
scene.add(horse.group);
console.log("horse built", horse.stats);

const startGait = (params.get("gait") as GaitName) ?? "stand";
const freeze = params.get("freeze") === "1";
const startPhase = Number(params.get("phase") ?? 0);
horse.setGait(startGait);
if (params.get("rear") === "1") horse.triggerRear();

// settle the gait blend, then pin the phase and freeze for stills
if (freeze) {
  for (let i = 0; i < 60; i++) horse.update(1 / 60);
  horse.phase = startPhase;
  horse.update(0.0001);
  if (params.get("rear") === "1") {
    for (let i = 0; i < 26; i++) horse.update(1 / 60);
  }
}

addEventListener("keydown", (e) => {
  const map: Record<string, GaitName> = {
    "1": "stand", "2": "walk", "3": "trot", "4": "canter", "5": "gallop",
  };
  if (map[e.key]) horse.setGait(map[e.key]);
  if (e.code === "Space") {
    e.preventDefault();
    horse.triggerRear();
  }
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// debug skeleton overlay
const skelGeo = new THREE.BufferGeometry();
skelGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(300 * 2 * 3), 3));
const skelMat = new THREE.LineBasicMaterial({ color: 0x00ffcc, depthTest: false });
const skel = new THREE.LineSegments(skelGeo, skelMat);
skel.frustumCulled = false;
scene.add(skel);
const showSkeleton = params.get("skel") === "1";
skel.visible = showSkeleton;

if (params.get("dump") === "1") {
  for (const c of horse.chains) {
    const g = (n: string) => horse.rig.world.get(n)!;
    const f = (v: any) => `(${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)})`;
    console.log(
      `${c.front ? "F" : "H"}${c.side} root=${f(g(c.root).p)} mid=${f(g(c.mid).p)} fet=${f(g(c.pastern).p)} hoof=${f(g(c.hoof).p)}`,
    );
  }
  console.log("chain lengths", horse.chains.map((c) => `${c.l1.toFixed(3)}/${c.l2.toFixed(3)}`).join(" "));
}

function updateSkeleton() {
  if (!showSkeleton) return;
  const pos = skelGeo.getAttribute("position") as THREE.BufferAttribute;
  let n = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (const bone of horse.rig.bones) {
    bone.getWorldPosition(a);
    for (const child of bone.children) {
      if ((child as any).isBone) {
        child.getWorldPosition(b);
        pos.setXYZ(n++, a.x, a.y, a.z);
        pos.setXYZ(n++, b.x, b.y, b.z);
      }
    }
  }
  pos.needsUpdate = true;
  skelGeo.setDrawRange(0, n);
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = freeze ? 0 : Math.min(clock.getDelta(), 0.05);
  if (freeze) clock.getDelta();
  horse.update(dt);
  horse.setLookTarget(camera.position);
  (horse as any).lookWeight = 0;
  updateSkeleton();
  controls.update();
  renderer.render(scene, camera);
});
