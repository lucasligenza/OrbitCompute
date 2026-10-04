"use client";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { PreparedResult } from "@/sim/result";
import { EARTH_R, EARTH_RADIUS_KM } from "@/sim/frames";
import { timeStore } from "@/state/time";
import { sunDirAt } from "./shared";

const R_SUN_KM = 696000;
const LEN = EARTH_R * 7;
const v = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

/**
 * Display aid for Earth's shadow: true conical umbra (converging) and penumbra (diverging)
 * geometry from the Sun distance. At this scale both are nearly cylindrical, which is correct.
 * Eclipse *state* comes from the engine's conical model, not from this mesh.
 */
export function EclipseVolume({ res }: { res: PreparedResult }) {
  const group = useRef<THREE.Group>(null);
  const dSun = res.raw.sun.dist_km[0];
  const geoms = useMemo(() => {
    const lu = (EARTH_RADIUS_KM * dSun) / (R_SUN_KM - EARTH_RADIUS_KM); // umbra apex distance, km
    const lp = (EARTH_RADIUS_KM * dSun) / (R_SUN_KM + EARTH_RADIUS_KM); // penumbra vertex behind Sun side
    const far = (LEN * 1000) as number; // km at far end
    const rUmbraFar = (EARTH_RADIUS_KM * (1 - far / lu)) / 1000;
    const rPenFar = (EARTH_RADIUS_KM * (1 + far / lp)) / 1000;
    const umbra = new THREE.CylinderGeometry(rUmbraFar, EARTH_R * 1.0, LEN, 96, 24, true);
    const pen = new THREE.CylinderGeometry(rPenFar * 1.0, EARTH_R * 1.0, LEN, 96, 24, true);
    umbra.translate(0, LEN / 2, 0);
    pen.translate(0, LEN / 2, 0);
    return { umbra, pen };
  }, [dSun]);
  const mat = useMemo(() => {
    const make = (color: string, strength: number) => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength }, uLen: { value: LEN } },
      vertexShader: /* glsl */ `varying float vY; varying vec3 vN; varying vec3 vPosW;
        void main(){ vY = position.y; vN = normalize(mat3(modelMatrix) * normal); vec4 pw = modelMatrix * vec4(position,1.0); vPosW = pw.xyz;
          gl_Position = projectionMatrix * viewMatrix * pw; }`,
      fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uStrength; uniform float uLen; varying float vY; varying vec3 vN; varying vec3 vPosW;
        void main(){
          float along = clamp(vY / uLen, 0.0, 1.0);
          float fade = (1.0 - along) * (1.0 - along);
          float edge = 1.0 - abs(dot(normalize(cameraPosition - vPosW), normalize(vN)));
          float a = uStrength * fade * (0.35 + 0.65 * edge);
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }`,
    });
    return { umbra: make("#141a3a", 0.5), pen: make("#3a3f7a", 0.12) };
  }, []);
  useFrame(() => {
    sunDirAt(res, timeStore.getState().t, v);
    group.current?.quaternion.setFromUnitVectors(up, v.negate());
  });
  return (
    <group ref={group}>
      <mesh geometry={geoms.pen} material={mat.pen} renderOrder={-1} />
      <mesh geometry={geoms.umbra} material={mat.umbra} renderOrder={-1} />
    </group>
  );
}
