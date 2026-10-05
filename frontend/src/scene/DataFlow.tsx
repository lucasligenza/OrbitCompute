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
import { useUi, type Mode } from "@/state/ui";
import { ARC_PTS, arcLocal, citiesNear, flowFor, routeFor, type City, type Endpoint } from "./userRoutes";
import { nodePositions } from "./shared";

const UP = "#5ec8ff", DOWN = "#3ecf8e", WAIT = "#f5a524";
const CITIES = 6, MAX_NODES = 12;

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
attribute vec3 aColor; attribute float aAlpha; attribute float aSize; attribute float aShape;
uniform float uPx;
varying vec3 vC; varying float vA; varying float vShape;
void main() {
  vC = aColor; vA = aAlpha; vShape = aShape;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float px = aShape > 0.5 ? aSize * 72.0 / -mv.z : aSize * 40.0 / -mv.z;
  // keep journeys readable when zoomed out (minimum on-screen size), cap when very close
  gl_PointSize = clamp(px, aShape > 0.5 ? 6.0 : 3.2, aShape > 0.5 ? 70.0 : 22.0) * uPx;
  gl_Position = projectionMatrix * mv;
}`;
const pointsFrag = /* glsl */ `
varying vec3 vC; varying float vA; varying float vShape;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a;
  vec3 c = vC;
  if (vShape > 0.5) {
    // ring: departure / hand-off / arrival pulses
    a = smoothstep(0.30, 0.40, r) * (1.0 - smoothstep(0.42, 0.5, r)) * vA;
  } else {
    float core = smoothstep(0.5, 0.0, r);
    a = pow(core, 1.6) * vA;
    c = vC * (1.0 + 1.6 * smoothstep(0.22, 0.0, r)); // hot core
  }
  if (a < 0.01) discard;
  gl_FragColor = vec4(c * a, a);
  #include <colorspace_fragment>
}`;

const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpL = new THREE.Vector3(), tmpO = new THREE.Vector3();
const tmpC = new THREE.Color();

/** Interpolate along a polyline of world points by fraction f in [0, 1]. */
function alongPath(pts: THREE.Vector3[], lens: number[], total: number, f: number, out: THREE.Vector3) {
  if (pts.length === 1 || total <= 0) return out.copy(pts[0]);
  let d = Math.min(Math.max(f, 0), 1) * total;
  for (let k = 0; k < lens.length; k++) {
    if (d <= lens[k] || k === lens.length - 1) return out.lerpVectors(pts[k], pts[k + 1], lens[k] > 0 ? Math.min(d / lens[k], 1) : 0);
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

function arcLength(arc: Float32Array) {
  let L = 0;
  for (let k = 0; k < ARC_PTS - 1; k++) {
    L += Math.hypot(arc[k * 3 + 3] - arc[k * 3], arc[k * 3 + 4] - arc[k * 3 + 1], arc[k * 3 + 5] - arc[k * 3 + 2]);
  }
  return L;
}

/** Gentle ease so packets slow down at each hand-off (station, relay, spacecraft). */
const ease = (f: number) => { const x = Math.min(Math.max(f, 0), 1); return x * x * (3 - 2 * x) * 0.7 + x * 0.3; };

// Journey phases of one round trip
const UP_ARC = 0, UP_SPACE = 1, DWELL = 2, DOWN_SPACE = 3, DOWN_ARC = 4, LANDED = 5, IDLE = 6, QUEUED = 7;
const MOVING = new Set([UP_ARC, UP_SPACE, DOWN_SPACE, DOWN_ARC]);
const QUEUE_S = 4.0;

interface Journey { dArc: number; dSpace: number; dwell: number; landed: number; gap: number; linked: boolean }
function cycleLength(j: Journey) {
  return j.linked ? 2 * j.dArc + 2 * j.dSpace + j.dwell + j.landed + j.gap : j.dArc + QUEUE_S;
}
/** Phase and progress for time tau within one cycle. */
function phaseAt(j: Journey, tau: number): { ph: number; f: number } {
  let t = tau;
  if (!j.linked) {
    if (t < j.dArc) return { ph: UP_ARC, f: t / j.dArc };
    return { ph: QUEUED, f: (t - j.dArc) / QUEUE_S };
  }
  const legs: [number, number][] = [[UP_ARC, j.dArc], [UP_SPACE, j.dSpace], [DWELL, j.dwell], [DOWN_SPACE, j.dSpace], [DOWN_ARC, j.dArc], [LANDED, j.landed]];
  for (const [ph, d] of legs) {
    if (t < d) return { ph, f: t / d };
    t -= d;
  }
  return { ph: IDLE, f: 0 };
}

const LANES = 5; // concurrent round trips per city (how many run scales with simulated load)
const TRAIL_N = 9; // head + trail samples
const TRAIL_DT = 0.045; // seconds between trail samples
const FX = 3; // effect rings per lane: departure, hand-off, arrival
const PER_LANE = TRAIL_N + FX;
const PER_NODE_J = CITIES * LANES * PER_LANE;

/** Round-trip packets (world space): city, endpoint, (relay / neighbour), spacecraft, and back. */
export function DataPackets({ res, mode }: { res: PreparedResult; mode: Mode }) {
  const scene = useThree((s) => s.scene);
  // Low quality: fewer concurrent trips and a short trail (software rendering / modest GPUs)
  const low = useUi((s) => s.quality) !== "high";
  const lanes = low ? 2 : LANES;
  const trailN = low ? 3 : TRAIL_N;
  const n = Math.min(res.nodes.length, MAX_NODES) * PER_NODE_J;
  const { geom, mat, pos, col, alpha, size, shape, legGeom } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), alpha = new Float32Array(n), size = new Float32Array(n), shape = new Float32Array(n);
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aShape", new THREE.BufferAttribute(shape, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: pointsVert, fragmentShader: pointsFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uPx: { value: Math.min(window.devicePixelRatio || 1, 2) } },
    });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_NODES * 6), 3));
    return { geom: g, mat: m, pos, col, alpha, size, shape, legGeom: lg };
  }, [n]);
  useEffect(() => () => { geom.dispose(); mat.dispose(); legGeom.dispose(); }, [geom, mat, legGeom]);
  const colors = useMemo(() => ({ up: new THREE.Color(UP), down: new THREE.Color(DOWN), wait: new THREE.Color(WAIT), white: new THREE.Color("#ffffff") }), []);
  const path = useMemo(() => Array.from({ length: 5 }, () => new THREE.Vector3()), []);

  useFrame((state) => {
    const vis = dataFlowVisible(mode);
    const earth = scene.getObjectByName("earth-fixed");
    alpha.fill(0);
    const legPos = legGeom.attributes.position as THREE.BufferAttribute;
    let legs = 0;
    const flush = () => {
      for (const k of ["position", "aColor", "aAlpha", "aSize", "aShape"]) (geom.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
      legPos.needsUpdate = true;
      legGeom.setDrawRange(0, legs * 2);
    };
    if (!vis || !earth) { flush(); return; }
    const t = timeStore.getState().t;
    const c = cursorAt(res, t);
    const clock = state.clock.elapsedTime;
    const mw = earth.matrixWorld;
    const p3: [number, number, number] = [0, 0, 0];
    const big = mode === "network" ? 1 : 0.8;

    for (let m = 0; m < Math.min(res.nodes.length, MAX_NODES); m++) {
      const r = routeFor(res, m, c.i, t);
      if (!r.endpoint) continue;
      const flow = flowFor(res, m, c.i);
      const linked = r.linkType > 0;
      const level = linked ? Math.max(flow.up, flow.down) : flow.waiting;
      if (level <= 0) continue;
      // space path endpoint ... node (world)
      latLonToLocal(r.endpoint.lat, r.endpoint.lon, EARTH_R * 1.004, p3);
      const pts: THREE.Vector3[] = [path[0].set(p3[0], p3[1], p3[2]).applyMatrix4(mw)];
      if (r.geo >= 0) {
        const rl = res.raw.relays[r.geo];
        const lon = (rl.lon_deg * Math.PI) / 180;
        ecefToLocal(rl.radius_km * Math.cos(lon), rl.radius_km * Math.sin(lon), 0, p3);
        pts.push(path[1].set(p3[0], p3[1], p3[2]).applyMatrix4(mw));
        if (legs < MAX_NODES) {
          legPos.setXYZ(legs * 2, pts[0].x, pts[0].y, pts[0].z);
          legPos.setXYZ(legs * 2 + 1, pts[1].x, pts[1].y, pts[1].z);
          legs++;
        }
      }
      if (r.hopNode >= 0) pts.push(path[2].copy(nodePositions[r.hopNode]));
      const nodeP = path[3].copy(nodePositions[m]);
      pts.push(nodeP);
      const lens: number[] = [];
      let total = 0;
      for (let k = 0; k < pts.length - 1; k++) { const L = pts[k].distanceTo(pts[k + 1]); lens.push(L); total += L; }
      const endpointW = pts[0];
      // frames for rings around the endpoint (waiting queue) and the node (processing orbit)
      const e = tmpL.copy(endpointW).normalize();
      const t1 = tmpA.set(0, 1, 0).cross(e).normalize();
      const t2 = tmpB.copy(e).cross(t1);
      const cities: City[] = citiesNear(r.endpoint);
      // leg durations proportional to length, clamped so the GEO climb doesn't drag
      const dSpace = Math.min(2.8, Math.max(0.9, total / 1.6));

      for (let ci = 0; ci < Math.min(cities.length, CITIES); ci++) {
        const city = cities[ci];
        const arcL = arcLocal(city, r.endpoint, EARTH_R);
        const dArc = Math.min(2.4, Math.max(1.0, arcLength(arcL) / 1.1));
        const weight = 0.55 + 0.45 * city.w;
        latLonToLocal(city.lat, city.lon, EARTH_R * 1.004, p3);
        const cityW = new THREE.Vector3(p3[0], p3[1], p3[2]).applyMatrix4(mw);
        for (let k = 0; k < lanes; k++) {
          const base = ((m * CITIES + ci) * LANES + k) * PER_LANE;
          if ((k + 0.5) / lanes >= level * weight * 1.25) continue;
          const seed = ((m * 7.13 + ci * 3.71 + k * 0.6180339) % 1 + 1) % 1;
          const journey: Journey = { dArc, dSpace, dwell: 0.75, landed: 0.7, gap: 0.2 + 0.8 * seed, linked };
          const cyc = cycleLength(journey);
          const tauHead = ((clock + seed * cyc * 3.1) % cyc + cyc) % cyc;

          // position + colour of the packet at journey time tau
          const place = (tau: number, out: THREE.Vector3, color: THREE.Color): number => {
            const { ph, f } = phaseAt(journey, tau);
            switch (ph) {
              case UP_ARC: arcPoint(arcL, ease(f), out).applyMatrix4(mw); color.copy(linked ? colors.up : colors.wait); break;
              case UP_SPACE: alongPath(pts, lens, total, ease(f), out); color.copy(colors.up); break;
              case DWELL: {
                // processing: a tight orbit around the spacecraft while the colour turns from request to result
                const ang = f * Math.PI * 4 + seed * 6;
                out.copy(nodeP).addScaledVector(t1, Math.cos(ang) * 0.07).addScaledVector(t2, Math.sin(ang) * 0.07);
                color.copy(colors.up).lerp(colors.down, f);
                break;
              }
              case DOWN_SPACE: alongPath(pts, lens, total, 1 - ease(f), out); color.copy(colors.down); break;
              case DOWN_ARC: arcPoint(arcL, 1 - ease(f), out).applyMatrix4(mw); color.copy(colors.down); break;
              case QUEUED: {
                const ang = seed * Math.PI * 2 + clock * 0.6;
                const rad = 0.09 + 0.05 * ((k + ci) % 3);
                out.copy(endpointW).addScaledVector(t1, Math.cos(ang) * rad).addScaledVector(t2, Math.sin(ang) * rad);
                color.copy(colors.wait);
                break;
              }
              default: break;
            }
            return ph;
          };

          // head + streak trail along the exact route (bends at the station / relay)
          for (let j = 0; j < trailN; j++) {
            const tau = tauHead - j * TRAIL_DT;
            if (tau < 0) break;
            const idx = base + j;
            const ph = place(tau, tmpO, tmpC);
            if (ph === LANDED || ph === IDLE) continue;
            if (j > 0 && !MOVING.has(ph)) continue; // no smear while dwelling or queued
            const fall = Math.pow(1 - j / trailN, 1.7);
            pos[idx * 3] = tmpO.x; pos[idx * 3 + 1] = tmpO.y; pos[idx * 3 + 2] = tmpO.z;
            col[idx * 3] = tmpC.r; col[idx * 3 + 1] = tmpC.g; col[idx * 3 + 2] = tmpC.b;
            const pulse = ph === QUEUED ? 0.65 + 0.35 * Math.sin(clock * 4 + seed * 6) : 1;
            alpha[idx] = vis * fall * pulse;
            size[idx] = big * (j === 0 ? (ph === DWELL ? 2.3 : 2.2) : 1.8 * (1 - j / (trailN + 3)));
            shape[idx] = 0;
          }

          // effect rings: departure at the city, hand-off at the station, arrival at the node / city
          const { ph, f } = phaseAt(journey, tauHead);
          const ring = (slot: number, at: THREE.Vector3, color: THREE.Color, prog: number, scale: number) => {
            const idx = base + TRAIL_N + slot;
            const g = Math.min(Math.max(prog, 0), 1);
            pos[idx * 3] = at.x; pos[idx * 3 + 1] = at.y; pos[idx * 3 + 2] = at.z;
            col[idx * 3] = color.r; col[idx * 3 + 1] = color.g; col[idx * 3 + 2] = color.b;
            alpha[idx] = vis * (1 - g) * 0.9;
            size[idx] = big * scale * (0.4 + 1.6 * g);
            shape[idx] = 1;
          };
          if (ph === UP_ARC && f < 0.35) ring(0, cityW, linked ? colors.up : colors.wait, f / 0.35, 0.9);
          if ((ph === UP_SPACE || ph === DOWN_ARC) && f < 0.3) ring(1, endpointW, ph === UP_SPACE ? colors.up : colors.down, f / 0.3, 1.1);
          if (ph === QUEUED && f < 0.12) ring(1, endpointW, colors.wait, f / 0.12, 1.1);
          if (ph === DWELL && f < 0.5) ring(2, nodeP, colors.white, f / 0.5, 1.5);
          if (ph === LANDED) ring(2, cityW, colors.down, f, 1.2);
        }
      }
    }
    flush();
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
