"use client";
// Procedural spacecraft (conceptual, not to scale, not a packaging design). Built from primitives:
// hex bus + compute module, sun-tracking solar wings, radiators edge-on to the Sun (perpendicular
// to the wings), a comms dish pointing at the active link, an emissive status light, and a
// billboard gauge ring for the current mode. All per-frame updates mutate three objects directly.
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { PreparedNode, PreparedResult } from "@/sim/result";
import { sampleNode, type NodeSample } from "@/sim/sample";
import type { NodeConfig } from "@/sim/types";
import { timeStore } from "@/state/time";
import { useUi, type Mode } from "@/state/ui";
import { C, encodeNode } from "./encoding";
import { labelEntry } from "./labels";
import { glowTexture, linkTargets, nodePosAt, nodePositions, sunDirAt } from "./shared";

const vSun = new THREE.Vector3();
const vTmp = new THREE.Vector3();
const cTmp = new THREE.Color();

// ---- shared assets ---------------------------------------------------------------------------
let cellTex: THREE.CanvasTexture | null = null;
function solarCellTexture() {
  if (cellTex) return cellTex;
  const c = document.createElement("canvas");
  c.width = 256; c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0d1f3d";
  g.fillRect(0, 0, 256, 128);
  for (let x = 0; x < 16; x++) for (let y = 0; y < 8; y++) {
    const shade = 30 + ((x * 7 + y * 13) % 9) * 3;
    g.fillStyle = `rgb(${shade - 8},${shade + 18},${shade + 70})`;
    g.fillRect(x * 16 + 1, y * 16 + 1, 14, 14);
  }
  g.strokeStyle = "rgba(170,190,220,0.35)";
  g.lineWidth = 1;
  for (let x = 0; x <= 256; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
  cellTex = new THREE.CanvasTexture(c);
  cellTex.colorSpace = THREE.SRGBColorSpace;
  cellTex.anisotropy = 4;
  return cellTex;
}

/** False-colour ramp for radiator temperature (°C): cold blue → neutral → amber → red. */
export function radiatorColor(tC: number, out: THREE.Color) {
  const stops: [number, string][] = [[-60, "#3d7bd9"], [0, "#7fa7c9"], [35, "#c9d1db"], [60, "#f5a524"], [85, "#ef4444"]];
  if (tC <= stops[0][0]) return out.set(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    if (tC <= stops[i][0]) {
      const f = (tC - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      return out.set(stops[i - 1][1]).lerp(cTmp.set(stops[i][1]), f);
    }
  }
  return out.set(stops[stops.length - 1][1]);
}

// ---- gauge ring shader -------------------------------------------------------------------------
function gaugeMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    uniforms: {
      uA: { value: 0 }, uB: { value: -1 }, uTick: { value: -1 },
      uColA: { value: new THREE.Color(C.ok) }, uColB: { value: new THREE.Color("#ffd98a") },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uA; uniform float uB; uniform float uTick; uniform vec3 uColA; uniform vec3 uColB; uniform float uOpacity;
      varying vec2 vUv;
      const float PI = 3.14159265;
      float arc(float r, float r0, float r1, float ang, float frac) {
        float inR = smoothstep(r0 - 0.012, r0, r) * (1.0 - smoothstep(r1, r1 + 0.012, r));
        return inR * step(ang, frac);
      }
      void main(){
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        float ang = fract(0.25 - atan(p.y, p.x) / (2.0 * PI)); // 0 at top, clockwise
        // track
        float trackA = smoothstep(0.80, 0.81, r) * (1.0 - smoothstep(0.89, 0.90, r));
        vec3 col = vec3(0.35, 0.42, 0.52) * trackA * 0.25;
        float a = trackA * 0.25;
        float ra = arc(r, 0.81, 0.89, ang, uA);
        col += uColA * ra * 1.4; a = max(a, ra);
        if (uB >= 0.0) {
          float trackB = smoothstep(0.68, 0.69, r) * (1.0 - smoothstep(0.75, 0.76, r));
          col += vec3(0.35, 0.42, 0.52) * trackB * 0.2; a = max(a, trackB * 0.2);
          float rb = arc(r, 0.69, 0.75, ang, uB);
          col += uColB * rb * 1.3; a = max(a, rb);
        }
        if (uTick >= 0.0) {
          float t = smoothstep(0.012, 0.0, abs(ang - uTick)) * smoothstep(0.78, 0.79, r) * (1.0 - smoothstep(0.92, 0.93, r));
          col += vec3(1.0, 0.3, 0.3) * t; a = max(a, t);
        }
        if (a < 0.01) discard;
        gl_FragColor = vec4(col, a * uOpacity);
        #include <colorspace_fragment>
      }`,
  });
}

function gaugeValues(mode: Mode, s: NodeSample, cfg: NodeConfig, ratedSolar: number) {
  switch (mode) {
    case "power": return { a: s.soc, b: Math.min(s.pGen / Math.max(ratedSolar, 1e-6), 1), tick: cfg.battery.min_soc, colA: s.soc <= cfg.battery.min_soc + 0.01 ? C.bad : s.soc < 0.4 ? C.warn : C.ok, colB: "#ffd98a" };
    case "compute": return { a: s.util, b: s.allocFrac, tick: -1, colA: C.accent, colB: "#8b95a3" };
    case "thermal": {
      const th = cfg.thermal;
      const f = (s.tEquip - th.min_operating_c) / Math.max(th.limit_c - th.min_operating_c, 1);
      const tick = (th.throttle_c - th.min_operating_c) / Math.max(th.limit_c - th.min_operating_c, 1);
      return { a: Math.min(Math.max(f, 0), 1), b: -1, tick, colA: s.thermalCode >= 2 ? C.bad : s.thermalCode === 1 ? C.warn : "#9fc3e6", colB: "#fff" };
    }
    default: return null;
  }
}

// ---- component ---------------------------------------------------------------------------------
export function Spacecraft({ res, nd, mode }: { res: PreparedResult; nd: PreparedNode; mode: Mode }) {
  const root = useRef<THREE.Group>(null);
  const craft = useRef<THREE.Group>(null);
  const dish = useRef<THREE.Group>(null);
  const gauge = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Sprite>(null);
  const selected = useUi((s) => s.selectedNode === nd.index);
  const selectNode = useUi((s) => s.selectNode);
  const setUi = useUi((s) => s.set);
  const camera = useThree((s) => s.camera);
  const cfg = res.raw.scenario.nodes[nd.index];
  const ratedSolar = Number(res.raw.nodes[nd.index].derived.rated_solar_kw) || 1;

  // Dimensions from configuration (conceptual): wings ∝ √area, radiators ∝ √area, bus ∝ compute power.
  const dims = useMemo(() => {
    const wingL = Math.min(0.62, 0.16 + Math.sqrt(cfg.solar.area_m2) * 0.012);
    const wingH = Math.min(0.2, 0.07 + Math.sqrt(cfg.solar.area_m2) * 0.0035);
    const radL = Math.min(0.46, 0.08 + Math.sqrt(cfg.thermal.radiator_area_m2) * 0.011);
    const radW = Math.min(0.12, 0.04 + Math.sqrt(cfg.thermal.radiator_area_m2) * 0.0025);
    const pkW = (cfg.compute.accelerator_count * cfg.compute.max_w) / 1000;
    const bus = Math.min(0.11, 0.045 + Math.sqrt(pkW) * 0.0035);
    return { wingL, wingH, radL, radW, bus };
  }, [cfg]);

  const mats = useMemo(() => ({
    bus: new THREE.MeshStandardMaterial({ color: "#c9ced6", metalness: 0.65, roughness: 0.38 }),
    foil: new THREE.MeshStandardMaterial({ color: "#c79a3c", metalness: 0.85, roughness: 0.32, emissive: "#3a2a08", emissiveIntensity: 0.2 }),
    module: new THREE.MeshStandardMaterial({ color: "#2a3646", metalness: 0.5, roughness: 0.45, emissive: "#4da3ff", emissiveIntensity: 0.0 }),
    wing: new THREE.MeshStandardMaterial({ map: solarCellTexture(), metalness: 0.35, roughness: 0.3, emissive: "#1d3f73", emissiveIntensity: 0.15 }),
    wingBack: new THREE.MeshStandardMaterial({ color: "#3a3f47", metalness: 0.4, roughness: 0.6 }),
    radiator: new THREE.MeshStandardMaterial({ color: "#d9dee5", metalness: 0.1, roughness: 0.55, emissive: "#000000", emissiveIntensity: 1, toneMapped: true }),
    boom: new THREE.MeshStandardMaterial({ color: "#8b95a3", metalness: 0.7, roughness: 0.4 }),
    light: new THREE.MeshBasicMaterial({ color: new THREE.Color(C.ok), toneMapped: false }),
    dish: new THREE.MeshStandardMaterial({ color: "#e6e9ee", metalness: 0.5, roughness: 0.3, side: THREE.DoubleSide }),
    gauge: gaugeMaterial(),
    halo: new THREE.SpriteMaterial({ map: glowTexture([[0, "rgba(77,163,255,0.0)"], [0.55, "rgba(77,163,255,0.0)"], [0.68, "rgba(77,163,255,0.55)"], [0.78, "rgba(77,163,255,0.0)"], [1, "rgba(77,163,255,0)"]]), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  }), []);

  useFrame((state) => {
    const t = timeStore.getState().t;
    const g = root.current;
    if (!g) return;
    const pos = nodePosAt(res, nd, t, nodePositions[nd.index]);
    g.position.copy(pos);
    labelEntry(`node-${nd.index}`).world.copy(pos);
    const d = camera.position.distanceTo(pos);
    // constant-ish screen size far away, legible minimum size when close (schematic, not to scale)
    g.scale.setScalar(Math.max(0.38, d * 0.0115));
    // Attitude: wings' normal (+z) toward the Sun; radiators (±y, normal ±x) therefore edge-on.
    sunDirAt(res, t, vSun);
    craft.current?.lookAt(vTmp.copy(pos).add(vSun));
    // Dish toward the active link target (or nadir when no link).
    const tgt = linkTargets[nd.index];
    dish.current?.lookAt(tgt ?? vTmp.copy(pos).multiplyScalar(0.5));

    // Encodings (cheap; computed per frame without React).
    const s = sampleNode(res, nd, t);
    const enc = encodeNode(mode, s, cfg);
    const lit = s.illum;
    mats.light.color.set(enc.color).multiplyScalar(1.6 + 0.6 * Math.sin(state.clock.elapsedTime * 3.0) * (s.powerLimited || s.thermalCode >= 2 ? 1 : 0));
    mats.wing.emissiveIntensity = 0.04 + 0.22 * lit;
    mats.wing.color.setScalar(0.35 + 0.65 * lit);
    if (mode === "thermal" || mode === "system") {
      radiatorColor(s.tRad, mats.radiator.color);
      radiatorColor(s.tRad, mats.radiator.emissive);
      mats.radiator.emissiveIntensity = Math.min(Math.max((s.tRad - 25) / 50, 0), 1) * 1.6;
    } else {
      mats.radiator.color.set("#d9dee5");
      mats.radiator.emissiveIntensity = 0;
    }
    mats.module.emissive.set(C.accent);
    mats.module.emissiveIntensity = mode === "compute" ? 0.15 + 1.1 * s.util : 0.05 + 0.25 * s.util;

    // Gauge ring billboard
    const gv = gaugeValues(mode, s, cfg, ratedSolar);
    if (gauge.current) {
      gauge.current.visible = !!gv;
      gauge.current.quaternion.copy(camera.quaternion);
      if (gv) {
        const u = mats.gauge.uniforms;
        u.uA.value = gv.a; u.uB.value = gv.b; u.uTick.value = gv.tick;
        u.uColA.value.set(gv.colA); u.uColB.value.set(gv.colB);
      }
    }
    if (halo.current) {
      halo.current.visible = selected;
      const k = 1 + 0.06 * Math.sin(state.clock.elapsedTime * 2.2);
      halo.current.scale.set(1.25 * k, 1.25 * k, 1);
    }
  });

  const { wingL, wingH, radL, radW, bus } = dims;
  const wingOffset = bus + 0.05 + wingL / 2;
  return (
    <group ref={root}>
      <group
        onClick={(e) => { e.stopPropagation(); selectNode(nd.index); }}
        onDoubleClick={(e) => { e.stopPropagation(); selectNode(nd.index); setUi({ follow: true }); }}
      >
        <group ref={craft}>
          {/* bus: hex prism wrapped in foil, compute module on top */}
          <mesh material={mats.foil} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[bus, bus, bus * 1.9, 6]} />
          </mesh>
          <mesh material={mats.module} position={[0, 0, -bus * 1.25]}>
            <boxGeometry args={[bus * 1.25, bus * 1.25, bus * 0.7]} />
          </mesh>
          <mesh material={mats.bus} position={[0, 0, bus * 1.05]}>
            <cylinderGeometry args={[bus * 0.55, bus * 0.8, bus * 0.25, 6]} />
          </mesh>
          {/* status light */}
          <mesh material={mats.light} position={[0, bus * 0.95, 0]}>
            <sphereGeometry args={[bus * 0.22, 12, 8]} />
          </mesh>
          {/* solar wings (+x / −x), cells facing +z (Sun) */}
          {[-1, 1].map((side) => (
            <group key={side} position={[side * wingOffset, 0, 0]}>
              <mesh material={mats.boom} position={[-side * (wingL / 2 + 0.025), 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.004, 0.004, 0.05, 6]} />
              </mesh>
              <mesh material={mats.wing} position={[0, 0, 0.002]}>
                <planeGeometry args={[wingL, wingH]} />
              </mesh>
              <mesh material={mats.wingBack} position={[0, 0, -0.002]} rotation={[0, Math.PI, 0]}>
                <planeGeometry args={[wingL, wingH]} />
              </mesh>
            </group>
          ))}
          {/* radiators (+y / −y), panels in the y–z plane: edge-on to the Sun */}
          {[-1, 1].map((side) => (
            <mesh key={`r${side}`} material={mats.radiator} position={[0, side * (bus + 0.02 + radL / 2), -bus * 0.2]}>
              <boxGeometry args={[0.006, radL, radW]} />
            </mesh>
          ))}
        </group>
        {/* comms dish */}
        <group ref={dish}>
          <mesh material={mats.dish} position={[0, 0, bus * 1.1]} rotation={[-Math.PI / 2, 0, 0]}>
            <coneGeometry args={[bus * 0.5, bus * 0.25, 16, 1, true]} />
          </mesh>
        </group>
        <mesh ref={gauge} material={mats.gauge} renderOrder={5}>
          <planeGeometry args={[1.05, 1.05]} />
        </mesh>
        <sprite ref={halo} material={mats.halo} renderOrder={4} />
      </group>
    </group>
  );
}
