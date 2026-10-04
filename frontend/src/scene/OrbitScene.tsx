"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useScenario } from "@/state/scenario";
import { timeStore, useSimTime } from "@/state/time";
import { useUi, type Mode } from "@/state/ui";
import type { PreparedNode, PreparedResult } from "@/sim/result";
import { cursorAt, lerp, lerpAngle, positionEci, sampleNode } from "@/sim/sample";
import { EARTH_R, eciToRender, ecefToLocal, footprintHalfAngle, latLonToLocal, smallCircle } from "@/sim/frames";
import { Atmosphere, EarthMesh, useEarthMaterials } from "./Earth";
import { encodeNode, C } from "./encoding";
import { LabelProjector, labelEntry } from "./labels";
import LabelLayer from "./LabelLayer";
import { flowLineMaterial, timeFadeLineMaterial } from "./materials";

// ------------------------------------------------------------------------------------------------
// Shared per-frame state (render state, never React state)
// ------------------------------------------------------------------------------------------------
const tmp3: [number, number, number] = [0, 0, 0];
const v1 = new THREE.Vector3();

function sunDirAt(res: PreparedResult, t: number, out: THREE.Vector3) {
  const c = cursorAt(res, t);
  const x = lerp(res.sun.x, c), y = lerp(res.sun.y, c), z = lerp(res.sun.z, c);
  eciToRender(x, y, z, tmp3);
  return out.set(tmp3[0], tmp3[1], tmp3[2]).normalize();
}

function nodePosAt(res: PreparedResult, nd: PreparedNode, t: number, out: THREE.Vector3) {
  const c = cursorAt(res, t);
  positionEci(nd, c, res.dt, tmp3);
  eciToRender(tmp3[0], tmp3[1], tmp3[2], tmp3);
  return out.set(tmp3[0], tmp3[1], tmp3[2]);
}

// Registry of live node positions (written each frame, read by links/labels).
const nodePositions: THREE.Vector3[] = Array.from({ length: 12 }, () => new THREE.Vector3());

// ------------------------------------------------------------------------------------------------
function Clock() {
  useFrame((_, delta) => timeStore.getState().advance(delta));
  return null;
}

function Stars() {
  const geom = useMemo(() => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const n = 1400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = 900;
      const s = Math.sqrt(1 - u * u);
      pos.set([r * s * Math.cos(th), r * u, r * s * Math.sin(th)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  return (
    <points geometry={geom}>
      <pointsMaterial color="#8892a0" size={1.1} sizeAttenuation={false} transparent opacity={0.55} depthWrite={false} />
    </points>
  );
}

function Sun({ res }: { res: PreparedResult }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const glyph = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const t = timeStore.getState().t;
    sunDirAt(res, t, v1);
    light.current?.position.copy(v1).multiplyScalar(50);
    glyph.current?.position.copy(v1).multiplyScalar(600);
  });
  return (
    <>
      <directionalLight ref={light} intensity={2.2} color="#fff6e8" />
      <ambientLight intensity={0.18} />
      <mesh ref={glyph}>
        <sphereGeometry args={[6, 24, 16]} />
        <meshBasicMaterial color="#ffd98a" toneMapped={false} />
      </mesh>
    </>
  );
}

// ------------------------------------------------------------------------------------------------
// Earth-fixed group (rotated by GMST): globe, ground tracks, stations, relays, footprints
// ------------------------------------------------------------------------------------------------
function EarthSystem({ res, mode }: { res: PreparedResult; mode: Mode }) {
  const group = useRef<THREE.Group>(null);
  const mats = useEarthMaterials();
  const showGrid = useUi((s) => s.showGrid);
  useFrame(() => {
    const t = timeStore.getState().t;
    const c = cursorAt(res, t);
    if (group.current) group.current.rotation.y = lerpAngle(res.gmst, c);
    sunDirAt(res, t, mats.uniforms.uSun.value);
    mats.uniforms.uGrid.value = showGrid ? 1 : 0;
    mats.uniforms.uShadowMode.value = mode === "power" || mode === "system" ? 1 : 0;
  });
  return (
    <>
      <group ref={group} name="earth-fixed">
        <EarthMesh material={mats.earth} />
        <GroundTracks res={res} />
        <Stations res={res} mode={mode} />
        <Relays res={res} />
      </group>
      <Atmosphere material={mats.atmo} />
    </>
  );
}

function GroundTracks({ res }: { res: PreparedResult }) {
  const show = useUi((s) => s.showGroundTracks);
  const selected = useUi((s) => s.selectedNode);
  const items = useMemo(() => {
    return res.nodes.map((nd) => {
      const n = res.n;
      const pos = new Float32Array(n * 3);
      const tt = new Float32Array(n);
      const p: [number, number, number] = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        latLonToLocal(nd.s.lat_deg[i], nd.s.lon_deg[i], EARTH_R * 1.0025, p);
        pos.set(p, i * 3);
        tt[i] = i * res.dt;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("aTime", new THREE.BufferAttribute(tt, 1));
      const period = Number(nd.raw.orbit.period_s) || 5700;
      const mat = timeFadeLineMaterial(C.warn, period, period * 0.5, 0.25);
      return { g, mat, period, line: new THREE.Line(g, mat) };
    });
  }, [res]);
  useEffect(() => () => items.forEach((it) => { it.g.dispose(); it.mat.dispose(); }), [items]);
  useFrame(() => {
    const t = timeStore.getState().t;
    items.forEach((it, i) => {
      const i0 = Math.max(0, Math.floor((t - it.period) / res.dt));
      const i1 = Math.min(res.n, Math.ceil((t + it.period * 0.5) / res.dt) + 1);
      it.g.setDrawRange(i0, Math.max(0, i1 - i0));
      it.mat.uniforms.uNow.value = t;
      it.mat.uniforms.uOpacity.value = i === selected ? 0.9 : 0.35;
    });
  });
  if (!show) return null;
  return <>{items.map((it, i) => <primitive key={i} object={it.line} />)}</>;
}

function Stations({ res, mode }: { res: PreparedResult; mode: Mode }) {
  const selected = useUi((s) => s.selectedNode);
  const t = useSimTime(4);
  const nd = res.nodes[selected] ?? res.nodes[0];
  const alt = Number(nd.raw.orbit.altitude_km) || 550;
  const rings = useMemo(
    () =>
      res.raw.stations.map((st) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(
          smallCircle(st.lat_deg, st.lon_deg, footprintHalfAngle(alt, st.min_elevation_deg), EARTH_R * 1.002), 3));
        return g;
      }),
    [res, alt],
  );
  useEffect(() => () => rings.forEach((g) => g.dispose()), [rings]);
  const c = cursorAt(res, t);
  const activeStation = nd.s.link_type[c.i] === 1 ? nd.s.link_station[c.i] : -1;
  return (
    <>
      {res.raw.stations.map((st, i) => {
        const p: [number, number, number] = [0, 0, 0];
        latLonToLocal(st.lat_deg, st.lon_deg, EARTH_R * 1.003, p);
        const active = i === activeStation;
        return (
          <group key={st.id}>
            <mesh position={p}>
              <octahedronGeometry args={[active ? 0.09 : 0.06, 0]} />
              <meshBasicMaterial color={active ? C.ok : "#9fb3c8"} toneMapped={false} />
            </mesh>
            {(mode === "network" || active) && (
              <lineLoop geometry={rings[i]}>
                <lineBasicMaterial color={active ? C.ok : C.accent} transparent opacity={active ? 0.7 : 0.3} />
              </lineLoop>
            )}
          </group>
        );
      })}
    </>
  );
}

function Relays({ res }: { res: PreparedResult }) {
  if (!res.raw.relays?.length) return null;
  const anyUses = res.raw.scenario.nodes.some((n) => n.comms.relay_enabled);
  if (!anyUses) return null;
  return (
    <>
      {res.raw.relays.map((rl) => {
        const lon = (rl.lon_deg * Math.PI) / 180;
        const p: [number, number, number] = [0, 0, 0];
        ecefToLocal(rl.radius_km * Math.cos(lon), rl.radius_km * Math.sin(lon), 0, p);
        return (
          <group key={rl.id} position={p}>
            <mesh>
              <boxGeometry args={[0.35, 0.35, 0.35]} />
              <meshBasicMaterial color="#a78bfa" toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

// ------------------------------------------------------------------------------------------------
// Inertial-frame objects: orbit paths, spacecraft, links, Earth shadow, preview orbit
// ------------------------------------------------------------------------------------------------
function OrbitPaths({ res }: { res: PreparedResult }) {
  const selected = useUi((s) => s.selectedNode);
  const items = useMemo(
    () =>
      res.nodes.map((nd) => {
        const n = res.n;
        const pos = new Float32Array(n * 3);
        const tt = new Float32Array(n);
        const p: [number, number, number] = [0, 0, 0];
        for (let i = 0; i < n; i++) {
          eciToRender(nd.s.r_eci_x[i], nd.s.r_eci_y[i], nd.s.r_eci_z[i], p);
          pos.set(p, i * 3);
          tt[i] = i * res.dt;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        g.setAttribute("aTime", new THREE.BufferAttribute(tt, 1));
        const period = Number(nd.raw.orbit.period_s) || 5700;
        const mat = timeFadeLineMaterial(C.accent, period * 0.55, period * 0.5, 0.3);
        return { g, mat, period, line: new THREE.Line(g, mat) };
      }),
    [res],
  );
  useEffect(() => () => items.forEach((it) => { it.g.dispose(); it.mat.dispose(); }), [items]);
  useFrame(() => {
    const t = timeStore.getState().t;
    items.forEach((it, i) => {
      const i0 = Math.max(0, Math.floor((t - it.period * 0.55) / res.dt));
      const i1 = Math.min(res.n, Math.ceil((t + it.period * 0.5) / res.dt) + 1);
      it.g.setDrawRange(i0, Math.max(0, i1 - i0));
      it.mat.uniforms.uNow.value = t;
      it.mat.uniforms.uOpacity.value = i === selected ? 1 : 0.4;
    });
  });
  return <>{items.map((it, i) => <primitive key={i} object={it.line} />)}</>;
}

function Spacecraft({ res, nd, mode }: { res: PreparedResult; nd: PreparedNode; mode: Mode }) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.MeshStandardMaterial>(null);
  const panels = useRef<THREE.Group>(null);
  const selected = useUi((s) => s.selectedNode === nd.index);
  const selectNode = useUi((s) => s.selectNode);
  const cfg = res.raw.scenario.nodes[nd.index];
  const t = useSimTime(8);
  const sample = useMemo(() => sampleNode(res, nd, t), [res, nd, t]);
  const enc = encodeNode(mode, sample, cfg);
  const { camera } = useThree();
  const sunV = useMemo(() => new THREE.Vector3(), []);
  // Schematic glyph sized for visibility (not to scale). Arrays scale with configured area.
  const arrayScale = Math.min(2.2, 0.6 + Math.sqrt(cfg.solar.area_m2) / 25);
  useFrame(() => {
    const tt = timeStore.getState().t;
    const g = group.current;
    if (!g) return;
    nodePosAt(res, nd, tt, nodePositions[nd.index]);
    g.position.copy(nodePositions[nd.index]);
    labelEntry(`node-${nd.index}`).world.copy(g.position);
    const d = camera.position.distanceTo(g.position);
    g.scale.setScalar(Math.max(0.6, d * 0.011));
    // sun-tracking arrays: orient panel normal toward the Sun
    sunDirAt(res, tt, sunV);
    panels.current?.lookAt(v1.copy(g.position).add(sunV));
  });
  const lit = sample.illum;
  return (
    <group ref={group}>
      <group onClick={(e) => { e.stopPropagation(); selectNode(nd.index); }}>
        <mesh>
          <boxGeometry args={[0.16, 0.16, 0.22]} />
          <meshStandardMaterial ref={body} color={enc.color} emissive={enc.color} emissiveIntensity={0.25 + 0.5 * lit} roughness={0.6} />
        </mesh>
        <group ref={panels}>
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * (0.12 + 0.18 * arrayScale), 0, 0]}>
              <boxGeometry args={[0.34 * arrayScale, 0.14 * arrayScale, 0.008]} />
              <meshStandardMaterial color={lit > 0.5 ? "#2b4a78" : "#1a2236"} emissive="#3d6cb3" emissiveIntensity={0.25 * lit} metalness={0.3} roughness={0.5} />
            </mesh>
          ))}
        </group>
        {selected && (
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.32, 0.35, 48]} />
            <meshBasicMaterial color={C.accent} side={THREE.DoubleSide} transparent opacity={0.9} toneMapped={false} />
          </mesh>
        )}
      </group>
    </group>
  );
}

function Links({ res, mode }: { res: PreparedResult; mode: Mode }) {
  const scene = useThree((s) => s.scene);
  const lines = useMemo(
    () =>
      res.nodes.map(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
        g.setAttribute("aT", new THREE.BufferAttribute(new Float32Array([0, 1]), 1));
        const mat = flowLineMaterial(C.ok);
        const line = new THREE.Line(g, mat);
        line.frustumCulled = false;
        return { g, mat, line };
      }),
    [res],
  );
  useEffect(() => () => lines.forEach((l) => { l.g.dispose(); l.mat.dispose(); }), [lines]);
  const target = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    const t = timeStore.getState().t;
    const earth = scene.getObjectByName("earth-fixed");
    const c = cursorAt(res, t);
    res.nodes.forEach((nd, i) => {
      const l = lines[i];
      const type = nd.s.link_type[c.i];
      l.line.visible = type > 0 && (mode === "network" || mode === "system" || mode === "orbit" || mode === "compute");
      if (!l.line.visible || !earth) return;
      const from = nodePositions[i];
      if (type === 1) {
        const st = res.raw.stations[nd.s.link_station[c.i]];
        latLonToLocal(st.lat_deg, st.lon_deg, EARTH_R * 1.003, tmp3);
        target.set(tmp3[0], tmp3[1], tmp3[2]);
        earth.localToWorld(target);
        l.mat.uniforms.uColor.value.set(C.ok);
      } else if (type === 2) {
        target.copy(nodePositions[nd.s.link_relay[c.i]]);
        l.mat.uniforms.uColor.value.set(C.accent);
      } else {
        const rl = res.raw.relays[nd.s.link_geo[c.i]];
        const lon = (rl.lon_deg * Math.PI) / 180;
        ecefToLocal(rl.radius_km * Math.cos(lon), rl.radius_km * Math.sin(lon), 0, tmp3);
        target.set(tmp3[0], tmp3[1], tmp3[2]);
        earth.localToWorld(target);
        l.mat.uniforms.uColor.value.set("#a78bfa");
      }
      const pos = l.g.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, from.x, from.y, from.z);
      pos.setXYZ(1, target.x, target.y, target.z);
      pos.needsUpdate = true;
      l.mat.uniforms.uLen.value = from.distanceTo(target);
      l.mat.uniforms.uTime.value = state.clock.elapsedTime;
      l.mat.uniforms.uOpacity.value = mode === "network" ? 0.95 : 0.5;
    });
  });
  return <>{lines.map((l, i) => <primitive key={i} object={l.line} />)}</>;
}

function EarthShadow({ res }: { res: PreparedResult }) {
  const mesh = useRef<THREE.Mesh>(null);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  useFrame(() => {
    const t = timeStore.getState().t;
    sunDirAt(res, t, v1);
    if (!mesh.current) return;
    mesh.current.quaternion.setFromUnitVectors(up, v1.clone().negate());
    mesh.current.position.copy(v1).multiplyScalar(-EARTH_R * 3);
  });
  // Cylindrical approximation of the umbra for display; eclipse state itself uses the conical model.
  return (
    <mesh ref={mesh} renderOrder={-1}>
      <cylinderGeometry args={[EARTH_R * 1.001, EARTH_R * 1.001, EARTH_R * 6, 64, 1, true]} />
      <meshBasicMaterial color="#1a1f3a" transparent opacity={0.28} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

function PreviewOrbit() {
  const preview = useUi((s) => s.preview);
  const overlay = useUi((s) => s.overlay);
  const geom = useMemo(() => {
    if (!preview) return null;
    const pts: number[] = [];
    const p: [number, number, number] = [0, 0, 0];
    for (const [x, y, z] of preview.data.r_eci) {
      eciToRender(x, y, z, p);
      pts.push(...p);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts), 3));
    return g;
  }, [preview]);
  const line = useMemo(() => {
    if (!geom) return null;
    const l = new THREE.LineLoop(geom, new THREE.LineDashedMaterial({ color: "#ffffff", dashSize: 0.25, gapSize: 0.18, transparent: true, opacity: 0.8 }));
    l.computeLineDistances();
    return l;
  }, [geom]);
  useEffect(() => () => geom?.dispose(), [geom]);
  if (!line || overlay !== "design" || !preview) return null;
  const first = preview.data.r_eci[0];
  const lp: [number, number, number] = [0, 0, 0];
  eciToRender(first[0], first[1], first[2], lp);
  labelEntry("preview").world.set(...lp);
  return <primitive object={line} />;
}

function SceneProbe() {
  // Exposes minimal render diagnostics for e2e tests.
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useFrame(() => {
    const w = window as unknown as { __oc?: Record<string, unknown> };
    const prev = (w.__oc?.frames as number) ?? 0;
    const earth = scene.getObjectByName("earth-fixed");
    const mesh = scene.getObjectByName("earth") as THREE.Mesh | undefined;
    const sun = (mesh?.material as THREE.ShaderMaterial | undefined)?.uniforms?.uSun?.value as THREE.Vector3 | undefined;
    w.__oc = {
      frames: prev + 1, calls: gl.info.render.calls, t: timeStore.getState().t,
      earthRotY: earth?.rotation.y, sunUniform: sun ? [sun.x, sun.y, sun.z] : null,
    };
  });
  return null;
}

function SceneContent() {
  const res = useScenario((s) => s.result);
  const mode = useUi((s) => s.mode);
  if (!res) return null;
  return (
    <>
      <Sun res={res} />
      <EarthSystem res={res} mode={mode} />
      {(mode === "power" || mode === "system") && <EarthShadow res={res} />}
      <OrbitPaths res={res} />
      {res.nodes.map((nd) => <Spacecraft key={`${res.hash}-${nd.index}`} res={res} nd={nd} mode={mode} />)}
      <Links res={res} mode={mode} />
      <PreviewOrbit />
    </>
  );
}

export default function OrbitScene() {
  const [ready, setReady] = useState(false);
  return (
    <div className="scene" data-testid="scene" data-ready={ready ? "1" : "0"} data-tutorial="scene">
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [16, 9, 20], fov: 40, near: 0.05, far: 3000 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => { gl.setClearColor("#05070a"); setReady(true); }}
      >
        <Clock />
        <Stars />
        <SceneContent />
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={8.5} maxDistance={140} rotateSpeed={0.5} />
        <SceneProbe />
        <LabelProjector />
      </Canvas>
      <LabelLayer />
    </div>
  );
}
