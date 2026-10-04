"use client";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { PreparedResult } from "@/sim/result";
import { cursorAt } from "@/sim/sample";
import { EARTH_R, EARTH_RADIUS_KM, KM_PER_UNIT, ecefToLocal, footprintHalfAngle, latLonToLocal, smallCircle } from "@/sim/frames";
import { timeStore, useSimTime } from "@/state/time";
import { useUi, type Mode } from "@/state/ui";
import { C } from "./encoding";
import { glowTexture, nodePositions, setLinkTarget, tmp3 } from "./shared";

const LINK_COLORS = { 1: C.ok, 2: C.accent, 3: "#a78bfa" } as Record<number, string>;

/** Ground stations: emissive markers, visibility rings, and (network mode) visibility cones. */
export function Stations({ res, mode }: { res: PreparedResult; mode: Mode }) {
  const selected = useUi((s) => s.selectedNode);
  const t = useSimTime(4);
  const nd = res.nodes[Math.min(selected, res.nodes.length - 1)];
  const alt = Number(nd.raw.orbit.altitude_km) || 550;
  const geo = useMemo(() => {
    const R = EARTH_RADIUS_KM, h = alt;
    return res.raw.stations.map((st) => {
      const lam = footprintHalfAngle(alt, st.min_elevation_deg);
      const ring = new THREE.BufferGeometry();
      ring.setAttribute("position", new THREE.BufferAttribute(smallCircle(st.lat_deg, st.lon_deg, lam, EARTH_R * 1.002), 3));
      // Visibility cone: apex at the station, rim where the orbit shell meets the elevation mask.
      const el = (st.min_elevation_deg * Math.PI) / 180;
      const rho = Math.sqrt((R + h) ** 2 - (R * Math.cos(el)) ** 2) - R * Math.sin(el); // slant range, km
      const coneR = (rho * Math.cos(el)) / KM_PER_UNIT, coneH = (rho * Math.sin(el)) / KM_PER_UNIT;
      const cone = new THREE.ConeGeometry(coneR, coneH, 64, 1, true);
      cone.translate(0, -coneH / 2, 0); // apex at origin, opening upward after flip
      cone.rotateX(Math.PI);
      // Orientation: local vertical at the station
      const p: [number, number, number] = [0, 0, 0];
      latLonToLocal(st.lat_deg, st.lon_deg, EARTH_R * 1.003, p);
      const pos = new THREE.Vector3(...p);
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), pos.clone().normalize());
      return { ring, cone, pos, quat };
    });
  }, [res, alt]);
  useEffect(() => () => geo.forEach((g) => { g.ring.dispose(); g.cone.dispose(); }), [geo]);
  const coneMat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(C.accent) }, uOpacity: { value: 0.12 } },
    vertexShader: /* glsl */ `varying float vH; void main(){ vH = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uOpacity; varying float vH;
      void main(){ float a = uOpacity * (0.25 + 0.75 * vH); gl_FragColor = vec4(uColor * a, a);
        #include <colorspace_fragment>
      }`,
  }), []);
  const activeMat = useMemo(() => { const m = coneMat.clone(); m.uniforms.uColor.value = new THREE.Color(C.ok); m.uniforms.uOpacity.value = 0.22; return m; }, [coneMat]);
  const c = cursorAt(res, t);
  const activeStation = nd.s.link_type[c.i] === 1 ? nd.s.link_station[c.i] : -1;
  return (
    <>
      {res.raw.stations.map((st, i) => {
        const active = i === activeStation;
        const g = geo[i];
        return (
          <group key={st.id}>
            <group position={g.pos} quaternion={g.quat}>
              <mesh position={[0, 0.02, 0]}>
                <cylinderGeometry args={[0.035, 0.05, 0.04, 8]} />
                <meshStandardMaterial color="#5b6573" metalness={0.5} roughness={0.5} />
              </mesh>
              <mesh position={[0, 0.06, 0]}>
                <sphereGeometry args={[active ? 0.045 : 0.03, 12, 8]} />
                <meshBasicMaterial color={active ? new THREE.Color(C.ok).multiplyScalar(1.25) : new THREE.Color("#9fb3c8")} toneMapped={!active} />
              </mesh>
              {mode === "network" && (
                <mesh geometry={g.cone} material={active ? activeMat : coneMat} renderOrder={1} />
              )}
            </group>
            {(mode === "network" || active) && (
              <lineLoop geometry={g.ring}>
                <lineBasicMaterial color={active ? C.ok : C.accent} transparent opacity={active ? 0.75 : 0.3} depthWrite={false} />
              </lineLoop>
            )}
          </group>
        );
      })}
    </>
  );
}

export function Relays({ res }: { res: PreparedResult }) {
  const glow = useMemo(() => glowTexture([[0, "rgba(167,139,250,0.9)"], [0.3, "rgba(167,139,250,0.25)"], [1, "rgba(167,139,250,0)"]]), []);
  if (!res.raw.relays?.length || !res.raw.scenario.nodes.some((n) => n.comms.relay_enabled)) return null;
  return (
    <>
      {res.raw.relays.map((rl) => {
        const lon = (rl.lon_deg * Math.PI) / 180;
        const p: [number, number, number] = [0, 0, 0];
        ecefToLocal(rl.radius_km * Math.cos(lon), rl.radius_km * Math.sin(lon), 0, p);
        return (
          <group key={rl.id} position={p}>
            <mesh>
              <boxGeometry args={[0.3, 0.3, 0.42]} />
              <meshStandardMaterial color="#c9ced6" metalness={0.6} roughness={0.4} />
            </mesh>
            <mesh position={[0.55, 0, 0]}><boxGeometry args={[0.7, 0.02, 0.28]} /><meshStandardMaterial color="#1d3f73" metalness={0.3} roughness={0.4} /></mesh>
            <mesh position={[-0.55, 0, 0]}><boxGeometry args={[0.7, 0.02, 0.28]} /><meshStandardMaterial color="#1d3f73" metalness={0.3} roughness={0.4} /></mesh>
            <sprite scale={[2.2, 2.2, 1]}>
              <spriteMaterial map={glow} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
            </sprite>
          </group>
        );
      })}
    </>
  );
}

const PACKETS = 4;

/** Communication links: fat glowing beams with travelling data packets (downlink direction). */
export function Links({ res, mode }: { res: PreparedResult; mode: Mode }) {
  const scene = useThree((s) => s.scene);
  const packetTex = useMemo(() => glowTexture([[0, "rgba(255,255,255,1)"], [0.35, "rgba(255,255,255,0.4)"], [1, "rgba(255,255,255,0)"]], 64), []);
  const links = useMemo(() => res.nodes.map(() => {
    const g = new LineGeometry();
    g.setPositions([0, 0, 0, 0, 0, 1]);
    const m = new LineMaterial({ color: 0xffffff, linewidth: 2, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 });
    const line = new Line2(g, m);
    line.frustumCulled = false;
    const packets = Array.from({ length: PACKETS }, () => {
      const sm = new THREE.SpriteMaterial({ map: packetTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
      const sp = new THREE.Sprite(sm);
      sp.scale.setScalar(0.18);
      return sp;
    });
    const group = new THREE.Group();
    group.add(line, ...packets);
    return { g, m, line, packets, group };
  }), [res, packetTex]);
  useEffect(() => () => links.forEach((l) => { l.g.dispose(); l.m.dispose(); l.packets.forEach((p) => p.material.dispose()); }), [links]);
  const target = useMemo(() => new THREE.Vector3(), []);
  const posBuf = useMemo(() => new Float32Array(6), []);
  const col = useMemo(() => new THREE.Color(), []);
  const phase = useRef(0);
  useFrame((state, delta) => {
    phase.current += delta;
    const t = timeStore.getState().t;
    const earth = scene.getObjectByName("earth-fixed");
    const c = cursorAt(res, t);
    res.nodes.forEach((nd, i) => {
      const l = links[i];
      const type = nd.s.link_type[c.i];
      const show = type > 0 && mode !== "thermal" && mode !== "power";
      if (!type || !earth) { setLinkTarget(i, null); l.group.visible = false; return; }
      if (type === 1) {
        const st = res.raw.stations[nd.s.link_station[c.i]];
        latLonToLocal(st.lat_deg, st.lon_deg, EARTH_R * 1.003, tmp3);
        target.set(tmp3[0], tmp3[1], tmp3[2]);
        earth.localToWorld(target);
      } else if (type === 2) {
        target.copy(nodePositions[nd.s.link_relay[c.i]]);
      } else {
        const rl = res.raw.relays[nd.s.link_geo[c.i]];
        const lon = (rl.lon_deg * Math.PI) / 180;
        ecefToLocal(rl.radius_km * Math.cos(lon), rl.radius_km * Math.sin(lon), 0, tmp3);
        target.set(tmp3[0], tmp3[1], tmp3[2]);
        earth.localToWorld(target);
      }
      setLinkTarget(i, target);
      l.group.visible = show;
      if (!show) return;
      const from = nodePositions[i];
      posBuf[0] = from.x; posBuf[1] = from.y; posBuf[2] = from.z;
      posBuf[3] = target.x; posBuf[4] = target.y; posBuf[5] = target.z;
      l.g.setPositions(posBuf);
      col.set(LINK_COLORS[type]);
      l.m.color.copy(col);
      l.m.linewidth = mode === "network" ? 2.4 : 1.4;
      l.m.opacity = mode === "network" ? 0.75 : 0.4;
      const rate = nd.s.link_down_gbps[c.i];
      const speed = 0.25 + 0.45 * Math.min(rate / 5, 1); // cycles per second (display only)
      l.packets.forEach((p, k) => {
        const f = (phase.current * speed + k / PACKETS) % 1;
        p.position.lerpVectors(from, target, f);
        p.material.color.copy(col).multiplyScalar(1.8);
        p.material.opacity = Math.sin(Math.PI * f);
        const s = mode === "network" ? 0.2 : 0.13;
        p.scale.setScalar(s * (from.distanceTo(target) > 20 ? 2.5 : 1));
      });
    });
  });
  return <>{links.map((l, i) => <primitive key={i} object={l.group} />)}</>;
}
