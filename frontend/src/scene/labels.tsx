"use client";
// Lightweight screen-space labels. 3D components write positions into a registry every frame; a
// single projector (inside the Canvas) moves the DOM elements. Labels behind Earth are hidden.
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EARTH_R } from "@/sim/frames";

export interface LabelEntry {
  world: THREE.Vector3;
  /** if set, position is Earth-fixed (local to the GMST-rotated group) */
  local: THREE.Vector3 | null;
  el: HTMLElement | null;
}

export const labelRegistry = new Map<string, LabelEntry>();

export function labelEntry(id: string): LabelEntry {
  let e = labelRegistry.get(id);
  if (!e) {
    e = { world: new THREE.Vector3(), local: null, el: null };
    labelRegistry.set(id, e);
  }
  return e;
}

/** Ref callback for a label element. */
export function bindLabel(id: string, local?: [number, number, number]) {
  return (el: HTMLElement | null) => {
    // React passes null on every re-render (ref callbacks are recreated); keep the last element so
    // labels don't flicker. A detached element is harmless to style.
    if (!el) return;
    const e = labelEntry(id);
    if (e.el !== el) el.style.visibility = "hidden"; // until first projection
    e.el = el;
    if (local) e.local = new THREE.Vector3(...local);
  };
}

const v = new THREE.Vector3();
const toPoint = new THREE.Vector3();

function occludedByEarth(cam: THREE.Vector3, p: THREE.Vector3): boolean {
  // Does the segment camera -> p pass through the Earth sphere before reaching p?
  toPoint.subVectors(p, cam);
  const len = toPoint.length();
  toPoint.divideScalar(len);
  const b = cam.dot(toPoint);
  const c = cam.lengthSq() - (EARTH_R * 0.995) ** 2;
  const disc = b * b - c;
  if (disc < 0) return false;
  const tHit = -b - Math.sqrt(disc);
  return tHit > 0 && tHit < len - 0.05;
}

export function LabelProjector() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const scene = useThree((s) => s.scene);
  useFrame(() => {
    const earth = scene.getObjectByName("earth-fixed");
    for (const e of labelRegistry.values()) {
      if (!e.el) continue;
      if (e.local && earth) e.world.copy(e.local).applyMatrix4(earth.matrixWorld);
      v.copy(e.world).project(camera);
      const hidden = v.z > 1 || v.z < -1 || occludedByEarth(camera.position, e.world);
      if (hidden) {
        e.el.style.visibility = "hidden";
        continue;
      }
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      e.el.style.visibility = "visible";
      e.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  });
  return null;
}
