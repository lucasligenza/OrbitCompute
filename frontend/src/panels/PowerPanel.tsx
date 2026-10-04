"use client";
import { memo, useMemo } from "react";
import { Badge } from "@/components/Badge";
import TimeChart from "@/components/charts/TimeChart";
import { fmtKw, fmtKwh, fmtPct } from "@/sim/format";
import type { PreparedNode, PreparedResult } from "@/sim/result";
import type { NodeConfig } from "@/sim/types";
import PowerFlow from "./PowerFlow";
import { useSelected } from "./hooks";

const PowerCharts = memo(function PowerCharts({ res, nd, cfg }: { res: PreparedResult; nd: PreparedNode; cfg: NodeConfig }) {
  const power = useMemo(() => [
    { data: nd.s.p_gen_kw, color: "#ffd98a", label: "solar" },
    { data: nd.s.p_load_kw, color: "#4da3ff", label: "total load", step: true },
    { data: nd.s.p_compute_kw, color: "#93c5fd", label: "compute", step: true, dash: true },
  ], [nd]);
  const soc = useMemo(() => [{ data: Float64Array.from(nd.s.soc, (v) => v * 100), color: "#3ecf8e", label: "SOC", fill: true }], [nd]);
  const th = useMemo(() => [{ y: cfg.battery.min_soc * 100, color: "#ef4444", label: "reserve (compute shed)" }], [cfg]);
  const bands = nd.raw.eclipse_windows;
  return (
    <>
      <div className="group-h">Power over time <span className="faint">eclipse shaded</span></div>
      <TimeChart dt={res.dt} duration={res.duration} height={100} unit="kW" series={power} bands={bands} testId="power-chart" />
      <div className="group-h">Battery state of charge</div>
      <TimeChart dt={res.dt} duration={res.duration} height={80} unit="%" yMin={0} yMax={100} series={soc} bands={bands} thresholds={th} />
    </>
  );
});

export default function PowerPanel() {
  const { res, nd, cfg, s } = useSelected(10);
  const d = nd.raw.derived;
  const m = nd.raw.metrics;
  const pMax = Math.max(Number(d.rated_solar_kw), Number(d.compute_max_kw), 1);
  return (
    <div data-testid="power-panel">
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
        <span className="mono" style={{ fontWeight: 600 }}>{nd.name}</span>
        <Badge kind="MODEL" text="Power bus model" />
      </div>
      <PowerFlow s={s} pMax={pMax} minSoc={cfg.battery.min_soc} />
      <div className="stats">
        <div className="stat"><div className="k">Array rated</div><div className="n">{fmtKw(Number(d.rated_solar_kw))}</div></div>
        <div className="stat"><div className="k">Compute max</div><div className="n">{fmtKw(Number(d.compute_max_kw))}</div></div>
        <div className="stat"><div className="k">Battery</div><div className="n">{fmtKwh(cfg.battery.capacity_kwh)}</div></div>
        <div className="stat"><div className="k">Curtailed</div><div className="n">{fmtKwh(m.curtailed_kwh)}</div></div>
        <div className="stat"><div className="k">Power-limited</div><div className="n">{(m.power_limited_time_s / 60).toFixed(0)} min</div></div>
        <div className="stat"><div className="k">Min SOC</div><div className="n">{fmtPct(m.min_soc)}</div></div>
      </div>
      <PowerCharts res={res} nd={nd} cfg={cfg} />
      <p className="note">
        Arrays: area × efficiency × solar flux × derate × illumination (sun-tracking). Battery: charge/discharge limits and
        efficiencies; compute is shed at the {fmtPct(cfg.battery.min_soc)} reserve, essential loads may continue down to{" "}
        {fmtPct(cfg.battery.emergency_soc)}. Run-wide energy identity residual:{" "}
        <span className="mono">{Number(res.raw.checks.energy_identity_max_residual_kw).toExponential(1)} kW</span>.
      </p>
    </div>
  );
}
