/**
 * Horse — a 100% procedural horse.
 *
 * No models, no textures, no animation clips: the body is meshed from a
 * signed distance field on load, rigged from a joint table, and animated by
 * procedural gaits with two-bone IK legs on a treadmill field.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import "./style.css";
import { Horse } from "./horse/horse";
import { GAITS, type GaitName } from "./horse/gaits";
import { COATS } from "./horse/coat";
import { createHud, createLoading } from "./ui/hud";
import { createSky, DAY } from "./world/sky";
import { createGrass, createGround } from "./world/grass";
import { StableAudio } from "./audio/sound";
import { SkeletonView } from "./fx/skeleton";
import { Dust } from "./fx/dust";

const app = document.getElementById("app")!;

/* ------------------------------------------------------------------ *
 * Renderer, scene, camera
 * ------------------------------------------------------------------ */

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const fog = new THREE.FogExp2(DAY.fog.getHex(), 0.043);
scene.fog = fog;

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.05, 800);
camera.position.set(3.2, 1.8, 5.0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-0.05, 1.06, 0);
// portrait screens need a wider frame
if (innerWidth / innerHeight < 1) {
  camera.position.multiplyScalar(1.12);
  camera.fov = 42;
  camera.updateProjectionMatrix();
}
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.minDistance = 1.3;
controls.maxDistance = 13;
controls.maxPolarAngle = Math.PI * 0.492;
controls.minPolarAngle = 0.12;
controls.rotateSpeed = 0.75;
controls.zoomSpeed = 0.75;
controls.autoRotateSpeed = 2.4;
controls.update();

/* ------------------------------------------------------------------ *
 * Sky, light, ground
 * ------------------------------------------------------------------ */

const sky = createSky(DAY);
scene.add(sky);

const sun = new THREE.DirectionalLight(DAY.sun.getHex(), 3.35);
sun.position.copy(DAY.sunDir).multiplyScalar(9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -3.2;
sc.right = 3.2;
sc.top = 3.4;
sc.bottom = -2.2;
sc.near = 1;
sc.far = 22;
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.025;
sun.shadow.radius = 2.2;
scene.add(sun);
scene.add(sun.target);
sun.target.position.set(0, 0.9, 0);

const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x3d5227, 0.85);
scene.add(hemi);
// a subtle fill from the opposite side keeps the shadow side readable
const fill = new THREE.DirectionalLight(0xdfe9ff, 0.35);
fill.position.set(-6, 4, -5);
scene.add(fill);

const ground = createGround();
scene.add(ground);

// `?lite=1` keeps screenshots and low-end machines cheap
const lite = new URLSearchParams(location.search).get("lite") === "1";
const grass = createGrass({ count: lite ? 26000 : 235000, radius: 22, tile: 44 });
scene.add(grass.mesh);

/* ------------------------------------------------------------------ *
 * The horse
 * ------------------------------------------------------------------ */

const params = new URLSearchParams(location.search);
const loading = createLoading();
loading.meta("meshing from a signed distance field");

let horse: Horse;
let skeleton: SkeletonView;
let dust: Dust;

/* ------------------------------------------------------------------ *
 * Materials for x-ray mode
 * ------------------------------------------------------------------ */

const ghostMaterial = new THREE.MeshPhysicalMaterial({
  color: new THREE.Color("#1a3a3a"),
  roughness: 0.35,
  metalness: 0,
  transparent: true,
  opacity: 0.16,
  depthWrite: false,
  side: THREE.DoubleSide,
  emissive: new THREE.Color("#0d2b2b"),
  emissiveIntensity: 0.6,
});
let bodyMaterial: THREE.MeshPhysicalMaterial;

/* ------------------------------------------------------------------ *
 * UI
 * ------------------------------------------------------------------ */

const audio = new StableAudio();
let xrayOn = false;
let spinOn = false;
let coatIndex = 0;

const hud = createHud({
  onGait: (g) => setGait(g),
  onRear: () => horse?.triggerRear(),
  onXray: () => setXray(!xrayOn),
  onSound: () => void toggleSound(),
  onSpin: () => setSpin(!spinOn),
  onCoat: (i) => setCoat(i),
  onHide: () => {},
});

function setGait(g: GaitName) {
  if (g === "rear") {
    horse?.triggerRear();
    return;
  }
  if (horse) horse.setGait(g);
  hud.setGait(g);
}

function setXray(on: boolean) {
  xrayOn = on;
  hud.setXray(on);
  if (!horse) return;
  horse.body.material = on ? ghostMaterial : bodyMaterial;
  horse.mane.visible = !on;
  horse.tail.visible = !on;
  for (const eye of horse.eyes) eye.visible = !on;
  skeleton.setVisible(on);
}

async function toggleSound() {
  const on = await audio.toggle();
  hud.setSound(on);
}

function setSpin(on: boolean) {
  spinOn = on;
  controls.autoRotate = on;
  hud.setSpin(on);
}

function setCoat(i: number) {
  coatIndex = i;
  horse?.setCoat(i);
  hud.setCoat(i);
}

addEventListener("keydown", (e) => {
  const map: Record<string, GaitName> = {
    "1": "stand", "2": "walk", "3": "trot", "4": "canter", "5": "gallop",
  };
  if (map[e.key]) setGait(map[e.key]);
  if (e.code === "Space") {
    e.preventDefault();
    horse?.triggerRear();
  }
  if (e.key === "x" || e.key === "X") setXray(!xrayOn);
  if (e.key === "c" || e.key === "C") setCoat((coatIndex + 1) % COATS.length);
  if (e.key === "h" || e.key === "H") hud.element.classList.toggle("hidden");
  if (e.key === "s" || e.key === "S") void toggleSound();
  if (e.key === "r" || e.key === "R") setSpin(!spinOn);
});

// double click the horse rears up
renderer.domElement.addEventListener("dblclick", () => horse?.triggerRear());

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function boot() {
  horse = new Horse((f, label) => loading.set(f, label));
  horse.setLookWeight(0.5);
  scene.add(horse.group);
  bodyMaterial = horse.body.material as THREE.MeshPhysicalMaterial;
  skeleton = new SkeletonView(horse.rig);
  scene.add(skeleton.group);
  dust = new Dust();
  scene.add(dust.points);
  loading.meta(
    `${horse.stats.vertices.toLocaleString()} verts · ` +
      `${horse.stats.triangles.toLocaleString()} tris · ` +
      `${(horse.stats.buildMs / 1000).toFixed(1)} s`,
  );

  // apply anything the URL asked for
  const gaitParam = params.get("gait") as GaitName | null;
  if (gaitParam) setGait(gaitParam);
  if (params.get("xray") === "1") setXray(true);
  if (params.get("coat")) setCoat(Number(params.get("coat")));
  if (params.get("nohud") === "1") hud.element.classList.add("hidden");
if (params.get("rear") === "1") {
  // hold the rear for a screenshot
  horse.triggerRear();
  for (let i = 0; i < 42; i++) horse.update(1 / 60);
}
  if (params.get("spin") === "1") setSpin(true);
  hud.setGait(horse.gaitName);

  loading.done();
  renderer.setAnimationLoop(frame);
}

/* ------------------------------------------------------------------ *
 * Optional URL overrides (handy for screenshots)
 * ------------------------------------------------------------------ */

const camParam = params.get("cam");
if (camParam) {
  const [x, y, z] = camParam.split(",").map(Number);
  camera.position.set(x, y, z);
  controls.update();
}
const gaze = params.get("look");
if (gaze) controls.target.set(...(gaze.split(",").map(Number) as [number, number, number]));

/* ------------------------------------------------------------------ *
 * Loop
 * ------------------------------------------------------------------ */

const hoofWorld = new THREE.Vector3();
const clock = new THREE.Clock();
let speedShown = -1;

const paused = params.get("pause") === "1";

function frame() {
  const dt = paused ? 0 : Math.min(clock.getDelta(), 0.05);
  if (!horse) return;

  horse.update(dt);
  horse.setLookTarget(camera.position);

  // the field runs under the horse at the gait's ground speed
  grass.update(dt, horse.speed);
  audio.setWind(0.35 + Math.min(1, horse.speed / 8) * 0.65);

  for (const ev of horse.drainEvents()) {
    audio.hoof(ev.strength, ev.leg);
    if (ev.strength > 0.3) {
      hoofWorld.set(ev.x, 0.02, ev.z).applyMatrix4(horse.group.matrixWorld);
      dust.spawn(hoofWorld, ev.strength, horse.speed);
    }
  }
  dust.update(dt, horse.speed);

  const kmh = horse.speed * 3.6;
  if (Math.abs(kmh - speedShown) > 0.4) {
    hud.setSpeed(kmh);
    speedShown = kmh;
  }

  skeleton.update();
  controls.update();
  sky.position.copy(camera.position);

  // keep the shadow frustum centred on the horse
  sun.position.copy(DAY.sunDir).multiplyScalar(9).add(new THREE.Vector3(0, 0, 0));
  renderer.render(scene, camera);
}

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// paint the loading screen first: meshing blocks the main thread
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    boot();
    console.log(
      "%cHorse%c " +
        `${horse.stats.vertices} vertices · ${horse.stats.triangles} triangles · ` +
        `built in ${horse.stats.buildMs.toFixed(0)} ms`,
      "font-weight:bold;color:#b8d98a",
      "color:#9fb08a",
    );
    console.log("gaits:", Object.keys(GAITS).join(", "));
  });
});
