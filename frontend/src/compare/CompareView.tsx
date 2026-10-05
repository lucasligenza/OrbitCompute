"use client";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/Badge";
import TimeChart from "@/components/charts/TimeChart";
import { api } from "@/sim/api";
import { fmtDur, fmtKwh, fmtPct } from "@/sim/format";
import { prepare, type PreparedResult } from "@/sim/result";
import type { Scenario, SchedulerKey } from "@/sim/types";
import { useScenario } from "@/state/scenario";
import { useUi } from "@/state/ui";

const SCHED: { value: "" | SchedulerKey; label: string }[] = [
  { value: "", label: "as configured" }, { value: "fifo", label: "FIFO" }, { value: "priority", label: "Priority" },
  { value: "energy", label: "Energy-aware" }, { value: "thermal", label: "Thermal-aware" },
  { value: "deadline", label: "Deadline-aware" }, { value: "network", label: "Network-aware" },
];

interface Side { source: string; scheduler: "" | SchedulerKey }

/** Aggregate series across nodes so different architectures are comparable. */
function aggregate(res: PreparedResult) {
  const n = res.n;
  const soc = new Float64Array(n), util = new Float64Array(n), temp = new Float64Array(n).fill(-Infinity);
  const gen = new Float64Array(n), load = new Float64Array(n), work = new Float64Array(n), margin = new Float64Array(n).fill(Infinity);
  res.nodes.forEach((nd, m) => {
    const cfg = res.raw.scenario.nodes[m];
    for (let i = 0; i < n; i++) {
      soc[i] += (nd.s.soc[i] * 100) / res.nodes.length;
      util[i] += (nd.s.util[i] * 100) / res.nodes.length;
      temp[i] = Math.max(temp[i], nd.s.t_equip_c[i]);
      margin[i] = Math.min(margin[i], cfg.thermal.throttle_c - nd.s.t_equip_c[i]);
      gen[i] += nd.s.p_gen_kw[i];
      load[i] += nd.s.p_load_kw[i];
      work[i] += nd.s.work_rate_ref[i];
    }
  });
  let minMargin = Infinity;
  for (const v of margin) minMargin = Math.min(minMargin, v);
  return { soc, util, temp, gen, load, work, minMargin };
}

type Row = { key: string; label: string; fmt: (v: number) => string; better: "higher" | "lower" | "none"; get: (r: PreparedResult, a: ReturnType<typeof aggregate>) => number };
const ROWS: Row[] = [
  { key: "jobs_completed", label: "Completed workloads", fmt: (v) => v.toFixed(0), better: "higher", get: (r) => r.raw.metrics.jobs_completed },
  { key: "deadline_misses", label: "Deadline misses", fmt: (v) => v.toFixed(0), better: "lower", get: (r) => r.raw.metrics.deadline_misses },
  { key: "work", label: "Work done (ref-acc·h)", fmt: (v) => v.toFixed(0), better: "higher", get: (r) => r.raw.metrics.work_done_ref_acc_h },
  { key: "util", label: "Compute utilization", fmt: (v) => fmtPct(v), better: "higher", get: (r) => r.raw.metrics.utilization_mean },
  { key: "queue", label: "Mean queue time", fmt: (v) => fmtDur(v), better: "lower", get: (r) => r.raw.metrics.mean_queue_time_s },
  { key: "energy", label: "Energy consumed", fmt: (v) => fmtKwh(v), better: "none", get: (r) => r.raw.metrics.energy_consumed_kwh },
  { key: "eff", label: "Energy per ref-acc·h", fmt: (v) => (isFinite(v) ? `${v.toFixed(2)} kWh` : "—"), better: "lower", get: (r) => r.raw.metrics.energy_consumed_kwh / Math.max(r.raw.metrics.work_done_ref_acc_h, 1e-9) },
  { key: "curtailed", label: "Curtailed solar", fmt: (v) => fmtKwh(v), better: "lower", get: (r) => r.raw.metrics.curtailed_kwh },
  { key: "minsoc", label: "Minimum SOC", fmt: (v) => fmtPct(v), better: "higher", get: (r) => r.raw.metrics.min_soc },
  { key: "plim", label: "Power-limited time", fmt: (v) => fmtDur(v), better: "lower", get: (r) => r.raw.metrics.power_limited_time_s },
  { key: "outage", label: "Platform outage time", fmt: (v) => fmtDur(v), better: "lower", get: (r) => r.raw.metrics.outage_time_s },
  { key: "margin", label: "Min thermal margin", fmt: (v) => `${v.toFixed(1)} K`, better: "higher", get: (_r, a) => a.minMargin },
  { key: "throttle", label: "Thermal throttling time", fmt: (v) => fmtDur(v), better: "lower", get: (r) => r.raw.metrics.throttled_time_s },
  { key: "net", label: "Network availability", fmt: (v) => fmtPct(v), better: "higher", get: (r) => r.raw.metrics.network_availability },
  { key: "avail", label: "Compute availability", fmt: (v) => fmtPct(v), better: "higher", get: (r) => r.raw.metrics.compute_availability },
];

export default function CompareView() {
  const catalog = useScenario((s) => s.catalog)!;
  const draft = useScenario((s) => s.draft)!;
  const loadScenario = useScenario((s) => s.loadScenario);
  const setUi = useUi((s) => s.set);
  // A programmatic request (guided tour) pre-selects both sides and runs immediately.
  const [request] = useState(() => useUi.getState().compareRequest);
  const [a, setA] = useState<Side>(request?.a ?? { source: "current", scheduler: "fifo" });
  const [b, setB] = useState<Side>(request?.b ?? { source: "current", scheduler: "energy" });
  const [res, setRes] = useState<{ a: PreparedResult; b: PreparedResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const resolve = async (side: Side): Promise<Scenario> => {
    const base = side.source === "current" ? structuredClone(draft) : await api.preset(side.source);
    if (side.scheduler) base.sim.scheduler = side.scheduler;
    return base;
  };
  const runBoth = async (sideA: Side = a, sideB: Side = b) => {
    setBusy(true); setErr(null);
    try {
      const [sa, sb] = await Promise.all([resolve(sideA), resolve(sideB)]);
      const [ra, rb] = await Promise.all([api.simulate(sa), api.simulate(sb)]);
      setRes({ a: prepare(ra), b: prepare(rb) });
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  useEffect(() => {
    if (!request) return;
    useUi.getState().set({ compareRequest: null });
    const id = setTimeout(() => void runBoth(request.a, request.b), 0);
    return () => clearTimeout(id);
    // run once for the request captured at mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const agg = useMemo(() => (res ? { a: aggregate(res.a), b: aggregate(res.b) } : null), [res]);
  const duration = res ? Math.max(res.a.duration, res.b.duration) : 1;

  const sideCtl = (label: string, side: Side, set: (s: Side) => void, testId: string) => (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <b style={{ width: 14 }}>{label}</b>
      <select className="select" value={side.source} onChange={(e) => set({ ...side, source: e.target.value })} data-testid={`${testId}-source`}>
        <option value="current">Current design ({draft.name})</option>
        {catalog.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <select className="select" value={side.scheduler} onChange={(e) => set({ ...side, scheduler: e.target.value as Side["scheduler"] })} data-testid={`${testId}-scheduler`}>
        {SCHED.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
    </div>
  );

  const chart = (title: string, key: "soc" | "util" | "temp" | "load" | "work", unit: string, yMin?: number, yMax?: number) =>
    res && agg && (
      <div>
        <div className="group-h">{title}</div>
        <TimeChart dt={res.a.dt} duration={duration} height={92} unit={unit} yMin={yMin} yMax={yMax}
          series={[
            { data: agg.a[key], color: "#4da3ff", label: `A · ${res.a.raw.scenario.name} (${res.a.raw.scheduler_label})`, dt: res.a.dt },
            { data: agg.b[key], color: "#f5a524", label: `B · ${res.b.raw.scenario.name} (${res.b.raw.scheduler_label})`, dt: res.b.dt, dash: true },
          ]} />
      </div>
    );

  return (
    <div className="fullsheet" data-testid="compare-view">
      <div className="drawer-h">
        <h2>Compare scenarios</h2>
        <Badge kind="MODEL" text="Simulation — not flight validation" />
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => setUi({ overlay: null })} aria-label="Close compare">✕</button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", padding: "10px 18px", borderBottom: "1px solid var(--line)" }}>
        {sideCtl("A", a, setA, "cmp-a")}
        {sideCtl("B", b, setB, "cmp-b")}
        <button className="btn primary" onClick={() => runBoth()} disabled={busy} data-testid="cmp-run">{busy ? <><span className="spinner" /> Running…</> : "Run comparison"}</button>
        <span className="muted" style={{ fontSize: 11 }}>Quick:</span>
        <button className="btn sm" onClick={() => { setA({ source: "current", scheduler: "fifo" }); setB({ source: "current", scheduler: "energy" }); }}>FIFO vs energy-aware</button>
        <button className="btn sm" onClick={() => { setA({ source: "monolith-128", scheduler: "" }); setB({ source: "distributed-4x32", scheduler: "" }); }}>1 large vs 4 small</button>
        <button className="btn sm" onClick={() => { setA({ source: "large-training", scheduler: "priority" }); setB({ source: "large-training", scheduler: "thermal" }); }}>Priority vs thermal-aware</button>
      </div>
      {err && <div className="note" style={{ color: "var(--bad)", padding: "0 18px" }}>{err}</div>}
      {!res && !busy && <p className="note" style={{ padding: "14px 18px" }}>Choose two scenarios (or one scenario with two schedulers) and run. Timelines are synchronized: scrub either chart.</p>}
      {res && agg && (
        <div className="cmp-grid">
          <div>
            <table className="metrics" data-testid="cmp-table" data-tutorial="cmp-table">
              <thead><tr><th>Metric</th><th>A</th><th>B</th><th>B − A</th></tr></thead>
              <tbody>
                {ROWS.map((r) => {
                  const va = r.get(res.a, agg.a), vb = r.get(res.b, agg.b);
                  const d = vb - va;
                  const eq = Math.abs(d) < 1e-9 * Math.max(1, Math.abs(va));
                  const good = r.better === "none" || eq ? null : (r.better === "higher") === d > 0;
                  return (
                    <tr key={r.key}>
                      <td>{r.label}</td>
                      <td>{r.fmt(va)}</td>
                      <td>{r.fmt(vb)}</td>
                      <td className={good === null ? "" : good ? "better" : "worse"}>
                        {eq ? "=" : `${d > 0 ? "▲" : "▼"} ${r.fmt(Math.abs(d))}`}{good === null || eq ? "" : good ? " better" : " worse"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="note">A: {res.a.raw.scenario.nodes.length} node(s), {res.a.raw.scheduler_label}. B: {res.b.raw.scenario.nodes.length} node(s), {res.b.raw.scheduler_label}.
              Utilization and SOC are averaged across nodes; temperature is the hottest node.</p>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn sm" onClick={() => { loadScenario(res.a.raw.scenario); setUi({ overlay: null }); }}>Open A in scene</button>
              <button className="btn sm" onClick={() => { loadScenario(res.b.raw.scenario); setUi({ overlay: null }); }}>Open B in scene</button>
            </div>
          </div>
          <div>
            {chart("Mean battery SOC", "soc", "%", 0, 100)}
            {chart("Mean accelerator utilization", "util", "%", 0, 100)}
            {chart("Hottest equipment temperature", "temp", "°C")}
            {chart("Total bus load", "load", "kW")}
            {chart("Work rate", "work", "ref-acc")}
          </div>
        </div>
      )}
    </div>
  );
}
