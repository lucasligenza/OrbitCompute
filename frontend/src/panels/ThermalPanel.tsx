"use client";
import { memo, useMemo } from "react";
import { Badge, StatusDot } from "@/components/Badge";
import TimeChart from "@/components/charts/TimeChart";
import SpacecraftSchematic, { tempColor } from "@/components/SpacecraftSchematic";
import { fmtC, fmtKw, fmtPct } from "@/sim/format";
import type { PreparedNode, PreparedResult } from "@/sim/result";
import type { NodeConfig } from "@/sim/types";
import { useSelected } from "./hooks";

const ThermalCharts = memo(function ThermalCharts({ res, nd, cfg }: { res: PreparedResult; nd: PreparedNode; cfg: NodeConfig }) {
  const temps = useMemo(() => [
    { data: nd.s.t_equip_c, color: "#f5a524", label: "equipment" },
    { data: nd.s.t_rad_c, color: "#5aa9e6", label: "radiator" },
  ], [nd]);
  const th = useMemo(() => [
    { y: cfg.thermal.throttle_c, color: "#f97316", label: "throttle" },
    { y: cfg.thermal.limit_c, color: "#ef4444", label: "limit" },
  ], [cfg]);
  const heat = useMemo(() => [
    { data: nd.s.q_diss_kw, color: "#f5a524", label: "dissipated", step: true },
    { data: nd.s.q_reject_kw, color: "#5aa9e6", label: "radiated to space", step: true },
  ], [nd]);
  return (
    <>
      <div className="group-h">Temperatures</div>
      <TimeChart dt={res.dt} duration={res.duration} height={100} unit="°C" series={temps} thresholds={th} bands={nd.raw.eclipse_windows}
        yMin={Math.min(-40, Math.floor(Math.min(...nd.s.t_rad_c) / 10) * 10)} testId="thermal-chart" />
      <div className="group-h">Heat balance</div>
      <TimeChart dt={res.dt} duration={res.duration} height={80} unit="kW" series={heat} />
    </>
  );
});

export default function ThermalPanel() {
  const { res, nd, cfg, s } = useSelected(10);
  const th = cfg.thermal;
  const margin = th.throttle_c - s.tEquip;
  const span = th.limit_c - (th.min_operating_c - 20);
  const pos = (c: number) => `${Math.min(Math.max(((c - (th.min_operating_c - 20)) / span) * 100, 0), 100)}%`;
  return (
    <div data-testid="thermal-panel">
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
        <span className="mono" style={{ fontWeight: 600 }}>{nd.name}</span>
        <Badge kind="MODEL" text="Simplified 2-node thermal model" />
        <span className="spacer" />
        <StatusDot color={tempColor(s.tEquip, cfg)} label={s.thermal} />
      </div>
      <SpacecraftSchematic cfg={cfg} s={s} mode="thermal" />
      <div className="group-h">Equipment temperature vs thresholds</div>
      <div style={{ position: "relative", height: 22, margin: "4px 0 14px" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 8, height: 6, borderRadius: 3,
          background: `linear-gradient(90deg, #5aa9e6 0%, #9aa7b6 ${pos(th.min_operating_c + 5)}, #9aa7b6 ${pos(th.warm_c)}, #f5a524 ${pos(th.warm_c)}, #f97316 ${pos(th.throttle_c)}, #ef4444 ${pos(th.limit_c)})` }} />
        {[["min", th.min_operating_c], ["warm", th.warm_c], ["throttle", th.throttle_c], ["limit", th.limit_c]].map(([l, c]) => (
          <span key={l as string} className="faint mono" style={{ position: "absolute", left: pos(c as number), top: 16, fontSize: 9.5, transform: "translateX(-50%)" }}>{l}</span>
        ))}
        <div style={{ position: "absolute", left: pos(s.tEquip), top: 2, width: 2, height: 18, background: "#fff", transform: "translateX(-1px)" }} />
      </div>
      <div className="stats">
        <div className="stat"><div className="k">Equipment</div><div className="n">{fmtC(s.tEquip)}</div></div>
        <div className="stat"><div className="k">Margin</div><div className="n" style={{ color: margin < 0 ? "var(--warn)" : undefined }}>{margin.toFixed(1)} K</div></div>
        <div className="stat"><div className="k">Clock factor</div><div className="n">{fmtPct(s.throttle)}</div></div>
        <div className="stat"><div className="k">Dissipated</div><div className="n">{fmtKw(s.qDiss)}</div></div>
        <div className="stat"><div className="k">Radiated</div><div className="n">{fmtKw(s.qReject)}</div></div>
        <div className="stat"><div className="k">Throttled</div><div className="n">{(nd.raw.metrics.throttled_time_s / 60).toFixed(0)} min</div></div>
      </div>
      <ThermalCharts res={res} nd={nd} cfg={cfg} />
      <p className="note">
        Two lumped nodes: equipment (C = {th.equipment_heat_capacity_kj_per_k.toFixed(0)} kJ/K) coupled by G ={" "}
        {th.conductance_kw_per_k} kW/K to a radiator of {th.radiator_area_m2} m² (ε = {th.emissivity}) rejecting εσAT⁴.
        Earth IR absorbed via a flat-plate view factor; albedo, internal gradients and fluid-loop dynamics are not modelled.
        This is not a spacecraft thermal analysis.
      </p>
    </div>
  );
}
