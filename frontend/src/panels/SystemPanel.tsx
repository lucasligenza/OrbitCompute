"use client";
import { Fragment } from "react";
import { Badge } from "@/components/Badge";
import { AdvancedHint } from "@/components/DetailToggle";
import { Icon, type IconName } from "@/components/viz/Icon";
import KpiTile, { SectionTitle } from "@/components/viz/KpiTile";
import { fmtDur, fmtKwh, fmtPct } from "@/sim/format";
import { sampleNode, type NodeSample } from "@/sim/sample";
import type { NodeConfig } from "@/sim/types";
import { useUi } from "@/state/ui";
import { useSelected } from "./hooks";

type Cell = { icon: IconName; text: string; color: string };

function health(s: NodeSample, cfg: NodeConfig): Cell[] {
  const power: Cell = s.pUnmet > 0 ? { icon: "warning", text: "outage", color: "#ef4444" }
    : s.powerLimited ? { icon: "bolt", text: "shed", color: "#f5a524" }
      : s.soc < 0.25 ? { icon: "battery", text: `${fmtPct(s.soc)}`, color: "#f5a524" }
        : { icon: s.illum < 0.5 ? "moon" : "sun", text: fmtPct(s.soc), color: "#3ecf8e" };
  const thermal: Cell = s.thermalCode >= 3 ? { icon: "warning", text: "limit", color: "#ef4444" }
    : s.thermalCode === 2 ? { icon: "thermo", text: "throttled", color: "#f97316" }
      : s.thermalCode === 1 ? { icon: "thermo", text: `${s.tEquip.toFixed(0)}°C`, color: "#f5a524" }
        : { icon: "thermo", text: `${s.tEquip.toFixed(0)}°C`, color: s.tEquip < cfg.thermal.min_operating_c + 5 ? "#5aa9e6" : "#3ecf8e" };
  const compute: Cell = s.nStalled > 0 ? { icon: "clock", text: `${fmtPct(s.util)} · stall`, color: "#f5a524" }
    : { icon: "chip", text: fmtPct(s.util), color: s.util > 0.05 ? "#4da3ff" : "#8b95a3" };
  const network: Cell = s.link === "NONE" ? { icon: "antenna", text: "none", color: "#8b95a3" }
    : { icon: s.link === "RELAY" ? "relay" : s.link === "ISL" ? "link" : "antenna", text: s.link.toLowerCase(), color: "#3ecf8e" };
  return [power, thermal, compute, network];
}

export default function SystemPanel() {
  const { res, t, idx } = useSelected(5);
  const adv = useUi((u) => u.detail === "advanced");
  const selectNode = useUi((s) => s.selectNode);
  const m = res.raw.metrics;
  const checks = res.raw.checks;
  return (
    <div data-testid="system-panel">
      <div className="panel-title-row">
        <span style={{ fontWeight: 600 }}>{res.raw.scenario.name}</span>
        <Badge kind={res.raw.scenario.provenance} />
      </div>
      <SectionTitle icon="layers">Health matrix (now)</SectionTitle>
      <div className="card pad">
        <table className="health" data-testid="health-matrix">
          <thead><tr><th style={{ textAlign: "left" }}>Node</th><th>Power</th><th>Thermal</th><th>Compute</th><th>Link</th></tr></thead>
          <tbody>
            {res.nodes.map((nd) => {
              const cells = health(sampleNode(res, nd, t), res.raw.scenario.nodes[nd.index]);
              return (
                <tr key={nd.index} onClick={() => selectNode(nd.index)} style={nd.index === idx ? { outline: "1px solid rgba(77,163,255,0.5)" } : undefined}>
                  <td className="n">{nd.name}</td>
                  {cells.map((c, i) => (
                    <td key={i} style={{ color: c.color, background: `${c.color}14` }}><span><Icon name={c.icon} size={11} color={c.color} />{c.text}</span></td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="kpis">
        <KpiTile icon="check" label="Jobs done" value={`${m.jobs_completed}/${m.jobs_total}`} />
        <KpiTile icon="chip" label="Utilization" value={fmtPct(m.utilization_mean)} />
        <KpiTile icon="antenna" label="Link avail." value={fmtPct(m.network_availability)} />
        <KpiTile icon="warning" label="Outage" value={`${(m.outage_time_s / 60).toFixed(0)} min`}
          status={m.outage_time_s > 0 ? { text: "FAULT", color: "#ef4444" } : { text: "OK", color: "#3ecf8e" }} />
      </div>
      {!adv && <AdvancedHint what="full run metrics, engine self-checks, provenance" />}
      {adv && (
        <>
          <p className="note" style={{ marginTop: 0 }}>{res.raw.scenario.description}</p>
          <SectionTitle icon="layers" right={<Badge kind="MODEL" text="not flight validation" />}>Whole run</SectionTitle>
          <div className="kpis">
            <KpiTile label="Deadline misses" value={String(m.deadline_misses)} />
            <KpiTile label="Mean queue" value={fmtDur(m.mean_queue_time_s)} />
            <KpiTile label="Energy used" value={fmtKwh(m.energy_consumed_kwh)} />
            <KpiTile label="Curtailed" value={fmtKwh(m.curtailed_kwh)} />
            <KpiTile label="Throttled" value={`${(m.throttled_time_s / 60).toFixed(0)} min`} />
            <KpiTile label="Power-limited" value={`${(m.power_limited_time_s / 60).toFixed(0)} min`} />
            <KpiTile label="Compute avail." value={fmtPct(m.compute_availability)} />
            <KpiTile label="Work done" value={m.work_done_ref_acc_h.toFixed(0)} unit="ref-acc·h" />
            <KpiTile label="Min SOC" value={fmtPct(m.min_soc)} />
          </div>
          <SectionTitle icon="check">Engine self-checks</SectionTitle>
          <dl className="kv">
            <dt>Energy identity residual</dt><dd>{Number(checks.energy_identity_max_residual_kw).toExponential(1)} kW</dd>
            <dt>Battery update residual</dt><dd>{Number(checks.battery_update_max_residual_kwh).toExponential(1)} kWh</dd>
            <dt>Battery bounds</dt><dd>{checks.battery_bounds_ok ? "OK" : "VIOLATED"}</dd>
            <dt>Thermal bounds</dt><dd>{checks.thermal_bounds_ok ? "OK" : "VIOLATED"}</dd>
            <dt>Engine · result</dt><dd>v{res.raw.engine_version} · {res.hash.slice(0, 10)}</dd>
          </dl>
          <SectionTitle icon="layers">Provenance</SectionTitle>
          <dl className="kv">
            {Object.entries(res.raw.provenance).map(([k, v]) => (<Fragment key={k}><dt>{k}</dt><dd style={{ fontFamily: "var(--font-sans)", fontSize: 11 }}>{v}</dd></Fragment>))}
          </dl>
        </>
      )}
    </div>
  );
}
