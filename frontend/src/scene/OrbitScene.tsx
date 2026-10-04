"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useScenario } from "@/state/scenario";
import { timeStore } from "@/state/time";
import { useUi, type Mode } from "@/state/ui";
import type { PreparedResult } from "@/sim/result";
import { cursorAt, lerpAngle } from "@/sim/sample";
import { eciToRender } from "@/sim/frames";
import { Atmosphere, Clouds, EarthMesh, useEarthMaterials } from "./Earth";
import { MilkyWay, Stars, Sun } from "./Backdrop";
import { Spacecraft } from "./SpacecraftModel";
import { GroundTracks, NadirFootprint, OrbitTrails } from "./Tracks";
import { Links, Relays, Stations } from "./Network3D";
import { EclipseVolume } from "./EclipseVolume";
import CameraRig from "./CameraRig";
import Effects from "./Effects";
import { LabelProjector, labelEntry } from "./labels";
import LabelLayer from "./LabelLayer";
import { sunDirAt } from "./shared";

function Clock() {
  useFrame((_, delta) => timeStore.getState().advance(delta));
  return null;
}

// Earth-fixed group (rotated by GMST): globe, clouds, ground tracks, stations, relays
function EarthSystem({ res, mode }: { res: PreparedResult; mode: Mode }) {
  const group = useRef<THREE.Group>(null);
  const mats = useEarthMaterials();
  const showGrid = useUi((s) => s.showGrid);
  const showClouds = useUi((s) => s.showClouds);
  const quality = useUi((s) => s.quality);
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    const t = timeStore.getState().t;
    const c = cursorAt(res, t);
    if (group.current) group.current.rotation.y = lerpAngle(res.gmst, c);
    sunDirAt(res, t, mats.uniforms.uSun.value);
    mats.uniforms.uGrid.value = showGrid ? 1 : 0;
    mats.uniforms.uShadowMode.value = mode === "power" || mode === "system" ? 1 : 0;
    mats.clouds.uniforms.uDrift.value = t * 2.5e-5; // deterministic drift tied to sim time
    // illustrative city lights only read well from a distance; fade them out in close-ups
    const d = camera.position.length();
    (mats.earth.uniforms.uLightsOn as { value: number }).value = THREE.MathUtils.smoothstep(d, 10, 16);
  });
  return (
    <>
      <group ref={group} name="earth-fixed">
        <EarthMesh material={mats.earth} />
        {showClouds && quality === "high" && <Clouds material={mats.clouds} />}
        <GroundTracks res={res} />
        <Stations res={res} mode={mode} />
        <Relays res={res} />
      </group>
      <Atmosphere material={mats.atmo} />
    </>
  );
}

function PreviewOrbit() {
  const preview = useUi((s) => s.preview);
  const overlay = useUi((s) => s.overlay);
  const line = useMemo(() => {
    if (!preview) return null;
    const pts: number[] = [];
    const p: [number, number, number] = [0, 0, 0];
    for (const [x, y, z] of preview.data.r_eci) {
      eciToRender(x, y, z, p);
      pts.push(...p);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts), 3));
    const l = new THREE.LineLoop(g, new THREE.LineDashedMaterial({ color: "#ffffff", dashSize: 0.25, gapSize: 0.18, transparent: true, opacity: 0.85 }));
    l.computeLineDistances();
    return l;
  }, [preview]);
  useEffect(() => () => { line?.geometry.dispose(); (line?.material as THREE.Material | undefined)?.dispose(); }, [line]);
  useEffect(() => {
    if (!preview) return;
    const [x, y, z] = preview.data.r_eci[0];
    const lp: [number, number, number] = [0, 0, 0];
    eciToRender(x, y, z, lp);
    labelEntry("preview").world.set(...lp);
  }, [preview]);
  if (!line || overlay !== "design" || !preview) return null;
  return <primitive object={line} />;
}

function SceneProbe() {
  // Minimal render diagnostics for e2e tests and frame-rate checks.
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const fps = useRef({ last: 0, frames: 0, value: 0 });
  useFrame(() => {
    const w = window as unknown as { __oc?: Record<string, unknown> };
    const prev = (w.__oc?.frames as number) ?? 0;
    const f = fps.current;
    f.frames++;
    const now = performance.now();
    if (now - f.last > 1000) { f.value = (f.frames * 1000) / (now - f.last); f.frames = 0; f.last = now; }
    const earth = scene.getObjectByName("earth-fixed");
    w.__oc = { frames: prev + 1, calls: gl.info.render.calls, t: timeStore.getState().t, earthRotY: earth?.rotation.y, fps: f.value };
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
      {(mode === "power" || mode === "system") && <EclipseVolume res={res} />}
      <OrbitTrails res={res} />
      {res.nodes.map((nd) => <Spacecraft key={`${res.hash}-${nd.index}`} res={res} nd={nd} mode={mode} />)}
      <NadirFootprint res={res} />
      <Links res={res} mode={mode} />
      <PreviewOrbit />
    </>
  );
}

export default function OrbitScene() {
  const [ready, setReady] = useState(false);
  const quality = useUi((s) => s.quality);
  return (
    <div className="scene" data-testid="scene" data-ready={ready ? "1" : "0"} data-quality={quality} data-tutorial="scene">
      <Canvas
        key={quality}
        dpr={quality === "high" ? [1, 2] : 1}
        camera={{ position: [16, 9, 20], fov: 40, near: 0.02, far: 5000 }}
        gl={{ antialias: quality !== "high", preserveDrawingBuffer: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
        onCreated={({ gl }) => { gl.setClearColor("#04060a"); setReady(true); }}
      >
        <Clock />
        <MilkyWay />
        <Stars />
        <SceneContent />
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={8.5} maxDistance={160} rotateSpeed={0.5} />
        <CameraRig />
        <Effects />
        <SceneProbe />
        <LabelProjector />
      </Canvas>
      <LabelLayer />
    </div>
  );
}
