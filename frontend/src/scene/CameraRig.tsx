"use client";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useUi } from "@/state/ui";
import { nodePositions } from "./shared";

const HOME = new THREE.Vector3(16, 9, 20);
const ORIGIN = new THREE.Vector3();

/**
 * Camera behaviours (render state only):
 * - intro dolly on first load
 * - Follow: the orbit target tracks the selected node, the camera keeps its relative offset
 * - Reset: fly back home (cameraNonce increments)
 */
export default function CameraRig() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const follow = useUi((s) => s.follow);
  const selected = useUi((s) => s.selectedNode);
  const nonce = useUi((s) => s.cameraNonce);
  const flight = useRef<{ from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; k: number; dur: number } | null>(null);
  const lastTarget = useRef(new THREE.Vector3());
  const started = useRef(false);

  // intro dolly
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const from = HOME.clone().multiplyScalar(2.6);
    camera.position.copy(from);
    flight.current = { from, to: HOME.clone(), tFrom: ORIGIN.clone(), tTo: ORIGIN.clone(), k: 0, dur: 2.4 };
  }, [camera]);

  // reset
  useEffect(() => {
    if (nonce === 0) return;
    useUi.getState().set({ follow: false });
    flight.current = { from: camera.position.clone(), to: HOME.clone(), tFrom: controls?.target.clone() ?? ORIGIN.clone(), tTo: ORIGIN.clone(), k: 0, dur: 1.4 };
  }, [nonce, camera, controls]);

  // entering follow: fly close to the node
  useEffect(() => {
    if (!controls) return;
    controls.minDistance = follow ? 0.4 : 8.5;
    if (!follow) return;
    const p = nodePositions[selected];
    const offset = p.clone().normalize().multiplyScalar(1.4).add(new THREE.Vector3(0.6, 0.5, 0.6));
    flight.current = { from: camera.position.clone(), to: p.clone().add(offset), tFrom: controls.target.clone(), tTo: p.clone(), k: 0, dur: 1.3 };
    lastTarget.current.copy(p);
  }, [follow, selected, controls, camera]);

  useFrame((_, delta) => {
    const f = flight.current;
    if (f) {
      f.k = Math.min(1, f.k + delta / f.dur);
      const e = f.k < 0.5 ? 4 * f.k ** 3 : 1 - Math.pow(-2 * f.k + 2, 3) / 2; // easeInOutCubic
      // while following, keep the destination glued to the moving node
      if (follow) {
        const p = nodePositions[selected];
        f.to.add(p.clone().sub(f.tTo));
        f.tTo.copy(p);
      }
      camera.position.lerpVectors(f.from, f.to, e);
      controls?.target.lerpVectors(f.tFrom, f.tTo, e);
      if (f.k >= 1) {
        flight.current = null;
        lastTarget.current.copy(nodePositions[selected]);
      }
      controls?.update();
      return;
    }
    if (follow && controls) {
      const p = nodePositions[selected];
      const d = p.clone().sub(lastTarget.current);
      camera.position.add(d);
      controls.target.add(d);
      lastTarget.current.copy(p);
    }
  });
  return null;
}
