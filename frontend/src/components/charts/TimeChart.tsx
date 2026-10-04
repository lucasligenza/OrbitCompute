"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { timeStore, useSimTime } from "@/state/time";
import { fmtMet } from "@/sim/format";

export interface ChartSeries {
  data: ArrayLike<number>;
  color: string; // #rrggbb
  label: string;
  fill?: boolean;
  dash?: boolean;
  step?: boolean;
  /** stack this series on top of previous stacked series (filled area) */
  stack?: boolean;
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
  testId?: string;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

const PAD_L = 36, PAD_R = 8, PAD_T = 6, PAD_B = 14;

function fmtV(v: number) {
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
}

export default function TimeChart({ series, dt, duration, height = 110, yMin, yMax, unit, bands, thresholds, testId }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const t = useSimTime(15);
  const [hover, setHover] = useState<{ x: number; t: number; w: number } | null>(null);

  // Stacked cumulative arrays (computed once per series set)
  const drawn = useMemo(() => {
    const out: { s: ChartSeries; top: ArrayLike<number>; bottom: Float64Array | null }[] = [];
    let prevTop: Float64Array | null = null;
    for (const s of series) {
      if (!s.stack) { out.push({ s, top: s.data, bottom: null }); continue; }
      const n = s.data.length;
      const bottom: Float64Array = prevTop ?? new Float64Array(n);
      const top = new Float64Array(n);
      for (let i = 0; i < n; i++) top[i] = bottom[i] + s.data[i];
      prevTop = top;
      out.push({ s, top, bottom });
    }
    return out;
  }, [series]);

  const range = useMemo(() => {
    let lo = yMin ?? Infinity, hi = yMax ?? -Infinity;
    if (yMin === undefined || yMax === undefined) {
      for (const d of drawn) for (let i = 0; i < d.top.length; i++) {
        const v = d.top[i];
        if (yMin === undefined) lo = Math.min(lo, v);
        if (yMax === undefined) hi = Math.max(hi, v);
      }
      for (const th of thresholds ?? []) { if (yMax === undefined) hi = Math.max(hi, th.y); if (yMin === undefined) lo = Math.min(lo, th.y); }
      if (yMin === undefined) lo = lo >= 0 ? 0 : -niceMax(-lo);
      if (yMax === undefined) hi = niceMax(hi * 1.05);
    }
    if (!(hi > lo)) hi = lo + 1;
    return { lo, hi };
  }, [drawn, yMin, yMax, thresholds]);

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
      const { lo, hi } = range;
      const x = (tt: number) => PAD_L + (tt / duration) * (W - PAD_L - PAD_R);
      const y = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);
      // hatched eclipse bands
      const hatch = document.createElement("canvas");
      hatch.width = hatch.height = 6;
      const hc = hatch.getContext("2d")!;
      hc.strokeStyle = "rgba(107,114,255,0.28)"; hc.lineWidth = 1;
      hc.beginPath(); hc.moveTo(0, 6); hc.lineTo(6, 0); hc.stroke();
      const pat = ctx.createPattern(hatch, "repeat")!;
      (bands ?? []).forEach(([a, b], i) => {
        ctx.fillStyle = "rgba(107,114,255,0.07)";
        ctx.fillRect(x(a), PAD_T, x(b) - x(a), H - PAD_T - PAD_B);
        ctx.fillStyle = pat;
        ctx.fillRect(x(a), PAD_T, x(b) - x(a), H - PAD_T - PAD_B);
        if (i === 0 && x(b) - x(a) > 34) {
          ctx.fillStyle = "rgba(160,166,255,0.8)";
          ctx.font = "9px ui-sans-serif, system-ui";
          ctx.textAlign = "left";
          ctx.fillText("eclipse", x(a) + 3, PAD_T + 9);
        }
      });
      // grid + axis labels
      ctx.strokeStyle = "rgba(148,163,184,0.1)";
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
      for (const th of thresholds ?? []) {
        ctx.strokeStyle = th.color; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(PAD_L, y(th.y)); ctx.lineTo(W - PAD_R, y(th.y)); ctx.stroke();
        ctx.setLineDash([]);
      }
      const trace = (arr: ArrayLike<number>, sdt: number, step: boolean | undefined, move = true) => {
        for (let i = 0; i < arr.length; i++) {
          const xx = x(i * sdt), yy = y(arr[i]);
          if (i === 0) { if (move) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy); }
          else if (step) { ctx.lineTo(xx, y(arr[i - 1])); ctx.lineTo(xx, yy); }
          else ctx.lineTo(xx, yy);
        }
      };
      for (const d of drawn) {
        const s = d.s;
        const sdt = s.dt ?? dt;
        // filled areas (stacked or plain fill) with vertical gradient
        if (s.stack || s.fill) {
          ctx.beginPath();
          trace(d.top, sdt, s.step);
          if (d.bottom) {
            for (let i = d.bottom.length - 1; i >= 0; i--) ctx.lineTo(x(i * sdt), y(d.bottom[i]));
          } else {
            ctx.lineTo(x((s.data.length - 1) * sdt), y(Math.max(lo, 0)));
            ctx.lineTo(x(0), y(Math.max(lo, 0)));
          }
          ctx.closePath();
          const grad = ctx.createLinearGradient(0, PAD_T, 0, H - PAD_B);
          grad.addColorStop(0, s.color + (s.stack ? "70" : "40"));
          grad.addColorStop(1, s.color + (s.stack ? "30" : "02"));
          ctx.fillStyle = grad;
          ctx.fill();
        }
        // line with soft glow
        ctx.beginPath();
        trace(d.top, sdt, s.step);
        ctx.setLineDash(s.dash ? [4, 3] : []);
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.stack ? 1 : 1.5;
        ctx.shadowColor = s.color;
        ctx.shadowBlur = s.stack ? 0 : 6;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      ctx.setLineDash([]);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(w);
    return () => ro.disconnect();
  }, [drawn, range, dt, duration, height, unit, bands, thresholds]);

  // cursor + current values layer
  useEffect(() => {
    const c = over.current, w = wrap.current;
    if (!c || !w) return;
    const dpr = window.devicePixelRatio || 1;
    const W = w.clientWidth, H = height;
    if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const { lo, hi } = range;
    const x = (tt: number) => PAD_L + (Math.min(tt, duration) / duration) * (W - PAD_L - PAD_R);
    const y = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);
    const xx = x(t);
    ctx.strokeStyle = "rgba(230,233,238,0.85)";
    ctx.beginPath(); ctx.moveTo(xx + 0.5, PAD_T); ctx.lineTo(xx + 0.5, H - PAD_B); ctx.stroke();
    for (const d of drawn) {
      const sdt = d.s.dt ?? dt;
      const i = Math.min(Math.floor(t / sdt), d.top.length - 1);
      if (i < 0) continue;
      ctx.beginPath();
      ctx.arc(xx, y(d.top[i]), 2.6, 0, Math.PI * 2);
      ctx.fillStyle = d.s.color;
      ctx.shadowColor = d.s.color; ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    if (hover) {
      ctx.strokeStyle = "rgba(230,233,238,0.35)";
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(hover.x + 0.5, PAD_T); ctx.lineTo(hover.x + 0.5, H - PAD_B); ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [t, duration, height, drawn, range, dt, hover]);

  const tToX = (clientX: number) => {
    const r = wrap.current!.getBoundingClientRect();
    const f = (clientX - r.left - PAD_L) / (r.width - PAD_L - PAD_R);
    return { f: Math.min(Math.max(f, 0), 1), x: clientX - r.left };
  };
  const onDown = (e: React.PointerEvent) => timeStore.getState().seek(tToX(e.clientX).f * duration);
  const onMove = (e: React.PointerEvent) => {
    const { f, x } = tToX(e.clientX);
    setHover({ x, t: f * duration, w: wrap.current!.clientWidth });
    if (e.buttons & 1) timeStore.getState().seek(f * duration);
  };
  const tip = hover && (() => {
    const rows = series.map((s) => {
      const sdt = s.dt ?? dt;
      const i = Math.min(Math.max(Math.floor(hover.t / sdt), 0), s.data.length - 1);
      return { label: s.label, color: s.color, v: s.data[i] };
    });
    return { rows, left: hover.x > hover.w - 150 ? hover.x - 146 : hover.x + 10 };
  })();

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
      <div ref={wrap} className="chart" style={{ height }} onPointerDown={onDown} onPointerMove={onMove} onPointerLeave={() => setHover(null)} data-testid={testId}>
        <canvas ref={base} />
        <canvas ref={over} />
        {tip && (
          <div className="chart-tip" style={{ left: tip.left }}>
            <div className="mono muted">{fmtMet(hover!.t)}</div>
            {tip.rows.map((r) => (
              <div key={r.label} className="tip-row"><i style={{ background: r.color }} />{r.label}<b className="mono">{fmtV(r.v)}{unit ? ` ${unit}` : ""}</b></div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
