"use client";
// Sankey-style power flow: ribbon width ∝ kW, animated dots along each ribbon (faster = more power).
import { Icon, type IconName } from "@/components/viz/Icon";
import { fmtKw, fmtPct } from "@/sim/format";
import type { NodeSample } from "@/sim/sample";

interface Props { s: NodeSample; pMax: number; minSoc: number }

const W = 360, H = 240;
const SRC_X = 6, SRC_W = 112, BUS_X = 156, BUS_W = 12, SNK_X = 236, SNK_W = 118;
const MAXW = 30;

const C = { solar: "#ffd98a", battery: "#f5a524", charge: "#3ecf8e", load: "#4da3ff", curtail: "#5b6573" };

function width(p: number, pMax: number) {
  if (p <= 0.01) return 0;
  return Math.max(1.4, (MAXW * p) / pMax);
}

function band(x0: number, y0: number, w0: number, x1: number, y1: number, w1: number) {
  const xm = (x0 + x1) / 2;
  return `M${x0} ${y0 - w0 / 2} C${xm} ${y0 - w0 / 2} ${xm} ${y1 - w1 / 2} ${x1} ${y1 - w1 / 2} L${x1} ${y1 + w1 / 2} C${xm} ${y1 + w1 / 2} ${xm} ${y0 + w0 / 2} ${x0} ${y0 + w0 / 2} Z`;
}
function center(x0: number, y0: number, x1: number, y1: number) {
  const xm = (x0 + x1) / 2;
  return `M${x0} ${y0} C${xm} ${y0} ${xm} ${y1} ${x1} ${y1}`;
}

function Ribbon({ id, d, c, w, from, to, p, pMax, reverse }: { id: string; d: string; c: string; w: number; from: string; to: string; p: number; pMax: number; reverse?: boolean }) {
  if (w <= 0) return null;
  const speed = 2.6 / (0.3 + Math.min(p / pMax, 1) * 1.6);
  return (
    <g>
      <defs>
        <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={from} stopOpacity="0.55" />
          <stop offset="1" stopColor={to} stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <path d={d} fill={`url(#${id})`} />
      <path d={c} className="flow flow-dash" stroke="#ffffff" strokeOpacity={0.7} strokeWidth={Math.min(2.2, 0.8 + w / 12)}
        style={{ animationDuration: `${speed}s`, animationDirection: reverse ? "reverse" : "normal" }} />
    </g>
  );
}

function Card({ x, y, w, h, icon, label, value, color, sub, subTop, children }: { x: number; y: number; w: number; h: number; icon: IconName; label: string; value: string; color: string; sub?: string; subTop?: boolean; children?: React.ReactNode }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={7} className="pf-card" />
      <rect x={x} y={y + 6} width={2.5} height={h - 12} rx={1} fill={color} />
      <Icon name={icon} x={x + 9} y={y + 7} size={13} color={color} />
      <text x={x + 26} y={y + 17} className="lbl">{label}</text>
      {sub && <text x={x + w - 7} y={y + (subTop ? 17 : 35)} className="lbl" textAnchor="end" fill={color}>{sub}</text>}
      <text x={x + 10} y={y + 35} className="val">{value}</text>
      {children}
    </g>
  );
}

export default function PowerFlow({ s, pMax, minSoc }: Props) {
  const charging = s.pBatt > 0.01;
  const discharging = s.pBatt < -0.01;
  const solarUsed = Math.max(0, s.pGen - s.pCurtailed);
  const platform = s.pPlatform + s.pHeater;
  const loads = [
    { key: "compute", label: "AI COMPUTE", icon: "chip" as IconName, p: s.pCompute, sub: s.powerLimited ? "SHED" : undefined },
    { key: "thermal", label: "THERMAL CTRL", icon: "radiator" as IconName, p: s.pThermal },
    { key: "comms", label: "COMMS", icon: "antenna" as IconName, p: s.pComms },
    { key: "platform", label: "PLATFORM", icon: "satellite" as IconName, p: platform, sub: s.pHeater > 0.01 ? "HEATER" : undefined },
  ];
  // Bus left side: inflows then charge outflow; right side: loads.
  const wSolar = width(solarUsed, pMax), wDis = width(discharging ? -s.pBatt : 0, pMax), wChg = width(charging ? s.pBatt : 0, pMax);
  const leftTotal = wSolar + wDis + wChg;
  const rightW = loads.map((l) => width(l.p, pMax));
  const rightTotal = rightW.reduce((a, b) => a + b, 0) + 3 * 3;
  const busMid = 124;
  const busH = Math.max(leftTotal, rightTotal, 40) + 14;
  const busTop = busMid - busH / 2;
  let ly = busMid - leftTotal / 2;
  const segSolar = ly + wSolar / 2; ly += wSolar;
  const segDis = ly + wDis / 2; ly += wDis;
  const segChg = ly + wChg / 2;
  let ry = busMid - rightTotal / 2;
  const segs = rightW.map((w) => { const c = ry + w / 2; ry += w + 3; return c; });
  const sinkY = [10, 66, 122, 178];
  const socColor = s.soc <= minSoc + 0.01 ? "var(--bad)" : s.soc < 0.4 ? "var(--warn)" : "var(--ok)";
  const solarY = 30, battY = 182;

  return (
    <div className="pf" data-testid="power-flow">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Power flow diagram (ribbon width proportional to power)">
        {/* ribbons */}
        <Ribbon id="rb-solar" d={band(SRC_X + SRC_W, solarY + 20, wSolar, BUS_X, segSolar, wSolar)} c={center(SRC_X + SRC_W, solarY + 20, BUS_X, segSolar)}
          w={wSolar} from={C.solar} to={C.solar} p={solarUsed} pMax={pMax} />
        <Ribbon id="rb-dis" d={band(SRC_X + SRC_W, battY + 20, wDis, BUS_X, segDis, wDis)} c={center(SRC_X + SRC_W, battY + 20, BUS_X, segDis)}
          w={wDis} from={C.battery} to={C.battery} p={-s.pBatt} pMax={pMax} />
        <Ribbon id="rb-chg" d={band(SRC_X + SRC_W, battY + 20, wChg, BUS_X, segChg, wChg)} c={center(SRC_X + SRC_W, battY + 20, BUS_X, segChg)}
          w={wChg} from={C.charge} to={C.solar} p={s.pBatt} pMax={pMax} reverse />
        {loads.map((l, i) => (
          <Ribbon key={l.key} id={`rb-${l.key}`} d={band(BUS_X + BUS_W, segs[i], rightW[i], SNK_X, sinkY[i] + 20, rightW[i])}
            c={center(BUS_X + BUS_W, segs[i], SNK_X, sinkY[i] + 20)} w={rightW[i]} from={C.solar} to={C.load} p={l.p} pMax={pMax} />
        ))}
        {/* bus */}
        <rect x={BUS_X} y={busTop} width={BUS_W} height={busH} rx={4} className="pf-bus" style={s.powerLimited ? { stroke: "var(--warn)" } : undefined} />
        <text x={BUS_X + BUS_W / 2} y={busTop - 5} textAnchor="middle" className="lbl">BUS</text>
        {/* sources */}
        <Card x={SRC_X} y={solarY} w={SRC_W} h={42} icon={s.illum < 0.5 ? "moon" : "sun"} label="SOLAR" value={fmtKw(s.pGen)} color={s.illum < 0.5 ? "var(--eclipse)" : C.solar}
          sub={s.illum < 0.5 ? "eclipse" : s.illum < 0.999 ? "penumbra" : "sunlit"} />
        {s.pCurtailed > 0.05 && (
          <text x={SRC_X + 4} y={solarY + 56} className="lbl" fill="var(--muted)">curtailed {fmtKw(s.pCurtailed)}</text>
        )}
        <Card x={SRC_X} y={battY} w={SRC_W} h={50} icon="battery" label="BATTERY"
          value={charging ? `+${fmtKw(s.pBatt)}` : discharging ? fmtKw(s.pBatt) : "0 kW"}
          color={charging ? C.charge : discharging ? C.battery : "#8b95a3"} sub={charging ? "▲ CHG" : discharging ? "▼ DIS" : "IDLE"}>
          <rect x={SRC_X + 10} y={battY + 41} width={SRC_W - 44} height={4} rx={2} fill="#1a212c" />
          <rect x={SRC_X + 10} y={battY + 41} width={(SRC_W - 44) * s.soc} height={4} rx={2} fill={socColor} />
          <text x={SRC_X + SRC_W - 8} y={battY + 45} className="lbl" textAnchor="end">{fmtPct(s.soc)}</text>
        </Card>
        {/* sinks */}
        {loads.map((l, i) => (
          <Card key={l.key} x={SNK_X} y={sinkY[i]} w={SNK_W} h={42} icon={l.icon} label={l.label} value={fmtKw(l.p)}
            color={l.sub === "SHED" ? "var(--warn)" : C.load} sub={l.sub} />
        ))}
        {s.pUnmet > 0.001 && (
          <g>
            <rect x={120} y={4} width={110} height={20} rx={4} fill="rgba(239,68,68,0.15)" stroke="var(--bad)" />
            <text x={175} y={18} textAnchor="middle" className="val" fill="var(--bad)" fontSize={11}>UNMET {fmtKw(s.pUnmet)}</text>
          </g>
        )}
      </svg>
    </div>
  );
}
