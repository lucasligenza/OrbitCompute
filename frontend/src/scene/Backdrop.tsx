"use client";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { PreparedResult } from "@/sim/result";
import { timeStore } from "@/state/time";
import { glowTexture, sunDirAt } from "./shared";

const v = new THREE.Vector3();

/** Seeded starfield with per-star magnitude and colour temperature, plus a faint galactic band. */
export function Stars() {
  const { geom, mat } = useMemo(() => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const n = 4200;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    // galactic plane normal (illustrative orientation)
    const gn = new THREE.Vector3(0.35, 0.86, -0.37).normalize();
    const p = new THREE.Vector3();
    const warm = new THREE.Color("#ffd2a1"), cool = new THREE.Color("#a9c4ff"), white = new THREE.Color("#ffffff");
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      let u = rnd() * 2 - 1;
      let th = rnd() * Math.PI * 2;
      // ~45% of stars concentrated near the band
      if (i % 9 < 4) {
        p.set(Math.cos(th), (rnd() - 0.5) * 0.22, Math.sin(th)).normalize();
        // rotate band so its normal is gn
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), gn);
        p.applyQuaternion(q);
        u = p.y; th = Math.atan2(p.z, p.x);
      }
      const s = Math.sqrt(1 - u * u);
      const r = 1500;
      pos.set([r * s * Math.cos(th), r * u, r * s * Math.sin(th)], i * 3);
      const mag = Math.pow(rnd(), 3.2); // mostly faint, few bright
      size[i] = 0.7 + mag * 2.6;
      const tcol = rnd();
      c.copy(white).lerp(tcol < 0.5 ? cool : warm, Math.abs(tcol - 0.5) * 1.2);
      const b = 0.25 + mag * 0.85;
      col.set([c.r * b, c.g * b, c.b * b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uPx: { value: Math.min(window.devicePixelRatio || 1, 2) } },
      vertexShader: /* glsl */ `
        attribute float aSize; varying vec3 vCol; uniform float uPx;
        void main() { vCol = color; gl_PointSize = aSize * uPx; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying vec3 vCol;
        void main() { vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(d)); gl_FragColor = vec4(pow(vCol, vec3(2.2)) * a, a);
          #include <colorspace_fragment>
        }`,
      vertexColors: true,
    });
    return { geom: g, mat: m };
  }, []);
  return <points geometry={geom} material={mat} frustumCulled={false} renderOrder={-10} />;
}

/** Galactic glow band: a huge inverted sphere with a soft band in a shader. Purely decorative. */
export function MilkyWay() {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    transparent: true,
    uniforms: { uN: { value: new THREE.Vector3(0.35, 0.86, -0.37).normalize() } },
    vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uN; varying vec3 vDir;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      float noise(vec3 p){ vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f);
        float n=mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                    mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); return n; }
      void main(){
        float lat = dot(normalize(vDir), uN);
        float band = exp(-pow(lat / 0.16, 2.0));
        float n = noise(vDir * 6.0) * 0.6 + noise(vDir * 15.0) * 0.4;
        float a = band * (0.25 + 0.75 * n) * 0.11;
        gl_FragColor = vec4(pow(vec3(0.62, 0.66, 0.78), vec3(2.2)) * a, a);
        #include <colorspace_fragment>
      }`,
  }), []);
  return (
    <mesh material={mat} renderOrder={-11}>
      <sphereGeometry args={[1600, 48, 24]} />
    </mesh>
  );
}

/** Sun: directional light, bright core and a glare sprite. The core is toneMapped=false so bloom catches it. */
export function Sun({ res }: { res: PreparedResult }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const group = useRef<THREE.Group>(null);
  const glare = useMemo(() => glowTexture([[0, "rgba(255,244,214,1)"], [0.08, "rgba(255,226,160,0.85)"], [0.3, "rgba(255,190,110,0.18)"], [1, "rgba(255,170,90,0)"]], 256), []);
  useFrame(() => {
    sunDirAt(res, timeStore.getState().t, v);
    light.current?.position.copy(v).multiplyScalar(50);
    group.current?.position.copy(v).multiplyScalar(700);
  });
  return (
    <>
      <directionalLight ref={light} intensity={2.4} color="#fff3e0" />
      <ambientLight intensity={0.12} />
      <hemisphereLight args={["#2a3b5c", "#05070a", 0.15]} />
      <group ref={group}>
        <mesh>
          <sphereGeometry args={[5, 24, 16]} />
          <meshBasicMaterial color={new THREE.Color(4, 3.6, 2.8)} toneMapped={false} />
        </mesh>
        <sprite scale={[120, 120, 1]}>
          <spriteMaterial map={glare} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </sprite>
      </group>
    </>
  );
}
