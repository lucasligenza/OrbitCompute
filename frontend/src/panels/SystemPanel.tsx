"use client";
import { Fragment } from "react";
import { Badge } from "@/components/Badge";
import { encodeNode } from "@/scene/encoding";
import { fmtDur, fmtKwh, fmtPct } from "@/sim/format";
import { sampleNode } from "@/sim/sample";
import { useUi } from "@/state/ui";
import { useSelected } from "./hooks";

export default function SystemPanel() {
  const { res, t, idx } = useSelected(5);
  const selectNode = useUi((s) => s.selectNode);
  const m = res.raw.metrics;
  const checks = res.raw.checks;
  return (
    <div data-testid="system-panel">
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontWeight: 600 }}>{res.raw.scenario.name}</span>
        <Badge kind={res.raw.scenario.provenance} />
      </div>
      <p className="note" style={{ marginTop: 0 }}>{res.raw.scenario.description}</p>
      <div className="group-h">Nodes now</div>
      <table className="metrics">
        <thead><tr><th>Node</th><th>State</th><th>SOC</th><th>Temp</th><th>Util</th><th>Link</th></tr></thead>
        <tbody>
          {res.nodes.map((nd) => {
            const s = sampleNode(res, nd, t);
            const e = encodeNode("system", s, res.raw.scenario.nodes[nd.index]);
            return (
              <tr key={nd.index} onClick={() => selectNode(nd.index)} style={{ cursor: "pointer", background: nd.index === idx ? "var(--accent-dim)" : undefined }}>
                <td className="mono">{nd.name}</td>
                <td style={{ color: e.color }}>{e.label}</td>
                <td>{fmtPct(s.soc)}</td>
                <td>{s.tEquip.toFixed(0)}°C</td>
                <td>{fmtPct(s.util)}</td>
                <td>{s.link === "NONE" ? "—" : s.link.toLowerCase()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="group-h">Whole run <Badge kind="MODEL" text="Simulation — not flight validation" /></div>
      <div className="stats">
        <div className="stat"><div className="k">Jobs done</div><div className="n">{m.jobs_completed}/{m.jobs_total}</div></div>
        <div className="stat"><div className="k">Deadline misses</div><div className="n">{m.deadline_misses}</div></div>
        <div className="stat"><div className="k">Mean queue</div><div className="n">{fmtDur(m.mean_queue_time_s)}</div></div>
        <div className="stat"><div className="k">Utilization</div><div className="n">{fmtPct(m.utilization_mean)}</div></div>
        <div className="stat"><div className="k">Energy used</div><div className="n">{fmtKwh(m.energy_consumed_kwh)}</div></div>
        <div className="stat"><div className="k">Curtailed</div><div className="n">{fmtKwh(m.curtailed_kwh)}</div></div>
        <div className="stat"><div className="k">Throttled</div><div className="n">{(m.throttled_time_s / 60).toFixed(0)} min</div></div>
        <div className="stat"><div className="k">Power-limited</div><div className="n">{(m.power_limited_time_s / 60).toFixed(0)} min</div></div>
        <div className="stat"><div className="k">Outage</div><div className="n">{(m.outage_time_s / 60).toFixed(0)} min</div></div>
        <div className="stat"><div className="k">Network avail.</div><div className="n">{fmtPct(m.network_availability)}</div></div>
        <div className="stat"><div className="k">Compute avail.</div><div className="n">{fmtPct(m.compute_availability)}</div></div>
        <div className="stat"><div className="k">Work done</div><div className="n">{m.work_done_ref_acc_h.toFixed(0)} <span className="faint" style={{ fontSize: 10 }}>ref-acc·h</span></div></div>
      </div>
      <div className="group-h">Engine self-checks</div>
      <dl className="kv">
        <dt>Energy identity residual</dt><dd>{Number(checks.energy_identity_max_residual_kw).toExponential(1)} kW</dd>
        <dt>Battery update residual</dt><dd>{Number(checks.battery_update_max_residual_kwh).toExponential(1)} kWh</dd>
        <dt>Battery bounds</dt><dd>{checks.battery_bounds_ok ? "OK" : "VIOLATED"}</dd>
        <dt>Thermal bounds</dt><dd>{checks.thermal_bounds_ok ? "OK" : "VIOLATED"}</dd>
        <dt>Engine · result</dt><dd>v{res.raw.engine_version} · {res.hash.slice(0, 10)}</dd>
      </dl>
      <div className="group-h">Provenance</div>
      <dl className="kv">
        {Object.entries(res.raw.provenance).map(([k, v]) => (<Fragment key={k}><dt>{k}</dt><dd style={{ fontFamily: "var(--font-sans)", fontSize: 11 }}>{v}</dd></Fragment>))}
      </dl>
    </div>
  );
}
