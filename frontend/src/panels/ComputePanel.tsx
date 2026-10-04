"use client";
import { memo, useMemo } from "react";
import { Badge } from "@/components/Badge";
import TimeChart from "@/components/charts/TimeChart";
import { fmtDur, fmtGbit, fmtKw, fmtMet, fmtPct } from "@/sim/format";
import { cursorAt, jobPhaseAt, jobProgressAt, type JobPhase } from "@/sim/sample";
import type { PreparedNode, PreparedResult } from "@/sim/result";
import type { JobRecord, JobType, NodeConfig } from "@/sim/types";
import { timeStore } from "@/state/time";
import { useUi } from "@/state/ui";
import { useSelected } from "./hooks";

const TYPE_HUE: Record<JobType, [number, number]> = { inference: [210, 70], training: [265, 45], batch: [170, 45], background: [215, 8] };
export function jobColor(j: JobRecord) {
  const [h, sat] = TYPE_HUE[j.type];
  const l = 42 + ((j.idx * 37) % 24);
  return `hsl(${h} ${sat}% ${l}%)`;
}
const PHASE_LABEL: Record<JobPhase, string> = {
  pending: "Not yet arrived", uplink: "Uploading input", queued: "Queued", running: "Running", stalled: "Stalled — no link",
  paused: "Paused (preempted)", downlink: "Downloading result", completed: "Completed", rejected: "Rejected",
};

const UtilChart = memo(function UtilChart({ res, nd }: { res: PreparedResult; nd: PreparedNode }) {
  const series = useMemo(() => [
    { data: Float64Array.from(nd.s.util, (v) => v * 100), color: "#4da3ff", label: "effective utilization", fill: true, step: true },
    { data: Float64Array.from(nd.s.alloc_frac, (v) => v * 100), color: "#8b95a3", label: "allocated", step: true, dash: true },
  ], [nd]);
  const queue = useMemo(() => [
    { data: nd.s.n_running, color: "#4da3ff", label: "running", step: true },
    { data: nd.s.n_queued, color: "#f5a524", label: "queued", step: true },
  ], [nd]);
  return (
    <>
      <div className="group-h">Utilization</div>
      <TimeChart dt={res.dt} duration={res.duration} height={80} unit="%" yMin={0} yMax={100} series={series} bands={nd.raw.eclipse_windows} testId="util-chart" />
      <div className="group-h">Jobs</div>
      <TimeChart dt={res.dt} duration={res.duration} height={70} series={queue} />
    </>
  );
});

function Inspector({ job, res, cfg, t }: { job: JobRecord; res: PreparedResult; cfg: NodeConfig; t: number }) {
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
  return (
    <div style={{ border: "1px solid var(--line-2)", borderRadius: 6, padding: 10, marginTop: 8 }} data-testid="job-inspector">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <i style={{ width: 10, height: 10, borderRadius: 2, background: jobColor(job), display: "inline-block" }} />
        <b className="mono">{job.job_id}</b>
        <span className="muted">{job.name}</span>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => useUi.getState().selectJob(null)} aria-label="Close job">×</button>
      </div>
      <div className="bar" style={{ margin: "8px 0 6px" }}><i style={{ width: fmtPct(Math.min(frac, 1)) }} /></div>
      <dl className="kv">
        <dt>Status</dt><dd>{PHASE_LABEL[phase]}{job.missed && (job.deadline_s ?? Infinity) <= t ? " · deadline missed" : ""}</dd>
        <dt>Type · priority</dt><dd>{job.type} · P{job.priority}</dd>
        <dt>Progress</dt><dd>{fmtPct(Math.min(frac, 1), 1)} of {job.work_ref_acc_h.toFixed(1)} ref-acc·h</dd>
        <dt>Accelerators</dt><dd>{running ? `${k} / ${job.accelerators} requested` : `${job.accelerators} requested`}</dd>
        <dt>Power use</dt><dd>{running ? fmtKw(powerKw) : "—"}</dd>
        <dt>Est. completion</dt><dd>{isFinite(eta) ? `in ${fmtDur(eta)}` : job.completion_s !== null && t >= job.completion_s ? fmtMet(job.completion_s) : "—"}</dd>
        <dt>Deadline</dt><dd>{job.deadline_s === null ? "none" : `${fmtMet(job.deadline_s)} (${job.deadline_s - t >= 0 ? "in " + fmtDur(job.deadline_s - t) : "passed"})`}</dd>
        <dt>Network</dt><dd>{job.network_dependency}{job.input_gbit > 0 ? ` · in ${fmtGbit(job.input_gbit)}` : ""}{job.output_gbit > 0 ? ` · out ${fmtGbit(job.output_gbit)}` : ""}</dd>
        <dt>Nominal estimate</dt><dd>{fmtDur(job.est_runtime_s)} · {job.est_energy_kwh.toFixed(1)} kWh</dd>
      </dl>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button className="btn sm" onClick={() => timeStore.getState().seek(job.arrival_s)}>Arrival</button>
        {job.first_start_s !== null && <button className="btn sm" onClick={() => timeStore.getState().seek(job.first_start_s!)}>First start</button>}
        {job.completion_s !== null && <button className="btn sm" onClick={() => timeStore.getState().seek(job.completion_s!)}>Completion</button>}
      </div>
    </div>
  );
}

export default function ComputePanel() {
  const { res, nd, cfg, s, t } = useSelected(10);
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
  const throttled = s.throttle < 0.999 || s.powerFactor < 0.999;
  return (
    <div data-testid="compute-panel">
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
        <span className="mono" style={{ fontWeight: 600 }}>{nd.name}</span>
        <Badge kind="MODEL" text="Abstract accelerator model" />
        <span className="spacer" />
        <span className="mono">{fmtPct(s.util)} util</span>
      </div>
      <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
        {N} × {res.raw.nodes[nd.index].derived.accelerator_class} {per > 1 ? `· 1 cell = ${per} accelerators` : ""}
        {throttled && <span style={{ color: "var(--warn)" }}> · clocks at {fmtPct(s.throttle * s.powerFactor)}</span>}
      </div>
      <div className="rack" style={{ gridTemplateColumns: `repeat(${Math.min(16, grid.length)}, 1fr)`, opacity: throttled ? 0.75 : 1 }} data-testid="rack">
        {grid.map((g, i) => (
          <div key={i} className={`cell${g.stalled ? " stalled" : ""}`}
            title={g.job >= 0 ? `${res.jobs[g.job].job_id}${g.stalled ? " (stalled)" : ""}` : "idle"}
            onClick={() => g.job >= 0 && selectJob(g.job)}
            style={g.job >= 0 ? { background: jobColor(res.jobs[g.job]), outline: g.job === selectedJob ? "1.5px solid #fff" : undefined } : undefined} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, fontSize: 10.5, marginTop: 6 }} className="muted">
        {(Object.keys(TYPE_HUE) as JobType[]).map((ty) => (
          <span key={ty}><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: `hsl(${TYPE_HUE[ty][0]} ${TYPE_HUE[ty][1]}% 52%)`, marginRight: 4 }} />{ty}</span>
        ))}
        <span>▨ stalled</span>
      </div>
      {sel && <Inspector job={sel} res={res} cfg={res.raw.scenario.nodes[sel.node] ?? cfg} t={t} />}
      <div className="group-h">Running ({running.length})</div>
      <div className="joblist">
        {running.slice(0, 12).map(({ job, k, stalled }) => {
          const p = jobProgressAt(job, t) / job.work_ref_acc_h;
          return (
            <button key={job.idx} className={`job${job.idx === selectedJob ? " sel" : ""}`} onClick={() => selectJob(job.idx)} data-testid="job-row">
              <i style={{ width: 8, height: 8, borderRadius: 2, background: jobColor(job) }} />
              <span>
                <span className="mono">{job.job_id}</span> <span className="muted">{job.name}</span>
                <div className="bar" style={{ marginTop: 3 }}><i style={{ width: fmtPct(Math.min(p, 1)) }} /></div>
              </span>
              <span className="mono muted">{stalled ? "stalled" : `${k}×`}</span>
            </button>
          );
        })}
        {running.length === 0 && <span className="muted">No jobs running.</span>}
      </div>
      <div className="group-h">Waiting ({queued.length})</div>
      <div className="joblist">
        {queued.slice(0, 8).map((job) => (
          <button key={job.idx} className={`job${job.idx === selectedJob ? " sel" : ""}`} onClick={() => selectJob(job.idx)}>
            <i style={{ width: 8, height: 8, borderRadius: 2, background: jobColor(job) }} />
            <span><span className="mono">{job.job_id}</span> <span className="muted">P{job.priority} · {PHASE_LABEL[jobPhaseAt(job, t)]}</span></span>
            <span className="mono muted">{job.accelerators}×</span>
          </button>
        ))}
        {queued.length > 8 && <span className="muted" style={{ fontSize: 11 }}>+ {queued.length - 8} more</span>}
      </div>
      <UtilChart res={res} nd={nd} />
    </div>
  );
}
