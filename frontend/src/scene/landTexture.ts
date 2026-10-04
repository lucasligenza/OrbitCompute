// Land mask texture from Natural Earth (public domain) via the world-atlas package.
// R channel = land fill, G channel = coastline stroke. Equirectangular, lon -180..180.
import * as THREE from "three";
import { geoEquirectangular, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import land50 from "world-atlas/land-50m.json";

let cached: THREE.CanvasTexture | null = null;

export function landTexture(): THREE.CanvasTexture {
  if (cached) return cached;
  const W = 4096;
  const H = 2048;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  const topo = land50 as unknown as Topology<{ land: GeometryCollection }>;
  const geo = feature(topo, topo.objects.land);
  const proj = geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]).precision(0.1);
  const path = geoPath(proj, ctx);
  ctx.beginPath();
  path(geo);
  ctx.fillStyle = "#ff0000";
  ctx.fill();
  ctx.globalCompositeOperation = "lighter";
  ctx.beginPath();
  path(geo);
  ctx.strokeStyle = "#00ff00";
  ctx.lineWidth = 1.6;
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.wrapS = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  cached = tex;
  return tex;
}
