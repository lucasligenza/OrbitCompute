"use client";
import { memo, useMemo } from "react";
import { Badge } from "@/components/Badge";
import TimeChart from "@/components/charts/TimeChart";
import { AdvancedHint } from "@/components/DetailToggle";
import Gauge from "@/components/viz/Gauge";
import KpiTile, { Insight, SectionTitle } from "@/components/viz/KpiTile";
import { explain } from "@/sim/explain";
import { fmtKw, fmtKwh, fmtPct } from "@/sim/format";
import type { PreparedNode, PreparedResult } from "@/sim/result";
import type { NodeConfig } from "@/sim/types";
import { useUi } from "@/state/ui";
import PowerFlow from "./PowerFlow";
import { useSelected } from "./hooks";

const PowerCharts = memo(function PowerCharts({ res, nd, cfg }: { res: PreparedResult; nd: PreparedNode; cfg: NodeConfig }) {
  const stacked = useMemo(() => {
    const platform = Float64Array.from(nd.s.p_platform_kw, (v, i) => v + nd.s.p_heater_kw[i]);
    return [
      { data: nd.s.p_compute_kw, color: "#4da3ff", label: "compute", stack: true, step: true },
      { data: nd.s.p_thermal_kw, color: "#7c8cff", label: "thermal ctrl", stack: true, step: true },
      { data: nd.s.p_comms_kw, color: "#3ecf8e", label: "comms", stack: true, step: true },
      { data: platform, color: "#8b95a3", label: "platform", stack: true, step: true },
      { data: nd.s.p_gen_kw, color: "#ffd98a", label: "solar available" },
    ];
  }, [nd]);
  const soc = useMemo(() => [{ data: Float64Array.from(nd.s.soc, (v) => v * 100), color: "#3ecf8e", label: "SOC", fill: true }], [nd]);
  const th = useMemo(() => [{ y: cfg.battery.min_soc * 100, color: "#ef4444", label: "reserve (compute shed)" }], [cfg]);
  const bands = nd.raw.eclipse_windows;
  return (
    <>
      <SectionTitle icon="layers">Load breakdown vs solar</SectionTitle>
      <TimeChart dt={res.dt} duration={res.duration} height={116} unit="kW" series={stacked} bands={bands} testId="power-chart" />
      <SectionTitle icon="battery">Battery state of charge</SectionTitle>
      <TimeChart dt={res.dt} duration={res.duration} height={84} unit="%" yMin={0} yMax={100} series={soc} bands={bands} thresholds={th} />
    </>
  );
});

export default function PowerPanel() {
  const { res, nd, cfg, s, t, idx } = useSelected(10);
  const adv = useUi((u) => u.detail === "advanced");
  const d = nd.raw.derived;
  const m = nd.raw.metrics;
  const pMax = Math.max(Number(d.rated_solar_kw), Number(d.compute_max_kw), 1);
  const why = useMemo(() => explain(res, idx, t).why[0], [res, idx, t]);
  const socColor = s.soc <= cfg.battery.min_soc + 0.01 ? "#ef4444" : s.soc < 0.4 ? "#f5a524" : "#3ecf8e";
  const net = s.pGen - s.pLoad;
  return (
    <div data-testid="power-panel">
      <div className="panel-title-row">
        <span className="mono" style={{ fontWeight: 600 }}>{nd.name}</span>
        <Badge kind="MODEL" text="Power bus model" />
      </div>
      <div className="card hero"><PowerFlow s={s} pMax={pMax} minSoc={cfg.battery.min_soc} /></div>
      <div className="gauges">
        <Gauge value={s.soc} display={fmtPct(s.soc)} label="Battery" sub={s.pBatt > 0.05 ? "charging" : s.pBatt < -0.05 ? "discharging" : "idle"} color={socColor}
          ticks={[{ at: cfg.battery.min_soc, color: "#ef4444" }]} testId="soc-gauge" />
        <Gauge value={Math.min(s.pGen / Math.max(Number(d.rated_solar_kw), 1e-6), 1)} display={fmtKw(s.pGen, 0)} label="Solar" sub={`of ${fmtKw(Number(d.rated_solar_kw), 0)} rated`} color="#ffd98a" />
        <Gauge value={Math.min(s.pLoad / pMax, 1)} display={fmtKw(s.pLoad, 0)} label="Load" sub={net >= 0 ? `+${fmtKw(net, 0)} margin` : `${fmtKw(net, 0)} deficit`} color={net >= 0 ? "#4da3ff" : "#f5a524"} />
      </div>
      <Insight text={why} />
      {!adv && <AdvancedHint what="load breakdown, SOC history, energy totals" />}
      {adv && (
        <>
          <div className="kpis">
            <KpiTile icon="sun" label="Array rated" value={fmtKw(Number(d.rated_solar_kw))} />
            <KpiTile icon="chip" label="Compute max" value={fmtKw(Number(d.compute_max_kw))} />
            <KpiTile icon="battery" label="Battery" value={fmtKwh(cfg.battery.capacity_kwh)} />
            <KpiTile icon="warning" label="Curtailed" value={fmtKwh(m.curtailed_kwh)} />
            <KpiTile icon="bolt" label="Power-limited" value={`${(m.power_limited_time_s / 60).toFixed(0)} min`}
              status={m.power_limited_time_s > 0 ? { text: "SHED", color: "#f5a524" } : undefined} />
            <KpiTile icon="battery" label="Min SOC" value={fmtPct(m.min_soc)} spark={{ data: nd.s.soc, dt: res.dt, duration: res.duration, color: "#3ecf8e", min: 0, max: 1 }} />
          </div>
          <PowerCharts res={res} nd={nd} cfg={cfg} />
          <p className="note">
            Arrays: area × efficiency × solar flux × derate × illumination (sun-tracking). Battery: charge/discharge limits and
            efficiencies; compute is shed at the {fmtPct(cfg.battery.min_soc)} reserve, essential loads may continue down to{" "}
            {fmtPct(cfg.battery.emergency_soc)}. Run-wide energy identity residual:{" "}
            <span className="mono">{Number(res.raw.checks.energy_identity_max_residual_kw).toExponential(1)} kW</span>.
          </p>
        </>
      )}
    </div>
  );
}
