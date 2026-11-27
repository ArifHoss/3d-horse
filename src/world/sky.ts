/**
 * Sky: a gradient dome with a soft sun, plus the palette that the rest of the
 * scene (fog, light, grass) is derived from.
 */

import * as THREE from "three";

export interface SkyPalette {
  zenith: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  sun: THREE.Color;
  fog: THREE.Color;
  sunDir: THREE.Vector3;
}

export const DAY: SkyPalette = {
  zenith: new THREE.Color("#5d93cf").convertSRGBToLinear(),
  horizon: new THREE.Color("#d7e6ec").convertSRGBToLinear(),
  ground: new THREE.Color("#8fa06a").convertSRGBToLinear(),
  sun: new THREE.Color("#fff6e2").convertSRGBToLinear(),
  fog: new THREE.Color("#cfdfe8").convertSRGBToLinear(),
  sunDir: new THREE.Vector3(0.42, 0.62, 0.66).normalize(),
};

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w; // draw at the far plane
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uExposure;

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
    col = mix(uGround, col, smoothstep(-0.12, 0.06, h));

    // sun glow, then the disc
    float cosA = dot(d, normalize(uSunDir));
    float glow = pow(max(cosA, 0.0), 220.0) * 1.6 + pow(max(cosA, 0.0), 18.0) * 0.22;
    col += uSunColor * glow;
    float disc = smoothstep(0.99965, 0.99985, cosA);
    col += uSunColor * disc * 14.0;

    // a little haze near the horizon
    col = mix(col, uHorizon * 1.02, pow(1.0 - clamp(abs(h), 0.0, 1.0), 6.0) * 0.65);

    gl_FragColor = vec4(col * uExposure, 1.0);
  }
`;

export function createSky(palette: SkyPalette = DAY): THREE.Mesh {
  const geo = new THREE.SphereGeometry(1, 32, 20);
  const mat = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: palette.zenith },
      uHorizon: { value: palette.horizon },
      uGround: { value: palette.ground },
      uSunColor: { value: palette.sun },
      uSunDir: { value: palette.sunDir },
      uExposure: { value: 1.0 },
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.scale.setScalar(400);
  return mesh;
}
