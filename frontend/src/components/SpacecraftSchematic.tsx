"use client";
// Conceptual ¾ isometric schematic. Element sizes scale with configured quantities; not a
// packaging design and not to scale. In thermal mode the compute module and radiator fins are
// false-coloured by the simulated temperatures and heat flow is animated.
import type { NodeConfig } from "@/sim/types";
import type { NodeSample } from "@/sim/sample";
import { fmtC, fmtKw } from "@/sim/format";

export function tempColor(c: number, cfg: NodeConfig): string {
  const th = cfg.thermal;
  if (c >= th.limit_c) return "#ef4444";
  if (c >= th.throttle_c) return "#f97316";
  if (c >= th.warm_c) return "#f5a524";
  if (c < th.min_operating_c + 5) return "#5aa9e6";
  return "#9aa7b6";
}

/** Radiator false colour: blue (−60 °C) → neutral (35 °C) → amber (60 °C) → red (90 °C). */
export function radColor(c: number): string {
  const stops: [number, [number, number, number]][] = [[-60, [61, 123, 217]], [0, [127, 167, 201]], [35, [201, 209, 219]], [60, [245, 165, 36]], [90, [239, 68, 68]]];
  if (c <= stops[0][0]) return `rgb(${stops[0][1].join(",")})`;
  for (let i = 1; i < stops.length; i++) {
    if (c <= stops[i][0]) {
      const f = (c - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      const a = stops[i - 1][1], b = stops[i][1];
      return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(",")})`;
    }
  }
  return `rgb(${stops[stops.length - 1][1].join(",")})`;
}

const COS30 = Math.cos(Math.PI / 6), SIN30 = 0.5;

interface Props { cfg: NodeConfig; s?: NodeSample; mode?: "thermal" | "design" }

export default function SpacecraftSchematic({ cfg, s, mode = "design" }: Props) {
  const cx = 200, cy = 146, k = 1.18;
  const iso = (x: number, y: number, z: number): [number, number] => [cx + (x - y) * COS30 * k, cy + (x + y) * SIN30 * k - z * k];
  const pts = (...p: [number, number, number][]) => p.map((q) => iso(...q).map((v) => v.toFixed(1)).join(",")).join(" ");

  const pk = (cfg.compute.accelerator_count * cfg.compute.max_w) / 1000;
  const a = Math.min(30, 13 + Math.sqrt(pk) * 0.9); // module half-size x
  const b = a * 0.85, c = a * 0.75;
  const radL = Math.min(105, 22 + Math.sqrt(cfg.thermal.radiator_area_m2) * 2.6);
  const wingL = Math.min(118, 30 + Math.sqrt(cfg.solar.area_m2) * 2.6);
  const wingW = Math.min(46, 14 + Math.sqrt(cfg.solar.area_m2) * 0.9);
  const thermal = mode === "thermal" && !!s;
  const lit = s ? s.illum : 1;
  const modColor = thermal ? tempColor(s!.tEquip, cfg) : "#3b4d63";
  const rootColor = thermal ? radColor((s!.tEquip + s!.tRad) / 2) : "#9aa7b6";
  const tipColor = thermal ? radColor(s!.tRad) : "#c9d1db";
  const wingFill = lit > 0.5 ? "url(#wingLit)" : "url(#wingDark)";
  const soc = s?.soc ?? cfg.battery.initial_soc;
  const socColor = soc <= cfg.battery.min_soc + 0.01 ? "#ef4444" : soc < 0.4 ? "#f5a524" : "#3ecf8e";
  const heatSpeed = thermal ? Math.max(0.8, 3.2 - (s!.qReject / Math.max(s!.qReject + 50, 1)) * 2.4) : 0;

  const wing = (sign: number) => {
    const x0 = sign * (a + 8), x1 = sign * (a + 8 + wingL);
    return (
      <g>
        <line x1={iso(sign * a, 0, 0)[0]} y1={iso(sign * a, 0, 0)[1]} x2={iso(x0, 0, 0)[0]} y2={iso(x0, 0, 0)[1]} stroke="#6b7685" strokeWidth={1.5} />
        <polygon points={pts([x0, -wingW, 0], [x1, -wingW, 0], [x1, wingW, 0], [x0, wingW, 0])} fill={wingFill} stroke="#3d6cb3" strokeWidth={0.8} />
        {Array.from({ length: 5 }, (_, i) => {
          const xx = x0 + ((x1 - x0) * (i + 1)) / 6;
          const p0 = iso(xx, -wingW, 0), p1 = iso(xx, wingW, 0);
          return <line key={i} x1={p0[0]} y1={p0[1]} x2={p1[0]} y2={p1[1]} stroke="#5a86c8" strokeWidth={0.4} opacity={0.6} />;
        })}
        {(() => { const p0 = iso(x0, 0, 0), p1 = iso(x1, 0, 0); return <line x1={p0[0]} y1={p0[1]} x2={p1[0]} y2={p1[1]} stroke="#5a86c8" strokeWidth={0.4} opacity={0.6} />; })()}
      </g>
    );
  };
  const fin = (up: boolean) => {
    const z0 = up ? c : -c, z1 = up ? c + radL : -c - radL;
    const y0 = -b * 0.9, y1 = b * 0.9;
    const gid = up ? "finUp" : "finDown";
    const [gx0, gy0] = iso(0, 0, z0), [gx1, gy1] = iso(0, 0, z1);
    return (
      <g>
        <defs>
          <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={gx0} y1={gy0} x2={gx1} y2={gy1}>
            <stop offset="0" stopColor={rootColor} />
            <stop offset="1" stopColor={tipColor} />
          </linearGradient>
        </defs>
        <polygon points={pts([0, y0, z0], [0, y1, z0], [0, y1, z1], [0, y0, z1])} fill={`url(#${gid})`} stroke="rgba(255,255,255,0.25)" strokeWidth={0.6}
          style={thermal && s!.tRad > 45 ? { filter: `drop-shadow(0 0 6px ${tipColor})` } : undefined} />
        {Array.from({ length: 4 }, (_, i) => {
          const zz = z0 + ((z1 - z0) * (i + 1)) / 5;
          const p0 = iso(0, y0, zz), p1 = iso(0, y1, zz);
          return <line key={i} x1={p0[0]} y1={p0[1]} x2={p1[0]} y2={p1[1]} stroke="rgba(0,0,0,0.25)" strokeWidth={0.5} />;
        })}
      </g>
    );
  };
  const heatPath = (() => {
    const p0 = iso(0, 0, c * 0.2), p1 = iso(0, 0, c + radL * 0.85);
    return `M${p0[0]} ${p0[1]} L${p1[0]} ${p1[1]} Q${p1[0] + 30} ${p1[1] - 20} ${p1[0] + 70} ${p1[1] - 26}`;
  })();
  const earthIr = (() => {
    const p1 = iso(0, -b * 0.2, -c - radL * 0.6);
    return `M${p1[0] - 70} ${p1[1] + 40} Q${p1[0] - 40} ${p1[1] + 30} ${p1[0] - 4} ${p1[1] + 4}`;
  })();

  return (
    <svg viewBox="0 0 400 300" width="100%" role="img" aria-label="Conceptual spacecraft schematic" data-testid="schematic">
      <defs>
        <linearGradient id="wingLit" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2f5a9c" /><stop offset="1" stopColor="#173159" /></linearGradient>
        <linearGradient id="wingDark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1b2740" /><stop offset="1" stopColor="#10172a" /></linearGradient>
        <linearGradient id="modTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" stopOpacity="0.35" /><stop offset="1" stopColor="#ffffff" stopOpacity="0.08" /></linearGradient>
        <radialGradient id="spaceGlow" cx="0.5" cy="0.4" r="0.7"><stop offset="0" stopColor="#1a2333" /><stop offset="1" stopColor="#0b0f15" /></radialGradient>
        <marker id="arrHeat" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 z" fill="#f5a524" /></marker>
        <marker id="arrIr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 z" fill="#5aa9e6" /></marker>
      </defs>
      <rect x="0" y="0" width="400" height="300" rx="8" fill="url(#spaceGlow)" />
      {/* Earth limb hint (bottom-left) for the Earth-IR arrow */}
      <path d="M0 300 Q60 250 140 300 Z" fill="#12233a" opacity="0.9" />
      <path d="M0 300 Q60 250 140 300" fill="none" stroke="#3a6fb8" strokeWidth="1.2" opacity="0.7" />

      {fin(false)}
      {wing(-1)}
      {/* compute module (three visible faces) */}
      <polygon points={pts([a, -b, -c], [a, b, -c], [a, b, c], [a, -b, c])} fill={modColor} stroke="rgba(0,0,0,0.35)" strokeWidth={0.6} style={{ filter: "brightness(0.82)" }} />
      <polygon points={pts([-a, b, -c], [a, b, -c], [a, b, c], [-a, b, c])} fill={modColor} stroke="rgba(0,0,0,0.35)" strokeWidth={0.6} style={{ filter: "brightness(0.62)" }} />
      <polygon points={pts([-a, -b, c], [a, -b, c], [a, b, c], [-a, b, c])} fill={modColor} stroke="rgba(255,255,255,0.3)" strokeWidth={0.6} />
      <polygon points={pts([-a, -b, c], [a, -b, c], [a, b, c], [-a, b, c])} fill="url(#modTop)" />
      {/* battery band on the right face */}
      <polygon points={pts([a, -b * 0.8, -c * 0.75], [a, b * 0.8, -c * 0.75], [a, b * 0.8, -c * 0.35], [a, -b * 0.8, -c * 0.35])} fill="#0d1218" stroke="#5b6573" strokeWidth={0.5} />
      <polygon points={pts([a, -b * 0.78, -c * 0.72], [a, -b * 0.78 + 1.56 * b * soc, -c * 0.72], [a, -b * 0.78 + 1.56 * b * soc, -c * 0.38], [a, -b * 0.78, -c * 0.38])} fill={socColor} opacity={0.8} />
      {fin(true)}
      {wing(1)}
      {/* comms dish */}
      {(() => { const p = iso(-a * 0.4, -b, c * 0.6); return <ellipse cx={p[0]} cy={p[1] - 6} rx={7} ry={3.5} fill="#d9dee5" stroke="#8b95a3" strokeWidth={0.6} />; })()}

      {thermal && (
        <g>
          <path d={heatPath} fill="none" stroke="#f5a524" strokeWidth={1.6} className="flow flow-dash" markerEnd="url(#arrHeat)" style={{ animationDuration: `${heatSpeed}s` }} opacity={0.9} />
          <path d={earthIr} fill="none" stroke="#5aa9e6" strokeWidth={1.2} strokeDasharray="3 4" markerEnd="url(#arrIr)" opacity={0.8} />
        </g>
      )}

      {/* labels in the corners with leader lines (keeps geometry readable) */}
      {(() => {
        const finTip = iso(0, b * 0.9, c + radL);
        const modCorner = iso(-a, -b, c);
        const wingMid = iso(-a - 8 - wingL * 0.6, -wingW, 0);
        const modFront = iso(a, b, -c);
        return (
          <g fontSize="9.5" fill="#8b95a3">
            <polyline points={`${finTip[0]},${finTip[1]} ${finTip[0] + 18},${22} 384,22`} fill="none" stroke="#5b6573" strokeWidth={0.6} />
            <text x={384} y={18} textAnchor="end">RADIATOR {cfg.thermal.radiator_area_m2.toFixed(0)} m²</text>
            {thermal && <text x={384} y={34} textAnchor="end" fill={tipColor} fontFamily="var(--font-mono)" fontSize="10.5">{fmtC(s!.tRad)}</text>}
            <polyline points={`${modCorner[0]},${modCorner[1]} ${modCorner[0] - 22},${22} 16,22`} fill="none" stroke="#5b6573" strokeWidth={0.6} />
            <text x={16} y={18}>COMPUTE {cfg.compute.accelerator_count}×</text>
            {thermal && <text x={16} y={34} fill={modColor} fontFamily="var(--font-mono)" fontSize="10.5">{fmtC(s!.tEquip)}</text>}
            <polyline points={`${wingMid[0]},${wingMid[1] + 4} ${wingMid[0]},${wingMid[1] + 40}`} fill="none" stroke="#5b6573" strokeWidth={0.6} />
            <text x={Math.max(wingMid[0], 40)} y={wingMid[1] + 50} textAnchor="middle">SOLAR {cfg.solar.area_m2.toFixed(0)} m²</text>
            <polyline points={`${modFront[0]},${modFront[1]} ${modFront[0] + 30},${modFront[1] + 26}`} fill="none" stroke="#5b6573" strokeWidth={0.6} />
            <text x={modFront[0] + 32} y={modFront[1] + 36}>BATTERY {cfg.battery.capacity_kwh.toFixed(0)} kWh</text>
          </g>
        );
      })()}
      {thermal && (
        <g fontFamily="var(--font-mono)" fontSize="10.5">
          <text x={iso(0, 0, c + radL * 0.85)[0] + 74} y={iso(0, 0, c + radL * 0.85)[1] - 32} fill="#f5a524">→ space {fmtKw(s!.qReject)}</text>
          <text x={10} y={262} fill="#5aa9e6">Earth IR {fmtKw(s!.qEnv)}</text>
          <text x={392} y={276} textAnchor="end" fill="#c3cad4">dissipated {fmtKw(s!.qDiss)}</text>
        </g>
      )}
      <text x={392} y={292} textAnchor="end" fontSize="8.5" fill="#5b6573">Conceptual schematic · not to scale · not a packaging design</text>
    </svg>
  );
}
