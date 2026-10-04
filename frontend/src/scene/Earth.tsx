"use client";
import { useMemo } from "react";
import * as THREE from "three";
import { EARTH_R } from "@/sim/frames";
import { cityLightsTexture } from "./cityLights";
import { landTexture } from "./landTexture";

// Stylized Earth lit by the simulated Sun vector (world space). Colours are authored in sRGB and
// converted to linear before three's output colour-space step, so they render identically with or
// without the post-processing composer. Decorative layers (city lights, clouds) are illustrative.
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
uniform sampler2D uLights;
uniform vec3 uSun;
uniform float uGrid;
uniform float uShadowMode;
uniform float uLightsOn;
uniform float uDetail;
varying vec3 vNormalW;
varying vec2 vUv;
varying vec3 vPosW;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }

void main() {
  vec4 m = texture2D(uLand, vUv);
  float land = m.r;
  float coast = m.g;
  float shelf = m.b;            // blurred land mask: ~1 near land, 0 in deep ocean
  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uSun);
  vec3 V = normalize(cameraPosition - vPosW);
  float ndl = dot(N, L);
  float day = smoothstep(-0.10, 0.08, ndl);
  float lat = (vUv.y - 0.5) * 180.0;

  // Ocean: deep -> continental shelf
  vec3 deep = vec3(0.018, 0.06, 0.13);
  vec3 shallow = vec3(0.05, 0.17, 0.26);
  vec3 ocean = mix(deep, shallow, smoothstep(0.05, 0.75, shelf) * (1.0 - land));
  // Land: subtle large-scale variation, polar ice
  float var = uDetail > 0.5 ? vnoise(vUv * vec2(90.0, 45.0)) * 0.5 + vnoise(vUv * vec2(260.0, 130.0)) * 0.5 : 0.5;
  vec3 landCol = mix(vec3(0.19, 0.23, 0.20), vec3(0.27, 0.28, 0.24), var);
  float ice = smoothstep(60.0, 70.0, abs(lat)) + step(lat, -62.0);
  landCol = mix(landCol, vec3(0.70, 0.76, 0.83), clamp(ice, 0.0, 1.0));
  vec3 base = mix(ocean, landCol, land);

  // Day lighting with soft wrap; night base
  vec3 dayCol = base * (0.45 + 0.75 * max(ndl, 0.0));
  vec3 nightOcean = vec3(0.016, 0.028, 0.05);
  vec3 nightLand = vec3(0.05, 0.058, 0.068);
  vec3 nightCol = mix(nightOcean, nightLand, land);
  vec3 col = mix(nightCol, dayCol, day);

  // Coastline
  col += coast * mix(vec3(0.06, 0.08, 0.10), vec3(0.12, 0.15, 0.17), day);
  // Ocean glint
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 48.0) * (1.0 - land) * day;
  col += vec3(0.35, 0.40, 0.45) * spec * 0.45;
  // Twilight scattering band along the terminator
  col += vec3(0.85, 0.45, 0.2) * exp(-pow(ndl / 0.045, 2.0)) * 0.09;
  // City lights (illustrative) on the night side only
  float lights = texture2D(uLights, vUv).r * land * (1.0 - smoothstep(-0.14, 0.02, ndl)) * uLightsOn;
  col += vec3(1.0, 0.76, 0.46) * lights * 0.6;
  // Graticule every 15 degrees
  if (uGrid > 0.5) {
    vec2 g = vec2(vUv.x * 24.0, vUv.y * 12.0);
    vec2 d = abs(fract(g - 0.5) - 0.5) / fwidth(g);
    float line = 1.0 - min(min(d.x, d.y), 1.0);
    col += line * mix(vec3(0.025, 0.04, 0.055), vec3(0.06, 0.08, 0.10), day);
  }
  // Atmospheric haze toward the limb (day side)
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col = mix(col, vec3(0.32, 0.55, 0.95), rim * 0.55 * smoothstep(-0.2, 0.3, ndl));
  // Emphasise night side in power/system modes
  col *= mix(1.0, mix(0.6, 1.0, day), uShadowMode);
  gl_FragColor = vec4(pow(col, vec3(2.2)), 1.0);
  #include <colorspace_fragment>
}`;

const cloudFrag = /* glsl */ `
uniform vec3 uSun;
uniform float uDrift;
uniform float uOpacity;
varying vec3 vNormalW;
varying vec3 vLocal;
float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
float noise(vec3 p){ vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int k = 0; k < 5; k++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec3 p = normalize(vLocal);
  float lat = abs(p.y);
  // banded cloudiness: more in mid-latitude storm tracks and the tropics, less in subtropics
  float bands = 0.55 + 0.25 * cos(lat * 9.0);
  vec3 q = p * 5.0 + vec3(uDrift, 0.0, uDrift * 0.6);
  float c = fbm(q + fbm(q * 1.7) * 0.6);
  float a = smoothstep(0.56, 0.8, c * bands + 0.08) * uOpacity;
  float ndl = dot(normalize(vNormalW), normalize(uSun));
  float day = smoothstep(-0.12, 0.15, ndl);
  vec3 col = mix(vec3(0.05, 0.06, 0.08), vec3(0.92, 0.94, 0.97) * (0.55 + 0.45 * max(ndl, 0.0)), day);
  col += vec3(0.8, 0.45, 0.2) * exp(-pow(ndl / 0.05, 2.0)) * 0.1;
  gl_FragColor = vec4(pow(col, vec3(2.2)), a * mix(0.25, 1.0, day));
  #include <colorspace_fragment>
}`;

const cloudVert = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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
  vec3 V = normalize(cameraPosition - vPosW);
  vec3 N = normalize(vNormalW);
  float rim = pow(1.0 - abs(dot(V, N)), 2.2);
  float ndl = dot(N, normalize(uSun));
  float lit = smoothstep(-0.32, 0.25, ndl);
  vec3 blue = vec3(0.30, 0.56, 1.0);
  vec3 amber = vec3(1.0, 0.55, 0.25);
  vec3 col = mix(amber, blue, smoothstep(-0.05, 0.35, ndl));
  float a = rim * lit * 0.85;
  gl_FragColor = vec4(pow(col, vec3(2.2)) * a, a);
  #include <colorspace_fragment>
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
      uniforms: { uLand: { value: landTexture() }, uLights: { value: cityLightsTexture() }, uLightsOn: { value: 1 }, uDetail: { value: 1 }, ...shared },
    });
    const clouds = new THREE.ShaderMaterial({
      vertexShader: cloudVert,
      fragmentShader: cloudFrag,
      uniforms: { uSun: shared.uSun, uDrift: { value: 0 }, uOpacity: { value: 0.6 } },
      transparent: true,
      depthWrite: false,
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
    return { earth, clouds, atmo, uniforms: shared };
  }, []);
}

export function EarthMesh({ material, low }: { material: THREE.ShaderMaterial; low?: boolean }) {
  return (
    <mesh material={material} name="earth">
      <sphereGeometry args={low ? [EARTH_R, 96, 64] : [EARTH_R, 192, 112]} />
    </mesh>
  );
}

/** Illustrative procedural cloud layer (not weather data). Child of the Earth-fixed group. */
export function Clouds({ material }: { material: THREE.ShaderMaterial }) {
  return (
    <mesh material={material} scale={1.008} renderOrder={2}>
      <sphereGeometry args={[EARTH_R, 128, 72]} />
    </mesh>
  );
}

export function Atmosphere({ material }: { material: THREE.ShaderMaterial }) {
  // limb glow shell, exaggerated slightly for legibility
  return (
    <mesh material={material} scale={1.045} renderOrder={3}>
      <sphereGeometry args={[EARTH_R, 96, 64]} />
    </mesh>
  );
}
