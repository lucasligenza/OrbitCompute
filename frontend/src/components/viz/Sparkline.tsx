"use client";
import { memo, useEffect, useRef } from "react";
import { useSimTime } from "@/state/time";

interface Props { data: ArrayLike<number>; dt: number; duration: number; color: string; height?: number; min?: number; max?: number }

/** Whole-horizon sparkline drawn once; only the cursor layer redraws with time. */
function SparklineImpl({ data, dt, duration, color, height = 26, min, max }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const t = useSimTime(8);
  useEffect(() => {
    const c = base.current, w = wrap.current;
    if (!c || !w) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = w.clientWidth, H = height;
      c.width = W * dpr; c.height = H * dpr;
      const g = c.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      let lo = min ?? Infinity, hi = max ?? -Infinity;
      if (min === undefined || max === undefined) for (let i = 0; i < data.length; i++) { if (min === undefined) lo = Math.min(lo, data[i]); if (max === undefined) hi = Math.max(hi, data[i]); }
      if (!(hi > lo)) hi = lo + 1;
      const x = (i: number) => (i * dt / duration) * W;
      const y = (v: number) => H - 2 - ((v - lo) / (hi - lo)) * (H - 4);
      const grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, color + "55");
      grad.addColorStop(1, color + "00");
      g.beginPath();
      for (let i = 0; i < data.length; i++) (i ? g.lineTo : g.moveTo).call(g, x(i), y(data[i]));
      g.lineTo(x(data.length - 1), H); g.lineTo(0, H); g.closePath();
      g.fillStyle = grad; g.fill();
      g.beginPath();
      for (let i = 0; i < data.length; i++) (i ? g.lineTo : g.moveTo).call(g, x(i), y(data[i]));
      g.strokeStyle = color; g.lineWidth = 1.2; g.stroke();
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(w);
    return () => ro.disconnect();
  }, [data, dt, duration, color, height, min, max]);
  useEffect(() => {
    const c = over.current, w = wrap.current;
    if (!c || !w) return;
    const dpr = window.devicePixelRatio || 1;
    const W = w.clientWidth, H = height;
    if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const xx = (Math.min(t, duration) / duration) * W;
    g.fillStyle = "rgba(230,233,238,0.9)";
    g.fillRect(xx, 0, 1, H);
  }, [t, duration, height]);
  return (
    <div ref={wrap} className="spark" style={{ height }}>
      <canvas ref={base} />
      <canvas ref={over} />
    </div>
  );
}

const Sparkline = memo(SparklineImpl);
export default Sparkline;
