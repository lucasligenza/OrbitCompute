"use client";
import { useMemo } from "react";
import * as THREE from "three";
import { EARTH_R } from "@/sim/frames";
import { landTexture } from "./landTexture";

// Day/night shading from the simulated Sun vector (world space). Terminator softened over ~±5°
// (illustrative twilight band). Optional 15° graticule drawn from UVs.
const vert = /* glsl */ `
varying vec3 vNormalW;
varying vec2 vUv;
varying vec3 vPosW;
void main() {
  vUv = uv;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 pw = modelMatrix * vec4(position, 1.0);
  vPosW = pw.xyz;
  gl_Position = projectionMatrix * viewMatrix * pw;
}`;

const frag = /* glsl */ `
uniform sampler2D uLand;
uniform vec3 uSun;
uniform float uGrid;
uniform float uShadowMode;
varying vec3 vNormalW;
varying vec2 vUv;
varying vec3 vPosW;
void main() {
  vec4 m = texture2D(uLand, vUv);
  float land = m.r;
  float coast = m.g;
  float ndl = dot(normalize(vNormalW), normalize(uSun));
  float day = smoothstep(-0.09, 0.06, ndl);

  vec3 oceanDay = vec3(0.055, 0.135, 0.235);
  vec3 landDay  = vec3(0.235, 0.27, 0.255);
  vec3 oceanNight = vec3(0.018, 0.032, 0.058);
  vec3 landNight  = vec3(0.06, 0.07, 0.08);

  vec3 dayCol = mix(oceanDay, landDay, land) * (0.55 + 0.55 * max(ndl, 0.0));
  vec3 nightCol = mix(oceanNight, landNight, land);
  vec3 col = mix(nightCol, dayCol, day);
  // coastline, slightly brighter on the day side
  col += coast * mix(vec3(0.07, 0.09, 0.11), vec3(0.14, 0.17, 0.19), day);
  // ocean glint
  vec3 viewDir = normalize(cameraPosition - vPosW);
  vec3 h = normalize(normalize(uSun) + viewDir);
  float spec = pow(max(dot(normalize(vNormalW), h), 0.0), 60.0) * (1.0 - land) * day;
  col += vec3(0.25, 0.32, 0.4) * spec * 0.35;
  // terminator line (thin, warm)
  col += vec3(0.6, 0.4, 0.15) * exp(-pow(ndl / 0.012, 2.0)) * 0.12;
  // graticule every 15 degrees
  if (uGrid > 0.5) {
    vec2 g = vec2(vUv.x * 24.0, vUv.y * 12.0);
    vec2 d = abs(fract(g - 0.5) - 0.5) / fwidth(g);
    float line = 1.0 - min(min(d.x, d.y), 1.0);
    col += line * mix(vec3(0.03, 0.045, 0.06), vec3(0.07, 0.09, 0.11), day);
  }
  // darken the night side further in power mode to emphasise the shadow
  col *= mix(1.0, mix(0.55, 1.0, day), uShadowMode);
  gl_FragColor = vec4(col, 1.0); // colours authored in display space (no linear->sRGB step)
}`;

const atmoVert = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 pw = modelMatrix * vec4(position, 1.0);
  vPosW = pw.xyz;
  gl_Position = projectionMatrix * viewMatrix * pw;
}`;
const atmoFrag = /* glsl */ `
uniform vec3 uSun;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vec3 v = normalize(cameraPosition - vPosW);
  float rim = pow(1.0 - abs(dot(v, normalize(vNormalW))), 3.0);
  float lit = smoothstep(-0.3, 0.4, dot(normalize(vNormalW), normalize(uSun)));
  vec3 col = vec3(0.3, 0.55, 1.0);
  gl_FragColor = vec4(col, rim * (0.12 + 0.5 * lit));
}`;

export interface EarthUniforms {
  uSun: { value: THREE.Vector3 };
  uGrid: { value: number };
  uShadowMode: { value: number };
}

export function useEarthMaterials() {
  return useMemo(() => {
    const shared: EarthUniforms = {
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uGrid: { value: 1 },
      uShadowMode: { value: 0 },
    };
    const earth = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uLand: { value: landTexture() }, ...shared },
    });
    const atmo = new THREE.ShaderMaterial({
      vertexShader: atmoVert,
      fragmentShader: atmoFrag,
      uniforms: { uSun: shared.uSun },
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { earth, atmo, uniforms: shared };
  }, []);
}

export function EarthMesh({ material }: { material: THREE.ShaderMaterial }) {
  return (
    <mesh material={material} name="earth">
      <sphereGeometry args={[EARTH_R, 160, 96]} />
    </mesh>
  );
}

export function Atmosphere({ material }: { material: THREE.ShaderMaterial }) {
  // thin limb glow ~ 100 km shell, exaggerated slightly for legibility
  return (
    <mesh material={material} scale={1.025}>
      <sphereGeometry args={[EARTH_R, 96, 64]} />
    </mesh>
  );
}
