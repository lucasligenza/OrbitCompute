// Shared per-frame render helpers. Render state only — never React state.
import * as THREE from "three";
import type { PreparedNode, PreparedResult } from "@/sim/result";
import { cursorAt, lerp, positionEci } from "@/sim/sample";
import { eciToRender } from "@/sim/frames";

export const tmp3: [number, number, number] = [0, 0, 0];

export function sunDirAt(res: PreparedResult, t: number, out: THREE.Vector3) {
  const c = cursorAt(res, t);
  eciToRender(lerp(res.sun.x, c), lerp(res.sun.y, c), lerp(res.sun.z, c), tmp3);
  return out.set(tmp3[0], tmp3[1], tmp3[2]).normalize();
}

export function nodePosAt(res: PreparedResult, nd: PreparedNode, t: number, out: THREE.Vector3) {
  const c = cursorAt(res, t);
  positionEci(nd, c, res.dt, tmp3);
  eciToRender(tmp3[0], tmp3[1], tmp3[2], tmp3);
  return out.set(tmp3[0], tmp3[1], tmp3[2]);
}

/** Live node positions (written by spacecraft each frame; read by links, cameras, nadir lines). */
export const nodePositions: THREE.Vector3[] = Array.from({ length: 12 }, () => new THREE.Vector3());
/** Current link target per node in world space (null when no link); used to point comms dishes. */
export const linkTargets: (THREE.Vector3 | null)[] = Array.from({ length: 12 }, () => null);
const linkTargetStore: THREE.Vector3[] = Array.from({ length: 12 }, () => new THREE.Vector3());
export function setLinkTarget(i: number, v: THREE.Vector3 | null) {
  linkTargets[i] = v ? linkTargetStore[i].copy(v) : null;
}

/** Canvas radial-gradient sprite texture (glows, halos, packets). */
const spriteCache = new Map<string, THREE.CanvasTexture>();
export function glowTexture(stops: [number, string][] = [[0, "rgba(255,255,255,1)"], [0.25, "rgba(255,255,255,0.35)"], [1, "rgba(255,255,255,0)"]], size = 128) {
  const key = JSON.stringify(stops) + size;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  spriteCache.set(key, tex);
  return tex;
}
