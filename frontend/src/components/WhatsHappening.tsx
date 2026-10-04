"use client";
import { useMemo } from "react";
import { useScenario } from "@/state/scenario";
import { timeStore, useSimTime } from "@/state/time";
import { useUi } from "@/state/ui";
import { explain, toneColor } from "@/sim/explain";
import { fmtDur } from "@/sim/format";

export default function WhatsHappening() {
  const res = useScenario((s) => s.result)!;
  const sel = useUi((s) => s.selectedNode);
  const open = useUi((s) => s.explainOpen);
  const setUi = useUi((s) => s.set);
  const selectNode = useUi((s) => s.selectNode);
  const t = useSimTime(10);
  const idx = Math.min(sel, res.nodes.length - 1);
  const ex = useMemo(() => explain(res, idx, t), [res, idx, t]);
  const cfg = res.raw.scenario.nodes[idx];

  if (!open) {
    return (
      <div className="panel explain collapsed" data-testid="explain-panel">
        <div className="panel-h"><button className="btn sm ghost" onClick={() => setUi({ explainOpen: true })}>What is happening? ◂</button></div>
      </div>
    );
  }
  return (
    <aside className="panel explain" data-testid="explain-panel" data-tutorial="explain" aria-label="What is happening">
      <div className="panel-h">
        <h3>What is happening?</h3>
        <span className="spacer" />
        {res.nodes.length > 1 ? (
          <select className="select" value={idx} onChange={(e) => selectNode(Number(e.target.value))} aria-label="Selected node">
            {res.nodes.map((n) => <option key={n.index} value={n.index}>{n.name}</option>)}
          </select>
        ) : null}
        <button className="btn sm ghost" aria-label="Collapse" onClick={() => setUi({ explainOpen: false })}>▸</button>
      </div>
      <div className="panel-b">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span className="mono" style={{ fontWeight: 700, fontSize: 13 }}>ORBITAL COMPUTE NODE {ex.node}</span>
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
          {cfg.compute.accelerator_count} × {res.raw.nodes[idx].derived.accelerator_class} · hypothetical node
        </div>
        {ex.why.length > 0 && (
          <div className="why" data-testid="why">
            {ex.why.slice(0, 3).map((w, i) => <p key={i}>{w}</p>)}
          </div>
        )}
        {ex.sections.map((sec) => (
          <div className="sec" key={sec.key} data-testid={`explain-${sec.key}`}>
            <div className="sec-h">
              <span className="t">{sec.title}</span>
              <span className="s" style={{ color: toneColor(sec.tone) }}>{sec.status}</span>
            </div>
            {sec.rows.map((r) => (
              <div className="row" key={r.label}>
                <span className="l">{r.label}</span>
                <span className="v" style={{ color: r.tone ? toneColor(r.tone) : undefined }}>{r.value}</span>
              </div>
            ))}
            {sec.note && <div className="faint" style={{ fontSize: 10.5, marginTop: 2 }}>{sec.note}</div>}
          </div>
        ))}
        {ex.next && (
          <button className="next-ev" onClick={() => { timeStore.getState().pause(); timeStore.getState().seek(ex.next!.t); }}
            title="Jump to this event">
            <span><span className="muted" style={{ fontSize: 10.5, letterSpacing: "0.1em" }}>NEXT EVENT </span><br />{ex.next.label}</span>
            <span className="mono">in {fmtDur(ex.next.in)}</span>
          </button>
        )}
      </div>
    </aside>
  );
}
