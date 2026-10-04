"use client";
import { fmtKw, fmtPct } from "@/sim/format";
import type { NodeSample } from "@/sim/sample";

interface Props { s: NodeSample; pMax: number; minSoc: number }

function Flow({ d, p, pMax, color, reverse }: { d: string; p: number; pMax: number; color: string; reverse?: boolean }) {
  const active = p > 0.01;
  const w = active ? 1.5 + 6 * Math.sqrt(Math.min(p / pMax, 1)) : 1;
  const dur = active ? 2.4 / (0.25 + Math.min(p / pMax, 1) * 1.5) : 0;
  return (
    <g>
      <path d={d} className="flow" stroke={active ? color : "rgba(148,163,184,0.15)"} strokeWidth={w} opacity={active ? 0.35 : 1} />
      {active && (
        <path d={d} className="flow flow-dash" stroke={color} strokeWidth={Math.max(1.5, w * 0.5)}
          style={{ animationDuration: `${dur}s`, animationDirection: reverse ? "reverse" : "normal" }} />
      )}
    </g>
  );
}

function Box({ x, y, w = 118, h = 44, label, value, sub, accent }: { x: number; y: number; w?: number; h?: number; label: string; value: string; sub?: string; accent?: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={5} className="box" style={accent ? { stroke: accent } : undefined} />
      <text x={x + 8} y={y + 14} className="lbl">{label}</text>
      <text x={x + 8} y={y + 31} className="val">{value}</text>
      {sub && <text x={x + w - 6} y={y + 14} className="lbl" textAnchor="end">{sub}</text>}
    </g>
  );
}

export default function PowerFlow({ s, pMax, minSoc }: Props) {
  const charging = s.pBatt > 0.01;
  const discharging = s.pBatt < -0.01;
  const platform = s.pPlatform + s.pHeater;
  const socColor = s.soc <= minSoc + 0.01 ? "var(--bad)" : s.soc < 0.4 ? "var(--warn)" : "var(--ok)";
  const busX = 162, busY = 104;
  return (
    <div className="pf" data-testid="power-flow">
      <svg viewBox="0 0 360 252" role="img" aria-label="Power flow diagram">
        <Box x={8} y={14} label="SOLAR ARRAY" value={fmtKw(s.pGen)} sub={s.illum < 0.5 ? "ECLIPSE" : s.illum < 0.999 ? "PENUMBRA" : "SUN"}
          accent={s.illum < 0.5 ? "var(--eclipse)" : undefined} />
        <Box x={8} y={192} label="BATTERY" value={charging ? `+${fmtKw(s.pBatt)}` : discharging ? fmtKw(s.pBatt) : "0 kW"}
          sub={charging ? "CHARGING" : discharging ? "DISCHARGING" : "IDLE"} accent={discharging ? "var(--warn)" : undefined} />
        <rect x={16} y={226} width={102} height={4} rx={2} fill="#1a212c" />
        <rect x={16} y={226} width={102 * s.soc} height={4} rx={2} fill={socColor} />
        <text x={124} y={231} className="lbl" fontSize={9}>{fmtPct(s.soc)}</text>

        <rect x={busX} y={busY} width={40} height={50} rx={4} className="box" style={s.powerLimited ? { stroke: "var(--warn)" } : undefined} />
        <text x={busX + 20} y={busY + 22} className="lbl" textAnchor="middle">POWER</text>
        <text x={busX + 20} y={busY + 34} className="lbl" textAnchor="middle">BUS</text>

        <Box x={236} y={8} label="AI COMPUTE" value={fmtKw(s.pCompute)} sub={s.powerLimited ? "SHED" : undefined}
          accent={s.powerLimited ? "var(--warn)" : undefined} />
        <Box x={236} y={68} label="THERMAL CTRL" value={fmtKw(s.pThermal)} />
        <Box x={236} y={128} label="COMMS" value={fmtKw(s.pComms)} />
        <Box x={236} y={188} label="PLATFORM" value={fmtKw(platform)} sub={s.pHeater > 0.01 ? "HEATER" : undefined} />

        <Flow d={`M126 36 C150 36 150 ${busY + 12} ${busX} ${busY + 12}`} p={s.pGen - s.pCurtailed} pMax={pMax} color="#ffd98a" />
        <Flow d={`M126 214 C150 214 150 ${busY + 38} ${busX} ${busY + 38}`} p={Math.abs(s.pBatt)} pMax={pMax}
          color={charging ? "#3ecf8e" : "#f5a524"} reverse={charging} />
        <Flow d={`M${busX + 40} ${busY + 10} C220 ${busY + 10} 216 30 236 30`} p={s.pCompute} pMax={pMax} color="#4da3ff" />
        <Flow d={`M${busX + 40} ${busY + 20} C220 ${busY + 20} 216 90 236 90`} p={s.pThermal} pMax={pMax} color="#4da3ff" />
        <Flow d={`M${busX + 40} ${busY + 30} C220 ${busY + 30} 216 150 236 150`} p={s.pComms} pMax={pMax} color="#4da3ff" />
        <Flow d={`M${busX + 40} ${busY + 40} C220 ${busY + 40} 216 210 236 210`} p={platform} pMax={pMax} color="#4da3ff" />

        {s.pCurtailed > 0.05 && (
          <text x={8} y={74} className="lbl" fill="var(--muted)">CURTAILED {fmtKw(s.pCurtailed)}</text>
        )}
        {s.pUnmet > 0.001 && (
          <g>
            <rect x={130} y={164} width={104} height={20} rx={3} fill="rgba(239,68,68,0.15)" stroke="var(--bad)" />
            <text x={182} y={178} textAnchor="middle" className="val" fill="var(--bad)" fontSize={11}>UNMET {fmtKw(s.pUnmet)}</text>
          </g>
        )}
      </svg>
    </div>
  );
}
