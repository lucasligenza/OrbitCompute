// Land mask texture from Natural Earth (public domain) via the world-atlas package.
// R = land fill, G = coastline stroke, B = blurred land mask (continental-shelf tint / coastal depth).
// Equirectangular, lon −180..180.
import * as THREE from "three";
import { geoEquirectangular, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import land50 from "world-atlas/land-50m.json";

let cached: THREE.CanvasTexture | null = null;
let landCanvas: HTMLCanvasElement | null = null;

function drawLand(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const topo = land50 as unknown as Topology<{ land: GeometryCollection }>;
  const geo = feature(topo, topo.objects.land);
  const proj = geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]).precision(0.1);
  const path = geoPath(proj, ctx);
  return () => { ctx.beginPath(); path(geo); };
}

/** Plain land/ocean canvas (for 2D mini-maps). */
export function landMapCanvas(): HTMLCanvasElement {
  if (landCanvas) return landCanvas;
  const W = 1024, H = 512;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#08121f";
  ctx.fillRect(0, 0, W, H);
  const trace = drawLand(ctx, W, H);
  trace();
  ctx.fillStyle = "#1c2733";
  ctx.fill();
  ctx.strokeStyle = "#2f3e4f";
  ctx.lineWidth = 0.7;
  ctx.stroke();
  landCanvas = c;
  return c;
}

export function landTexture(): THREE.CanvasTexture {
  if (cached) return cached;
  const W = 4096;
  const H = 2048;
  // Fill + coastline
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  const trace = drawLand(ctx, W, H);
  trace();
  ctx.fillStyle = "#ff0000";
  ctx.fill();
  ctx.globalCompositeOperation = "lighter";
  trace();
  ctx.strokeStyle = "#00ff00";
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.globalCompositeOperation = "source-over";
  // Blurred mask at quarter resolution, upscaled into the blue channel
  const bw = W / 4, bh = H / 4;
  const blur = document.createElement("canvas");
  blur.width = bw; blur.height = bh;
  const bctx = blur.getContext("2d", { willReadFrequently: true })!;
  bctx.fillStyle = "#000";
  bctx.fillRect(0, 0, bw, bh);
  bctx.filter = "blur(6px)";
  bctx.drawImage(canvas, 0, 0, bw, bh);
  const big = document.createElement("canvas");
  big.width = W; big.height = H;
  const gctx = big.getContext("2d", { willReadFrequently: true })!;
  gctx.imageSmoothingEnabled = true;
  gctx.drawImage(blur, 0, 0, W, H);
  const main = ctx.getImageData(0, 0, W, H);
  const b = gctx.getImageData(0, 0, W, H).data;
  const d = main.data;
  for (let i = 0; i < d.length; i += 4) d[i + 2] = b[i]; // red of the blurred image -> blue channel
  ctx.putImageData(main, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  cached = tex;
  return tex;
}
