"use client";
import { memo, useMemo } from "react";
import { Badge } from "@/components/Badge";
import TimeChart from "@/components/charts/TimeChart";
import { AdvancedHint } from "@/components/DetailToggle";
import Gauge from "@/components/viz/Gauge";
import { Icon, type IconName } from "@/components/viz/Icon";
import KpiTile, { Insight, SectionTitle } from "@/components/viz/KpiTile";
import { fmtDur, fmtGbit, fmtKw, fmtMet, fmtPct } from "@/sim/format";
import { cursorAt, jobPhaseAt, jobProgressAt, type JobPhase } from "@/sim/sample";
import type { PreparedNode, PreparedResult } from "@/sim/result";
import type { JobRecord, JobType, NodeConfig } from "@/sim/types";
import { timeStore } from "@/state/time";
import { useUi } from "@/state/ui";
import { useSelected } from "./hooks";

const TYPE_HUE: Record<JobType, [number, number]> = { inference: [210, 75], training: [265, 55], batch: [170, 55], background: [215, 10] };
const TYPE_ICON: Record<JobType, IconName> = { inference: "bolt", training: "layers", batch: "queue", background: "clock" };
export function jobColor(j: JobRecord) {
  const [h, sat] = TYPE_HUE[j.type];
  const l = 46 + ((j.idx * 37) % 20);
  return `hsl(${h} ${sat}% ${l}%)`;
}
const PHASE_LABEL: Record<JobPhase, string> = {
  pending: "Not yet arrived", uplink: "Uploading input", queued: "Queued", running: "Running", stalled: "Stalled: no link",
  paused: "Paused (preempted)", downlink: "Downloading result", completed: "Completed", rejected: "Rejected",
};

function ProgressRing({ f, color, size = 22 }: { f: number; color: string; size?: number }) {
  const r = 8, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden style={{ flex: "none" }}>
      <circle cx="10" cy="10" r={r} fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth="2.4" />
      <circle cx="10" cy="10" r={r} fill="none" stroke={color} strokeWidth="2.4" strokeDasharray={`${c * Math.min(f, 1)} ${c}`}
        strokeLinecap="round" transform="rotate(-90 10 10)" />
    </svg>
  );
}

const UtilChart = memo(function UtilChart({ res, nd }: { res: PreparedResult; nd: PreparedNode }) {
  const series = useMemo(() => [
    { data: Float64Array.from(nd.s.util, (v) => v * 100), color: "#4da3ff", label: "effective utilization", fill: true, step: true },
    { data: Float64Array.from(nd.s.alloc_frac, (v) => v * 100), color: "#8b95a3", label: "allocated", step: true, dash: true },
  ], [nd]);
  const queue = useMemo(() => [
    { data: nd.s.n_running, color: "#4da3ff", label: "running", step: true },
    { data: nd.s.n_queued, color: "#f5a524", label: "queued", step: true, fill: true },
  ], [nd]);
  return (
    <>
      <SectionTitle icon="chip">Utilization</SectionTitle>
      <TimeChart dt={res.dt} duration={res.duration} height={86} unit="%" yMin={0} yMax={100} series={series} bands={nd.raw.eclipse_windows} testId="util-chart" />
      <SectionTitle icon="queue">Jobs</SectionTitle>
      <TimeChart dt={res.dt} duration={res.duration} height={76} series={queue} />
    </>
  );
});

/** Lifecycle timeline: upload → queue → run segments → download, with deadline and now markers. */
function Lifecycle({ job, t, horizon }: { job: JobRecord; t: number; horizon: number }) {
  const t0 = job.arrival_s;
  const t1 = Math.max(job.completion_s ?? 0, job.deadline_s ?? 0, Math.min(t, horizon), (job.ready_s ?? t0) + 60, t0 + 600);
  const x = (v: number) => `${((Math.min(Math.max(v, t0), t1) - t0) / (t1 - t0)) * 100}%`;
  const w = (a: number, b: number) => `${((Math.min(b, t1) - Math.max(a, t0)) / (t1 - t0)) * 100}%`;
  const ready = job.ready_s ?? Math.min(t, horizon);
  return (
    <div className="lifecycle" aria-label="Job lifecycle timeline">
      <div className="lc-track">
        {ready > t0 && <div className="lc-seg up" style={{ left: x(t0), width: w(t0, ready) }} title="uploading input" />}
        {job.segments.map(([a, b, , , , st], i) => (
          <div key={i} className={`lc-seg run${st ? " stalled" : ""}`} style={{ left: x(a), width: w(a, b) }} title={st ? "stalled" : "running"} />
        ))}
        {job.compute_done_s !== null && (
          <div className="lc-seg down" style={{ left: x(job.compute_done_s), width: w(job.compute_done_s, job.completion_s ?? Math.min(t, horizon)) }} title="downloading result" />
        )}
        {job.deadline_s !== null && <div className="lc-mark dl" style={{ left: x(job.deadline_s) }} title="deadline" />}
        {t >= t0 && t <= t1 && <div className="lc-mark now" style={{ left: x(t) }} title="now" />}
      </div>
      <div className="lc-legend">
        <span><i className="up" />upload</span><span><i className="run" />compute</span><span><i className="down" />download</span>
        <span><i className="dl" />deadline</span><span className="mono">{fmtMet(t0)} → {fmtMet(t1)}</span>
      </div>
    </div>
  );
}

function Inspector({ job, res, cfg, t, adv }: { job: JobRecord; res: PreparedResult; cfg: NodeConfig; t: number; adv: boolean }) {
  const phase = jobPhaseAt(job, t);
  const p = jobProgressAt(job, t);
  const frac = p / job.work_ref_acc_h;
  const nd = res.nodes[job.node];
  const c = cursorAt(res, t);
  const alloc = nd?.raw.alloc[c.i]?.find((a) => a[0] === job.idx);
  const k = alloc?.[1] ?? 0;
  const sEff = nd ? nd.s.throttle[c.i] * nd.s.power_factor[c.i] : 0;
  const running = phase === "running";
  const comp = cfg.compute;
  const powerKw = running ? (k * (comp.max_w - comp.idle_w) * comp.host_overhead * sEff) / 1000 : 0;
  const rate = running ? k * comp.relative_throughput * sEff : 0;
  const eta = rate > 0 ? ((job.work_ref_acc_h - p) / rate) * 3600 : NaN;
  const color = jobColor(job);
  return (
    <div className="card raised pad inspector" data-testid="job-inspector" style={{ boxShadow: `var(--elev-2), 0 0 0 1px ${color}55` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ProgressRing f={frac} color={color} size={30} />
        <div style={{ minWidth: 0 }}>
          <div><b className="mono">{job.job_id}</b> <span className="muted">{job.name}</span></div>
          <div className="muted" style={{ fontSize: 11 }}>
            <Icon name={TYPE_ICON[job.type]} size={11} /> {job.type} · P{job.priority} · {PHASE_LABEL[phase]}
            {job.missed && (job.deadline_s ?? Infinity) <= t ? <span style={{ color: "var(--bad)" }}> · deadline missed</span> : null}
          </div>
        </div>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => useUi.getState().selectJob(null)} aria-label="Close job">×</button>
      </div>
      <Lifecycle job={job} t={t} horizon={res.duration} />
      <dl className="kv">
        <dt>Progress</dt><dd>{fmtPct(Math.min(frac, 1), 1)} of {job.work_ref_acc_h.toFixed(1)} ref-acc·h</dd>
        <dt>Est. completion</dt><dd>{isFinite(eta) ? `in ${fmtDur(eta)}` : job.completion_s !== null && t >= job.completion_s ? fmtMet(job.completion_s) : "-"}</dd>
        <dt>Deadline</dt><dd>{job.deadline_s === null ? "none" : `${fmtMet(job.deadline_s)} (${job.deadline_s - t >= 0 ? "in " + fmtDur(job.deadline_s - t) : "passed"})`}</dd>
        {adv && <><dt>Accelerators</dt><dd>{running ? `${k} / ${job.accelerators} requested` : `${job.accelerators} requested`}</dd></>}
        {adv && <><dt>Power use</dt><dd>{running ? fmtKw(powerKw) : "-"}</dd></>}
        {adv && <><dt>Network</dt><dd>{job.network_dependency}{job.input_gbit > 0 ? ` · in ${fmtGbit(job.input_gbit)}` : ""}{job.output_gbit > 0 ? ` · out ${fmtGbit(job.output_gbit)}` : ""}</dd></>}
        {adv && <><dt>Nominal estimate</dt><dd>{fmtDur(job.est_runtime_s)} · {job.est_energy_kwh.toFixed(1)} kWh</dd></>}
      </dl>
      {adv && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button className="btn sm" onClick={() => timeStore.getState().seek(job.arrival_s)}>Arrival</button>
          {job.first_start_s !== null && <button className="btn sm" onClick={() => timeStore.getState().seek(job.first_start_s!)}>First start</button>}
          {job.completion_s !== null && <button className="btn sm" onClick={() => timeStore.getState().seek(job.completion_s!)}>Completion</button>}
        </div>
      )}
    </div>
  );
}

/** Rack chassis: racks of up to 8 sleds × 8 accelerator cells. */
function Racks({ grid, jobs, selectedJob, onSelect, dim }: {
  grid: { job: number; stalled: boolean }[]; jobs: JobRecord[]; selectedJob: number | null; onSelect: (j: number) => void; dim: boolean;
}) {
  const sleds: { job: number; stalled: boolean }[][] = [];
  for (let i = 0; i < grid.length; i += 8) sleds.push(grid.slice(i, i + 8));
  const racks: (typeof sleds)[] = [];
  for (let i = 0; i < sleds.length; i += 8) racks.push(sleds.slice(i, i + 8));
  return (
    <div className="racks" data-testid="rack" style={{ opacity: dim ? 0.72 : 1, ["--cell" as string]: grid.length <= 128 ? "11px" : "8px" }}>
      {racks.map((rack, ri) => (
        <div key={ri} className="rackcard">
          <div className="rack-h mono">R{ri + 1}</div>
          {rack.map((sled, si) => {
            const active = sled.some((c) => c.job >= 0);
            return (
              <div key={si} className="sled">
                <i className={`led${active ? " on" : ""}`} />
                {sled.map((cell, ci) => {
                  const j = cell.job >= 0 ? jobs[cell.job] : null;
                  const col = j ? jobColor(j) : undefined;
                  return (
                    <div key={ci} className={`cell${cell.stalled ? " stalled" : ""}${j ? " busy" : ""}`}
                      title={j ? `${j.job_id}${cell.stalled ? " (stalled)" : ""}` : "idle"}
                      onClick={() => j && onSelect(j.idx)}
                      style={j ? { background: col, boxShadow: `0 0 6px ${col}`, outline: j.idx === selectedJob ? "1.5px solid #fff" : undefined } : undefined} />
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function ComputePanel() {
  const { res, nd, cfg, s, t } = useSelected(10);
  const adv = useUi((x) => x.detail === "advanced");
  const selectedJob = useUi((x) => x.selectedJob);
  const selectJob = useUi((x) => x.selectJob);
  const c = cursorAt(res, t);
  const alloc = useMemo(() => nd.raw.alloc[c.i] ?? [], [nd, c.i]);
  const N = cfg.compute.accelerator_count;
  const cells = Math.min(N, 256);
  const per = Math.max(1, Math.ceil(N / cells));
  const grid = useMemo(() => {
    const out: { job: number; stalled: boolean }[] = Array.from({ length: Math.ceil(N / per) }, () => ({ job: -1, stalled: false }));
    let acc = 0;
    for (const [j, k, st] of alloc) {
      for (let q = 0; q < k; q++, acc++) {
        const cell = Math.floor(acc / per);
        if (out[cell] && out[cell].job < 0) out[cell] = { job: j, stalled: !!st };
      }
    }
    return out;
  }, [alloc, N, per]);
  const running = alloc.map(([j, k, st]) => ({ job: res.jobs[j], k, stalled: !!st }));
  const queued = useMemo(
    () => nd.jobIdx.map((i) => res.jobs[i]).filter((j) => { const ph = jobPhaseAt(j, t); return ph === "queued" || ph === "paused" || ph === "uplink"; }),
    [nd, res, t],
  );
  const sel = selectedJob !== null ? res.jobs[selectedJob] : null;
  const clock = s.throttle * s.powerFactor;
  const throttled = clock < 0.999;
  const insight = s.nStalled > 0
    ? `${s.nStalled} realtime job${s.nStalled > 1 ? "s hold" : " holds"} accelerators but cannot progress without a link.`
    : throttled ? `Clocks are at ${fmtPct(clock)} (${s.throttle < 0.999 ? "thermal" : "power"} limit), so every job runs slower.`
      : queued.length > 0 && s.allocFrac > 0.95 ? `All accelerators are busy; ${queued.length} job${queued.length > 1 ? "s are" : " is"} waiting.`
        : undefined;
  const runList = running.slice(0, adv ? 14 : 4);
  return (
    <div data-testid="compute-panel">
      <div className="panel-title-row">
        <span className="mono" style={{ fontWeight: 600 }}>{nd.name}</span>
        <Badge kind="MODEL" text="Abstract accelerator model" />
      </div>
      <div className="gauges">
        <Gauge value={s.util} display={fmtPct(s.util)} label="Utilization" sub={`${N} accelerators`} color="#4da3ff" testId="util-gauge" />
        <Gauge value={Math.min(s.nRunning / 30, 1)} display={String(s.nRunning)} label="Running" sub={s.nStalled ? `${s.nStalled} stalled` : "jobs"} color="#7c8cff" />
        <Gauge value={Math.min(queued.length / 30, 1)} display={String(queued.length)} label="Waiting" sub="queued / uploading" color={queued.length > 10 ? "#f5a524" : "#8b95a3"} />
      </div>
      <div className="card pad" style={{ marginBottom: 8 }}>
        <div className="muted" style={{ fontSize: 10.5, marginBottom: 6, display: "flex", gap: 8 }}>
          <span>{N} × {res.raw.nodes[nd.index].derived.accelerator_class}{per > 1 ? ` · 1 cell = ${per}` : ""}</span>
          {throttled && <span style={{ color: "var(--warn)", marginLeft: "auto" }}><Icon name="clock" size={11} /> clocks {fmtPct(clock)}</span>}
        </div>
        <Racks grid={grid} jobs={res.jobs} selectedJob={selectedJob} onSelect={selectJob} dim={throttled} />
        <div style={{ display: "flex", gap: 10, fontSize: 10.5, marginTop: 6, flexWrap: "wrap" }} className="muted">
          {(Object.keys(TYPE_HUE) as JobType[]).map((ty) => (
            <span key={ty}><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: `hsl(${TYPE_HUE[ty][0]} ${TYPE_HUE[ty][1]}% 55%)`, marginRight: 4 }} />{ty}</span>
          ))}
          <span>▨ stalled</span>
        </div>
      </div>
      <Insight text={insight} />
      {sel && <Inspector job={sel} res={res} cfg={res.raw.scenario.nodes[sel.node] ?? cfg} t={t} adv={adv} />}
      <SectionTitle icon="chip" right={<span className="muted mono">{running.length}</span>}>Running</SectionTitle>
      <div className="joblist">
        {runList.map(({ job, k, stalled }) => {
          const p = jobProgressAt(job, t) / job.work_ref_acc_h;
          return (
            <button key={job.idx} className={`job${job.idx === selectedJob ? " sel" : ""}`} onClick={() => selectJob(job.idx)} data-testid="job-row">
              <ProgressRing f={p} color={jobColor(job)} />
              <span style={{ minWidth: 0 }}>
                <span className="mono">{job.job_id}</span> <span className="muted">{job.name}</span>
                <div className="muted" style={{ fontSize: 10.5 }}><Icon name={TYPE_ICON[job.type]} size={10} /> {job.type} · {fmtPct(Math.min(p, 1))}</div>
              </span>
              <span className="mono muted">{stalled ? "stalled" : `${k}×`}</span>
            </button>
          );
        })}
        {running.length === 0 && <span className="muted">No jobs running.</span>}
        {running.length > runList.length && <span className="muted" style={{ fontSize: 11 }}>+ {running.length - runList.length} more</span>}
      </div>
      {!adv && <AdvancedHint what="waiting queue, utilization history, job power and network details" />}
      {adv && (
        <>
          <SectionTitle icon="queue" right={<span className="muted mono">{queued.length}</span>}>Waiting</SectionTitle>
          <div className="joblist">
            {queued.slice(0, 8).map((job) => (
              <button key={job.idx} className={`job${job.idx === selectedJob ? " sel" : ""}`} onClick={() => selectJob(job.idx)}>
                <ProgressRing f={jobProgressAt(job, t) / job.work_ref_acc_h} color={jobColor(job)} />
                <span><span className="mono">{job.job_id}</span> <span className="muted">P{job.priority} · {PHASE_LABEL[jobPhaseAt(job, t)]}</span></span>
                <span className="mono muted">{job.accelerators}×</span>
              </button>
            ))}
            {queued.length > 8 && <span className="muted" style={{ fontSize: 11 }}>+ {queued.length - 8} more</span>}
          </div>
          <div className="kpis">
            <KpiTile icon="check" label="Done (run)" value={String(nd.raw.metrics.jobs_completed)} />
            <KpiTile icon="warning" label="Deadline misses" value={String(nd.raw.metrics.deadline_misses)} />
            <KpiTile icon="clock" label="Mean queue" value={fmtDur(nd.raw.metrics.mean_queue_time_s)} />
          </div>
          <UtilChart res={res} nd={nd} />
        </>
      )}
    </div>
  );
}
