"use client";
import { useEffect, useRef } from "react";
import { timeStore, useSimTime } from "@/state/time";

export interface ChartSeries {
  data: ArrayLike<number>;
  color: string;
  label: string;
  fill?: boolean;
  dash?: boolean;
  step?: boolean;
  /** per-series sample interval (defaults to chart dt) */
  dt?: number;
}

interface Props {
  series: ChartSeries[];
  dt: number;
  duration: number;
  height?: number;
  yMin?: number;
  yMax?: number;
  unit?: string;
  bands?: [number, number][];
  thresholds?: { y: number; color: string; label: string }[];
  /** override time cursor (comparison view) */
  testId?: string;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

export default function TimeChart({ series, dt, duration, height = 110, yMin, yMax, unit, bands, thresholds, testId }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const t = useSimTime(15);
  const PAD_L = 36, PAD_R = 6, PAD_T = 6, PAD_B = 14;

  // static layer
  useEffect(() => {
    const c = base.current, w = wrap.current;
    if (!c || !w) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = w.clientWidth, H = height;
      c.width = W * dpr; c.height = H * dpr;
      const ctx = c.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      let lo = yMin ?? Infinity, hi = yMax ?? -Infinity;
      if (yMin === undefined || yMax === undefined) {
        for (const s of series) for (let i = 0; i < s.data.length; i++) {
          const v = s.data[i];
          if (yMin === undefined) lo = Math.min(lo, v);
          if (yMax === undefined) hi = Math.max(hi, v);
        }
        for (const th of thresholds ?? []) { if (yMax === undefined) hi = Math.max(hi, th.y); if (yMin === undefined) lo = Math.min(lo, th.y); }
        if (yMin === undefined) lo = lo >= 0 ? 0 : -niceMax(-lo);
        if (yMax === undefined) hi = niceMax(hi * 1.05);
      }
      if (!(hi > lo)) hi = lo + 1;
      const x = (tt: number) => PAD_L + (tt / duration) * (W - PAD_L - PAD_R);
      const y = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);
      // bands
      ctx.fillStyle = "rgba(107,114,255,0.12)";
      for (const [a, b] of bands ?? []) ctx.fillRect(x(a), PAD_T, x(b) - x(a), H - PAD_T - PAD_B);
      // grid + axis labels
      ctx.strokeStyle = "rgba(148,163,184,0.12)";
      ctx.fillStyle = "#5b6573";
      ctx.font = "10px ui-monospace, Consolas, monospace";
      ctx.lineWidth = 1;
      for (let k = 0; k <= 2; k++) {
        const v = lo + ((hi - lo) * k) / 2;
        const yy = Math.round(y(v)) + 0.5;
        ctx.beginPath(); ctx.moveTo(PAD_L, yy); ctx.lineTo(W - PAD_R, yy); ctx.stroke();
        ctx.textAlign = "right";
        ctx.fillText(`${Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(Math.abs(v) < 10 ? 1 : 0)}`, PAD_L - 4, yy + 3);
      }
      if (unit) { ctx.textAlign = "left"; ctx.fillText(unit, 2, PAD_T + 8); }
      ctx.textAlign = "center";
      const hours = duration / 3600;
      const stepH = hours > 24 ? 12 : hours > 8 ? 2 : 1;
      for (let h = 0; h <= hours; h += stepH) ctx.fillText(`${h}h`, x(h * 3600), H - 2);
      // thresholds
      for (const th of thresholds ?? []) {
        ctx.strokeStyle = th.color; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(PAD_L, y(th.y)); ctx.lineTo(W - PAD_R, y(th.y)); ctx.stroke();
        ctx.setLineDash([]);
      }
      // series
      for (const s of series) {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.4;
        ctx.setLineDash(s.dash ? [4, 3] : []);
        ctx.beginPath();
        for (let i = 0; i < s.data.length; i++) {
          const xx = x(i * (s.dt ?? dt)), yy = y(s.data[i]);
          if (i === 0) ctx.moveTo(xx, yy);
          else if (s.step) { ctx.lineTo(xx, y(s.data[i - 1])); ctx.lineTo(xx, yy); }
          else ctx.lineTo(xx, yy);
        }
        ctx.stroke();
        if (s.fill) {
          ctx.lineTo(x((s.data.length - 1) * (s.dt ?? dt)), y(Math.max(lo, 0)));
          ctx.lineTo(x(0), y(Math.max(lo, 0)));
          ctx.closePath();
          ctx.globalAlpha = 0.12; ctx.fillStyle = s.color; ctx.fill(); ctx.globalAlpha = 1;
        }
      }
      ctx.setLineDash([]);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(w);
    return () => ro.disconnect();
  }, [series, dt, duration, height, yMin, yMax, unit, bands, thresholds]);

  // cursor layer
  useEffect(() => {
    const c = over.current, w = wrap.current;
    if (!c || !w) return;
    const dpr = window.devicePixelRatio || 1;
    const W = w.clientWidth, H = height;
    if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const xx = PAD_L + (Math.min(t, duration) / duration) * (W - PAD_L - PAD_R);
    ctx.strokeStyle = "rgba(230,233,238,0.85)";
    ctx.beginPath(); ctx.moveTo(xx + 0.5, PAD_T); ctx.lineTo(xx + 0.5, H - PAD_B); ctx.stroke();
  }, [t, duration, height]);

  const seek = (e: React.PointerEvent) => {
    if (e.type === "pointermove" && !(e.buttons & 1)) return;
    const r = wrap.current!.getBoundingClientRect();
    const f = (e.clientX - r.left - PAD_L) / (r.width - PAD_L - PAD_R);
    timeStore.getState().seek(Math.min(Math.max(f, 0), 1) * duration);
  };

  return (
    <div>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.label}><i style={{ background: s.color }} />{s.label}</span>
        ))}
        {thresholds?.map((th) => (
          <span key={th.label}><i style={{ background: th.color, height: 1 }} />{th.label}</span>
        ))}
      </div>
      <div ref={wrap} className="chart" style={{ height }} onPointerDown={seek} onPointerMove={seek} data-testid={testId}>
        <canvas ref={base} />
        <canvas ref={over} />
      </div>
    </div>
  );
}
