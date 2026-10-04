"use client";
// Data packets between people on Earth and the orbital compute nodes.
// Requests (cyan) travel city → ground endpoint → (GEO relay / ISL neighbour) → spacecraft;
// results (green) travel back down to the cities. With no link, requests pile up at the home
// station (amber) — users waiting. Packet density follows the simulated uplink/downlink use and
// realtime inference sessions; user locations and backhaul arcs are illustrative.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { PreparedResult } from "@/sim/result";
import { cursorAt } from "@/sim/sample";
import { EARTH_R, ecefToLocal, latLonToLocal } from "@/sim/frames";
import { timeStore, useSimTime } from "@/state/time";
import type { Mode } from "@/state/ui";
import { ARC_PTS, arcLocal, citiesNear, flowFor, routeFor, type City, type Endpoint } from "./userRoutes";
import { nodePositions } from "./shared";

const UP = "#5ec8ff", DOWN = "#3ecf8e", WAIT = "#f5a524";
const CITIES = 6, SLOTS = 3, MAX_NODES = 12;
const TRAIL = 3; // head + two fading echoes (comet trail)
const PER_NODE = CITIES * SLOTS * 2 * TRAIL;
const SPEED = 0.32; // route cycles per second (display only)

export function dataFlowVisible(mode: Mode) {
  return mode === "network" ? 1 : mode === "orbit" || mode === "compute" || mode === "system" ? 0.6 : 0;
}

/** Illustrative city → endpoint arcs and city markers (child of the Earth-fixed group). */
export function UserArcs({ res, mode }: { res: PreparedResult; mode: Mode }) {
  const t = useSimTime(4);
  const vis = dataFlowVisible(mode);
  const c = cursorAt(res, t);
  // Active endpoints for all nodes at this step
  const active = useMemo(() => {
    const m = new Map<string, { ep: Endpoint; waiting: boolean }>();
    res.nodes.forEach((_, n) => {
      const r = routeFor(res, n, c.i, t);
      if (!r.endpoint) return;
      const waiting = r.linkType === 0;
      if (waiting && flowFor(res, n, c.i).waiting <= 0) return;
      const prev = m.get(r.endpoint.key);
      m.set(r.endpoint.key, { ep: r.endpoint, waiting: (prev?.waiting ?? true) && waiting });
    });
    return [...m.values()];
  }, [res, c.i, t]);
  const key = active.map((a) => `${a.ep.key}${a.waiting ? "w" : ""}`).sort().join(",");
  const built = useMemo(() => {
    const mk = (color: string, width: number, opacity: number) => {
      const g = new LineSegmentsGeometry();
      const m = new LineMaterial({ color: new THREE.Color(color).getHex(), linewidth: width, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
      const l = new LineSegments2(g, m);
      l.frustumCulled = false;
      return { g, m, l };
    };
    const live = mk(UP, 1.3, 0.45), wait = mk(WAIT, 1.3, 0.5);
    const segs = (list: typeof active) => {
      const out: number[] = [];
      for (const a of list) for (const city of citiesNear(a.ep)) {
        const p = arcLocal(city, a.ep, EARTH_R);
        for (let k = 0; k < ARC_PTS - 1; k++) out.push(p[k * 3], p[k * 3 + 1], p[k * 3 + 2], p[k * 3 + 3], p[k * 3 + 4], p[k * 3 + 5]);
      }
      return out;
    };
    const liveSegs = segs(active.filter((a) => !a.waiting));
    const waitSegs = segs(active.filter((a) => a.waiting));
    if (liveSegs.length) live.g.setPositions(liveSegs); else live.l.visible = false;
    if (waitSegs.length) wait.g.setPositions(waitSegs); else wait.l.visible = false;
    // city markers
    const pts: number[] = [];
    const p: [number, number, number] = [0, 0, 0];
    for (const a of active) for (const city of citiesNear(a.ep)) { latLonToLocal(city.lat, city.lon, EARTH_R * 1.004, p); pts.push(...p); }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts), 3));
    return { live, wait, cg };
    // `key` captures the active set; `active` changes identity every update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => () => {
    built.live.g.dispose(); built.live.m.dispose(); built.wait.g.dispose(); built.wait.m.dispose(); built.cg.dispose();
  }, [built]);
  if (!vis) return null;
  built.live.m.opacity = 0.45 * vis;
  built.wait.m.opacity = 0.5 * vis;
  return (
    <>
      <primitive object={built.live.l} />
      <primitive object={built.wait.l} />
      <points geometry={built.cg}>
        <pointsMaterial color="#ffe2b0" size={4} sizeAttenuation={false} transparent opacity={0.9 * vis} depthWrite={false} toneMapped={false} />
      </points>
    </>
  );
}

const pointsVert = /* glsl */ `
attribute vec3 aColor; attribute float aAlpha; attribute float aSize;
uniform float uPx;
varying vec3 vC; varying float vA;
void main() {
  vC = aColor; vA = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * 30.0 / -mv.z, 3.0, 18.0) * uPx;
  gl_Position = projectionMatrix * mv;
}`;
const pointsFrag = /* glsl */ `
varying vec3 vC; varying float vA;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float core = smoothstep(0.5, 0.0, r);
  float a = pow(core, 1.5) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vC * (1.0 + 1.2 * smoothstep(0.25, 0.0, r)) * a, a);
  #include <colorspace_fragment>
}`;

const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpL = new THREE.Vector3(), tmpO = new THREE.Vector3();

/** Interpolate along a polyline of world points by fraction f ∈ [0, 1]. */
function alongPath(pts: THREE.Vector3[], lens: number[], total: number, f: number, out: THREE.Vector3) {
  if (pts.length === 1 || total <= 0) return out.copy(pts[0]);
  let d = Math.min(Math.max(f, 0), 1) * total;
  for (let k = 0; k < lens.length; k++) {
    if (d <= lens[k] || k === lens.length - 1) return out.lerpVectors(pts[k], pts[k + 1], lens[k] > 0 ? d / lens[k] : 0);
    d -= lens[k];
  }
  return out.copy(pts[pts.length - 1]);
}

function arcPoint(arc: Float32Array, f: number, out: THREE.Vector3) {
  const x = Math.min(Math.max(f, 0), 1) * (ARC_PTS - 1);
  const k = Math.min(Math.floor(x), ARC_PTS - 2), w = x - k;
  return out.set(
    arc[k * 3] + (arc[k * 3 + 3] - arc[k * 3]) * w,
    arc[k * 3 + 1] + (arc[k * 3 + 4] - arc[k * 3 + 1]) * w,
    arc[k * 3 + 2] + (arc[k * 3 + 5] - arc[k * 3 + 2]) * w,
  );
}

/** Packets (world space). */
export function DataPackets({ res, mode }: { res: PreparedResult; mode: Mode }) {
  const scene = useThree((s) => s.scene);
  const n = Math.min(res.nodes.length, MAX_NODES) * PER_NODE;
  const { geom, mat, pos, col, alpha, size, legGeom } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), alpha = new Float32Array(n), size = new Float32Array(n);
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: pointsVert, fragmentShader: pointsFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uPx: { value: Math.min(window.devicePixelRatio || 1, 2) } },
    });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_NODES * 6), 3));
    return { geom: g, mat: m, pos, col, alpha, size, legGeom: lg };
  }, [n]);
  useEffect(() => () => { geom.dispose(); mat.dispose(); legGeom.dispose(); }, [geom, mat, legGeom]);
  const colors = useMemo(() => ({ up: new THREE.Color(UP), down: new THREE.Color(DOWN), wait: new THREE.Color(WAIT) }), []);
  const path = useMemo(() => Array.from({ length: 5 }, () => new THREE.Vector3()), []);

  useFrame((state) => {
    const vis = dataFlowVisible(mode);
    const earth = scene.getObjectByName("earth-fixed");
    alpha.fill(0);
    const legPos = legGeom.attributes.position as THREE.BufferAttribute;
    let legs = 0;
    if (!vis || !earth) {
      (geom.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
      legGeom.setDrawRange(0, 0);
      return;
    }
    const t = timeStore.getState().t;
    const c = cursorAt(res, t);
    const clock = state.clock.elapsedTime;
    const mw = earth.matrixWorld;
    const p3: [number, number, number] = [0, 0, 0];
    for (let m = 0; m < Math.min(res.nodes.length, MAX_NODES); m++) {
      const r = routeFor(res, m, c.i, t);
      if (!r.endpoint) continue;
      const flow = flowFor(res, m, c.i);
      if (flow.up <= 0 && flow.down <= 0 && flow.waiting <= 0) continue;
      // space path, endpoint → … → node (world)
      latLonToLocal(r.endpoint.lat, r.endpoint.lon, EARTH_R * 1.004, p3);
      const pts: THREE.Vector3[] = [path[0].set(p3[0], p3[1], p3[2]).applyMatrix4(mw)];
      if (r.geo >= 0) {
        const rl = res.raw.relays[r.geo];
        const lon = (rl.lon_deg * Math.PI) / 180;
        ecefToLocal(rl.radius_km * Math.cos(lon), rl.radius_km * Math.sin(lon), 0, p3);
        pts.push(path[1].set(p3[0], p3[1], p3[2]).applyMatrix4(mw));
        // GEO → ground terminal leg (the node → GEO beam is drawn by Links)
        if (legs < MAX_NODES) {
          legPos.setXYZ(legs * 2, pts[0].x, pts[0].y, pts[0].z);
          legPos.setXYZ(legs * 2 + 1, pts[1].x, pts[1].y, pts[1].z);
          legs++;
        }
      }
      if (r.hopNode >= 0) pts.push(path[2].copy(nodePositions[r.hopNode]));
      pts.push(path[3].copy(nodePositions[m]));
      const lens: number[] = [];
      let total = 0;
      for (let k = 0; k < pts.length - 1; k++) { const L = pts[k].distanceTo(pts[k + 1]); lens.push(L); total += L; }
      const cities: City[] = citiesNear(r.endpoint);
      // ring frame around the endpoint for waiting packets
      const e = tmpL.copy(pts[0]).normalize();
      const t1 = tmpA.set(0, 1, 0).cross(e).normalize();
      const t2 = tmpB.copy(e).cross(t1);
      for (let ci = 0; ci < Math.min(cities.length, CITIES); ci++) {
        const city = cities[ci];
        const arcL = arcLocal(city, r.endpoint, EARTH_R);
        const weight = 0.55 + 0.45 * city.w;
        for (let dir = 0; dir < 2; dir++) {
          const level = dir === 0 ? (r.linkType === 0 ? flow.waiting : flow.up) : flow.down;
          for (let k = 0; k < SLOTS; k++) {
            const base = (m * CITIES * SLOTS * 2 + (ci * SLOTS + k) * 2 + dir) * TRAIL;
            if ((k + 0.5) / SLOTS >= level * weight * 1.25) continue;
            const seed = ((m * 7 + ci * 3 + k) * 0.6180339) % 1 + dir * 0.37;
            const head = (clock * SPEED * (0.85 + 0.3 * city.w) + seed) % 1;
            for (let tr = 0; tr < TRAIL; tr++) {
              const idx = base + tr;
              // echoes trail behind the head, staying within the same leg
              const legStart = head < 0.5 ? 0 : 0.5;
              const u = Math.max(legStart, head - tr * 0.012);
              if (tr > 0 && u === legStart && head - tr * 0.012 < legStart) continue;
              const o = tmpO;
              let a = 0;
              let color = dir === 0 ? colors.up : colors.down;
              let sz = 1;
              if (dir === 0) {
                if (u < 0.5) {
                  const f = u / 0.5;
                  arcPoint(arcL, f, o).applyMatrix4(mw);
                  a = 0.35 + 0.65 * Math.sin(Math.PI * f);
                } else if (r.linkType > 0) {
                  const f = (u - 0.5) / 0.5;
                  alongPath(pts, lens, total, f, o);
                  a = 0.35 + 0.65 * Math.sin(Math.PI * f);
                } else {
                  // waiting: queue up in a slowly turning ring around the home station
                  const ang = seed * Math.PI * 2 + clock * 0.6 - tr * 0.12;
                  const rad = 0.09 + 0.05 * ((k + ci) % 3);
                  o.copy(pts[0]).addScaledVector(t1, Math.cos(ang) * rad).addScaledVector(t2, Math.sin(ang) * rad);
                  a = 0.6 + 0.4 * Math.sin(clock * 4 + seed * 6);
                  color = colors.wait;
                  sz = 1.25;
                }
                if (r.linkType === 0 && u < 0.5) color = colors.wait;
              } else {
                if (r.linkType === 0) continue;
                if (u < 0.5) {
                  const f = u / 0.5;
                  alongPath(pts, lens, total, 1 - f, o);
                  a = 0.35 + 0.65 * Math.sin(Math.PI * f);
                } else {
                  const f = (u - 0.5) / 0.5;
                  arcPoint(arcL, 1 - f, o).applyMatrix4(mw);
                  a = 0.35 + 0.65 * Math.sin(Math.PI * f);
                }
              }
              pos[idx * 3] = o.x; pos[idx * 3 + 1] = o.y; pos[idx * 3 + 2] = o.z;
              col[idx * 3] = color.r; col[idx * 3 + 1] = color.g; col[idx * 3 + 2] = color.b;
              alpha[idx] = a * vis * [1, 0.45, 0.2][tr];
              size[idx] = sz * (mode === "network" ? 1.7 : 1.3) * [1, 0.75, 0.55][tr];
            }
          }
        }
      }
    }
    (geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geom.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (geom.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (geom.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    legPos.needsUpdate = true;
    legGeom.setDrawRange(0, legs * 2);
  });

  return (
    <>
      <points geometry={geom} material={mat} frustumCulled={false} renderOrder={6} />
      <lineSegments geometry={legGeom} frustumCulled={false}>
        <lineBasicMaterial color="#a78bfa" transparent opacity={0.35} depthWrite={false} blending={THREE.AdditiveBlending} />
      </lineSegments>
    </>
  );
}
