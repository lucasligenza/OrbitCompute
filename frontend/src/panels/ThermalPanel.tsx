"use client";
import { memo, useMemo } from "react";
import { Badge, StatusDot } from "@/components/Badge";
import TimeChart from "@/components/charts/TimeChart";
import { AdvancedHint } from "@/components/DetailToggle";
import SpacecraftSchematic, { tempColor } from "@/components/SpacecraftSchematic";
import Gauge from "@/components/viz/Gauge";
import KpiTile, { Insight, SectionTitle } from "@/components/viz/KpiTile";
import { explain } from "@/sim/explain";
import { fmtC, fmtKw, fmtPct } from "@/sim/format";
import type { PreparedNode, PreparedResult } from "@/sim/result";
import type { NodeConfig } from "@/sim/types";
import { useUi } from "@/state/ui";
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
  const heat = useMemo(() => {
    const surplus = Float64Array.from(nd.s.q_diss_kw, (v, i) => Math.max(0, v - nd.s.q_reject_kw[i]));
    return [
      { data: nd.s.q_reject_kw, color: "#5aa9e6", label: "radiated to space", fill: true, step: true },
      { data: nd.s.q_diss_kw, color: "#f5a524", label: "dissipated", step: true },
      { data: surplus, color: "#ef4444", label: "net heating", fill: true, step: true },
    ];
  }, [nd]);
  let lo = Infinity;
  for (const v of nd.s.t_rad_c) lo = Math.min(lo, v);
  return (
    <>
      <SectionTitle icon="thermo">Temperatures</SectionTitle>
      <TimeChart dt={res.dt} duration={res.duration} height={104} unit="°C" series={temps} thresholds={th} bands={nd.raw.eclipse_windows}
        yMin={Math.min(-40, Math.floor(lo / 10) * 10)} testId="thermal-chart" />
      <SectionTitle icon="radiator">Heat balance</SectionTitle>
      <TimeChart dt={res.dt} duration={res.duration} height={90} unit="kW" series={heat} />
    </>
  );
});

export default function ThermalPanel() {
  const { res, nd, cfg, s, t, idx } = useSelected(10);
  const adv = useUi((u) => u.detail === "advanced");
  const th = cfg.thermal;
  const margin = th.throttle_c - s.tEquip;
  const why = useMemo(() => explain(res, idx, t).why.find((w) => /radiator|warm|heater/i.test(w)), [res, idx, t]);
  const span = th.limit_c - (th.min_operating_c - 20);
  const frac = (c: number) => Math.min(Math.max((c - (th.min_operating_c - 20)) / span, 0), 1);
  const color = tempColor(s.tEquip, cfg);
  const balance = s.qDiss - s.qReject;
  return (
    <div data-testid="thermal-panel">
      <div className="panel-title-row">
        <span className="mono" style={{ fontWeight: 600 }}>{nd.name}</span>
        <Badge kind="MODEL" text="Simplified 2-node thermal model" />
        <span className="spacer" />
        <StatusDot color={color} label={s.thermal} />
      </div>
      <div className="card hero"><SpacecraftSchematic cfg={cfg} s={s} mode="thermal" /></div>
      <div className="gauges">
        <Gauge value={frac(s.tEquip)} display={fmtC(s.tEquip)} label="Equipment" sub={s.thermal.toLowerCase()} color={color === "#9aa7b6" ? "#c9d1db" : color}
          ticks={[{ at: frac(th.warm_c), color: "#f5a524" }, { at: frac(th.throttle_c), color: "#f97316" }, { at: frac(th.limit_c), color: "#ef4444" }]} testId="temp-gauge" />
        <Gauge value={Math.min(Math.max(margin / 40, 0), 1)} display={`${margin.toFixed(0)} K`} label="Margin" sub="to throttle" color={margin < 0 ? "#ef4444" : margin < 10 ? "#f5a524" : "#3ecf8e"} />
        <Gauge value={s.throttle} display={fmtPct(s.throttle)} label="Clock" sub={s.throttle < 0.999 ? "throttled" : "full speed"} color={s.throttle < 0.999 ? "#f97316" : "#4da3ff"} />
      </div>
      <Insight text={why ?? (balance > 0.5 ? `Heating: ${fmtKw(balance)} more is dissipated than radiated right now.` : `Cooling or steady: the radiator rejects ${fmtKw(s.qReject)} against ${fmtKw(s.qDiss)} dissipated.`)} />
      {!adv && <AdvancedHint what="temperature history, heat balance, model assumptions" />}
      {adv && (
        <>
          <div className="kpis">
            <KpiTile icon="flame" label="Dissipated" value={fmtKw(s.qDiss)} spark={{ data: nd.s.q_diss_kw, dt: res.dt, duration: res.duration, color: "#f5a524" }} />
            <KpiTile icon="radiator" label="Radiated" value={fmtKw(s.qReject)} spark={{ data: nd.s.q_reject_kw, dt: res.dt, duration: res.duration, color: "#5aa9e6" }} />
            <KpiTile icon="clock" label="Throttled" value={`${(nd.raw.metrics.throttled_time_s / 60).toFixed(0)} min`}
              status={nd.raw.metrics.throttled_time_s > 0 ? { text: "YES", color: "#f97316" } : undefined} />
          </div>
          <ThermalCharts res={res} nd={nd} cfg={cfg} />
          <p className="note">
            Two lumped nodes: equipment (C = {th.equipment_heat_capacity_kj_per_k.toFixed(0)} kJ/K) coupled by G ={" "}
            {th.conductance_kw_per_k} kW/K to a radiator of {th.radiator_area_m2} m² (ε = {th.emissivity}) rejecting εσAT⁴.
            Earth IR absorbed via a flat-plate view factor; albedo, internal gradients and fluid-loop dynamics are not modelled.
            This is not a spacecraft thermal analysis.
          </p>
        </>
      )}
    </div>
  );
}
