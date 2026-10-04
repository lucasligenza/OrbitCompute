"use client";
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

function radColor(c: number): string {
  // radiator is colder by design: blue (−60 °C) → neutral (40 °C) → amber (90 °C)
  const f = Math.min(Math.max((c + 60) / 150, 0), 1);
  const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
  if (f < 0.66) {
    const t = f / 0.66;
    return `rgb(${lerp(70, 160, t)},${lerp(130, 170, t)},${lerp(200, 185, t)})`;
  }
  const t = (f - 0.66) / 0.34;
  return `rgb(${lerp(160, 245, t)},${lerp(170, 165, t)},${lerp(185, 36, t)})`;
}

interface Props { cfg: NodeConfig; s?: NodeSample; mode?: "thermal" | "design" }

/** Conceptual schematic. Element sizes scale with configured quantities; not a packaging design. */
export default function SpacecraftSchematic({ cfg, s, mode = "design" }: Props) {
  const arrayW = Math.min(150, 26 + Math.sqrt(cfg.solar.area_m2) * 3.2);
  const arrayH = Math.min(70, 18 + Math.sqrt(cfg.solar.area_m2) * 1.2);
  const computeP = (cfg.compute.accelerator_count * cfg.compute.max_w) / 1000;
  const coreW = Math.min(84, 30 + Math.sqrt(computeP) * 2.4);
  const coreH = Math.min(70, 26 + Math.sqrt(computeP) * 1.6);
  const radL = Math.min(110, 18 + Math.sqrt(cfg.thermal.radiator_area_m2) * 2.4);
  const battH = Math.min(26, 6 + Math.sqrt(cfg.battery.capacity_kwh) * 0.8);
  const cx = 200, cy = 130;
  const lit = s ? s.illum : 1;
  const coreFill = s && mode === "thermal" ? tempColor(s.tEquip, cfg) : "#33465e";
  const radFill = s && mode === "thermal" ? radColor(s.tRad) : "#5f7187";
  const arrayFill = lit > 0.5 ? "#2b4a78" : "#1a2236";
  const soc = s?.soc ?? cfg.battery.initial_soc;

  return (
    <svg viewBox="0 0 400 290" width="100%" role="img" aria-label="Conceptual spacecraft schematic" data-testid="schematic">
      {/* radiators (edge-on to Sun, extending fore/aft) */}
      <rect x={cx - 10} y={cy - coreH / 2 - radL} width={20} height={radL} fill={radFill} opacity={0.9} rx={2} />
      <rect x={cx - 10} y={cy + coreH / 2} width={20} height={radL} fill={radFill} opacity={0.9} rx={2} />
      {/* arrays */}
      {[-1, 1].map((side) => {
        const x0 = side < 0 ? cx - coreW / 2 - 14 - arrayW : cx + coreW / 2 + 14;
        return (
          <g key={side}>
            <line x1={side < 0 ? x0 + arrayW : x0} y1={cy} x2={side < 0 ? cx - coreW / 2 : cx + coreW / 2} y2={cy} stroke="#5b6573" strokeWidth={2} />
            <rect x={x0} y={cy - arrayH / 2} width={arrayW} height={arrayH} fill={arrayFill} stroke="#3d6cb3" strokeWidth={1} />
            {Array.from({ length: 5 }, (_, k) => (
              <line key={k} x1={x0 + ((k + 1) * arrayW) / 6} y1={cy - arrayH / 2} x2={x0 + ((k + 1) * arrayW) / 6} y2={cy + arrayH / 2} stroke="#3d6cb3" strokeWidth={0.5} opacity={0.6} />
            ))}
          </g>
        );
      })}
      {/* compute core */}
      <rect x={cx - coreW / 2} y={cy - coreH / 2} width={coreW} height={coreH} rx={4} fill={coreFill} stroke="#8b95a3" strokeWidth={1} />
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize={9} fill="#05070a" fontWeight={700}>COMPUTE</text>
      <text x={cx} y={cy + 8} textAnchor="middle" fontSize={8.5} fill="#05070a">{cfg.compute.accelerator_count}×</text>
      {/* battery */}
      <rect x={cx - coreW / 2 + 4} y={cy + coreH / 2 - battH - 4} width={coreW - 8} height={battH} rx={2} fill="#0d1218" stroke="#5b6573" />
      <rect x={cx - coreW / 2 + 5} y={cy + coreH / 2 - battH - 3} width={(coreW - 10) * soc} height={battH - 2} rx={1}
        fill={soc <= cfg.battery.min_soc + 0.01 ? "#ef4444" : soc < 0.4 ? "#f5a524" : "#3ecf8e"} opacity={0.75} />
      {/* comms dish */}
      <path d={`M${cx + coreW / 2 - 6} ${cy - coreH / 2} q 8 -12 18 -6`} stroke="#9fb3c8" fill="none" strokeWidth={1.5} />

      {/* labels */}
      <text x={cx + 16} y={cy - coreH / 2 - radL / 2} fontSize={9.5} fill="#8b95a3">RADIATOR {cfg.thermal.radiator_area_m2.toFixed(0)} m²</text>
      <text x={20} y={cy - arrayH / 2 - 6} fontSize={9.5} fill="#8b95a3">SOLAR {cfg.solar.area_m2.toFixed(0)} m²</text>
      <text x={cx + 16} y={cy + coreH / 2 + radL / 2 + 4} fontSize={9.5} fill="#8b95a3">BATTERY {cfg.battery.capacity_kwh.toFixed(0)} kWh</text>

      {mode === "thermal" && s && (
        <g fontFamily="var(--font-mono)" fontSize={10}>
          <text x={cx - coreW / 2 - 4} y={cy + coreH / 2 + 16} textAnchor="end" fill={coreFill}>{fmtC(s.tEquip)}</text>
          <text x={cx - 16} y={cy - coreH / 2 - radL + 10} textAnchor="end" fill={radFill}>{fmtC(s.tRad)}</text>
          {/* heat to space */}
          {[0, 1, 2].map((k) => (
            <path key={k} d={`M${cx + 12} ${cy - coreH / 2 - radL + 14 + k * 14} q 6 -4 12 0 t 12 0`} stroke="#f5a524" fill="none" opacity={0.7} />
          ))}
          <text x={cx + 46} y={cy - coreH / 2 - radL + 30} fill="#f5a524">→ space {fmtKw(s.qReject)}</text>
          <text x={20} y={278} fill="#8b95a3">Earth IR in {fmtKw(s.qEnv)} · dissipated {fmtKw(s.qDiss)}</text>
        </g>
      )}
      <text x={392} y={286} textAnchor="end" fontSize={9} fill="#5b6573">Conceptual schematic · not to scale · not a packaging design</text>
    </svg>
  );
}
