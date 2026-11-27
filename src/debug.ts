import * as THREE from "three";
import { buildSdf, SDF_BOUNDS } from "./horse/anatomy";
import { surfaceNets } from "./core/isosurface";

const app = document.getElementById("app")!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setScissorTest(true);
renderer.shadowMap.enabled = true;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a3a24);

scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x4a5a30, 1.5));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
sun.position.set(4, 7, 5);
sun.castShadow = false;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -3;
sun.shadow.camera.right = 3;
sun.shadow.camera.top = 3;
sun.shadow.camera.bottom = -3;
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(20, 64),
  new THREE.MeshStandardMaterial({ color: 0x5a7d43, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const sdf = buildSdf();
const mesh = surfaceNets(sdf, SDF_BOUNDS.min, SDF_BOUNDS.max, {
  h: Number(new URLSearchParams(location.search).get("h") ?? 0.022),
  projectIterations: Number(new URLSearchParams(location.search).get("proj") ?? 2),
  smoothIterations: Number(new URLSearchParams(location.search).get("smooth") ?? 3),
});
console.log(`meshed — ${mesh.vertexCount} verts, ${mesh.triangleCount} tris`);


const geo = new THREE.BufferGeometry();
geo.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
geo.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
const colors = new Float32Array(mesh.vertexCount * 3);
for (let i = 0; i < mesh.vertexCount; i++) {
  const ao = mesh.ao[i];
  colors[i * 3] = (0.5 * ao + 0.14) * 1.15;
  colors[i * 3 + 1] = (0.31 * ao + 0.08) * 1.15;
  colors[i * 3 + 2] = (0.19 * ao + 0.05) * 1.15;
}
geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
geo.computeBoundingSphere();

const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0, side: THREE.DoubleSide });
const horse = new THREE.Mesh(geo, mat);
horse.castShadow = false;
horse.receiveShadow = true;
scene.add(horse);

const views: Array<[string, [number, number, number]]> = [
  ["side", [0.2, 1.15, 4.4]],
  ["front", [4.2, 1.35, 0.9]],
  ["rear", [-3.9, 1.4, 1.1]],
  ["top", [0.2, 5.0, 0.35]],
];

const target = new THREE.Vector3(0.15, 1.05, 0);
const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

function draw() {
  const w = innerWidth / 2;
  const h = innerHeight / 2;
  for (let i = 0; i < 4; i++) {
    const x = (i % 2) * w;
    const y = (1 - Math.floor(i / 2)) * h;
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    cam.aspect = w / h;
    cam.position.set(...views[i][1]);
    cam.lookAt(target);
    cam.updateProjectionMatrix();
    renderer.render(scene, cam);
  }
}

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  draw();
});
draw();
requestAnimationFrame(() => {
  document.body.dataset.ready = "1";
});
