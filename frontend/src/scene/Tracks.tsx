"use client";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import type { PreparedResult } from "@/sim/result";
import { EARTH_R, eciToRender, footprintHalfAngle, latLonToLocal } from "@/sim/frames";
import { timeStore } from "@/state/time";
import { useUi } from "@/state/ui";
import { C } from "./encoding";
import { timeFadeFatLine } from "./materials";
import { nodePositions } from "./shared";

/** Full-horizon fat line with per-segment times so the shader can fade around "now". */
function buildTimedLine(points: Float32Array, n: number, dt: number) {
  const g = new LineGeometry();
  g.setPositions(points);
  const ts = new Float32Array(n - 1), te = new Float32Array(n - 1);
  for (let i = 0; i < n - 1; i++) { ts[i] = i * dt; te[i] = (i + 1) * dt; }
  g.setAttribute("instanceTStart", new THREE.InstancedBufferAttribute(ts, 1));
  g.setAttribute("instanceTEnd", new THREE.InstancedBufferAttribute(te, 1));
  return g;
}

export function OrbitTrails({ res }: { res: PreparedResult }) {
  const selected = useUi((s) => s.selectedNode);
  const items = useMemo(() => res.nodes.map((nd) => {
    const pos = new Float32Array(res.n * 3);
    const p: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < res.n; i++) {
      eciToRender(nd.s.r_eci_x[i], nd.s.r_eci_y[i], nd.s.r_eci_z[i], p);
      pos.set(p, i * 3);
    }
    const period = Number(nd.raw.orbit.period_s) || 5700;
    const g = buildTimedLine(pos, res.n, res.dt);
    const { material, uniforms } = timeFadeFatLine(C.accent, 1.4, period * 0.55, period * 0.5, 0.28);
    const line = new Line2(g, material);
    line.frustumCulled = false;
    return { g, material, uniforms, line };
  }), [res]);
  useEffect(() => () => items.forEach((it) => { it.g.dispose(); it.material.dispose(); }), [items]);
  useFrame(() => {
    const t = timeStore.getState().t;
    items.forEach((it, i) => {
      it.uniforms.uNow.value = t;
      it.material.linewidth = i === selected ? 2.6 : 1.3;
      it.material.opacity = i === selected ? 1 : 0.45;
    });
  });
  return <>{items.map((it, i) => <primitive key={i} object={it.line} />)}</>;
}

/** Ground tracks (child of the Earth-fixed group). */
export function GroundTracks({ res }: { res: PreparedResult }) {
  const show = useUi((s) => s.showGroundTracks);
  const selected = useUi((s) => s.selectedNode);
  const items = useMemo(() => res.nodes.map((nd) => {
    const pos = new Float32Array(res.n * 3);
    const p: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < res.n; i++) {
      latLonToLocal(nd.s.lat_deg[i], nd.s.lon_deg[i], EARTH_R * 1.0035, p);
      pos.set(p, i * 3);
    }
    const period = Number(nd.raw.orbit.period_s) || 5700;
    const g = buildTimedLine(pos, res.n, res.dt);
    const { material, uniforms } = timeFadeFatLine(C.warn, 1.6, period, period * 0.5, 0.22);
    const line = new Line2(g, material);
    line.frustumCulled = false;
    return { g, material, uniforms, line };
  }), [res]);
  useEffect(() => () => items.forEach((it) => { it.g.dispose(); it.material.dispose(); }), [items]);
  useFrame(() => {
    const t = timeStore.getState().t;
    items.forEach((it, i) => {
      it.uniforms.uNow.value = t;
      it.material.linewidth = i === selected ? 2.2 : 1.1;
      it.material.opacity = i === selected ? 0.85 : 0.3;
    });
  });
  if (!show) return null;
  return <>{items.map((it, i) => <primitive key={i} object={it.line} />)}</>;
}

/** Nadir line + footprint cap under the selected spacecraft (inertial frame). */
export function NadirFootprint({ res }: { res: PreparedResult }) {
  const selected = useUi((s) => s.selectedNode);
  const nd = res.nodes[Math.min(selected, res.nodes.length - 1)];
  const alt = Number(nd.raw.orbit.altitude_km) || 550;
  const lambda = footprintHalfAngle(alt, 10);
  const cap = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  const { lineGeom, capGeom, ringGeom } = useMemo(() => {
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const cg = new THREE.SphereGeometry(EARTH_R * 1.004, 48, 6, 0, Math.PI * 2, 0, lambda);
    const ring: number[] = [];
    for (let k = 0; k <= 96; k++) {
      const a = (k / 96) * Math.PI * 2;
      const r = EARTH_R * 1.005;
      ring.push(r * Math.sin(lambda) * Math.cos(a), r * Math.cos(lambda), r * Math.sin(lambda) * Math.sin(a));
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(ring), 3));
    return { lineGeom: lg, capGeom: cg, ringGeom: rg };
  }, [lambda]);
  useEffect(() => () => { lineGeom.dispose(); capGeom.dispose(); ringGeom.dispose(); }, [lineGeom, capGeom, ringGeom]);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const dir = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const p = nodePositions[nd.index];
    dir.copy(p).normalize();
    const surf = dir.clone().multiplyScalar(EARTH_R * 1.004);
    const a = lineGeom.attributes.position as THREE.BufferAttribute;
    a.setXYZ(0, p.x, p.y, p.z);
    a.setXYZ(1, surf.x, surf.y, surf.z);
    a.needsUpdate = true;
    cap.current?.quaternion.setFromUnitVectors(up, dir);
    // Fade the cap when it is on the far side of the globe
    const facing = camera.position.clone().normalize().dot(dir);
    if (cap.current) cap.current.visible = facing > -0.2;
  });
  return (
    <>
      <lineSegments geometry={lineGeom} frustumCulled={false}>
        <lineBasicMaterial color={C.accent} transparent opacity={0.45} depthWrite={false} />
      </lineSegments>
      <group ref={cap}>
        <mesh geometry={capGeom} renderOrder={1}>
          <meshBasicMaterial color={C.accent} transparent opacity={0.045} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        <lineLoop geometry={ringGeom}>
          <lineBasicMaterial color={C.accent} transparent opacity={0.55} depthWrite={false} />
        </lineLoop>
      </group>
    </>
  );
}
