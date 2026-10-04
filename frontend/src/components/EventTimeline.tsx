"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useScenario } from "@/state/scenario";
import { timeStore, useSimTime } from "@/state/time";
import { useUi } from "@/state/ui";
import { fmtMet } from "@/sim/format";
import type { SimEvent } from "@/sim/types";

const CATS = ["orbit", "power", "thermal", "network", "compute"] as const;

export default function EventTimeline() {
  const res = useScenario((s) => s.result)!;
  const sel = useUi((s) => s.selectedNode);
  const selectJob = useUi((s) => s.selectJob);
  const [cats, setCats] = useState<Set<string>>(new Set(["orbit", "power", "thermal", "network"]));
  const [allNodes, setAllNodes] = useState(false);
  const t = useSimTime(4);
  const list = useMemo(
    () => res.events.filter((e) => cats.has(e.category) && (allNodes || e.node === sel || e.node < 0)),
    [res, cats, allNodes, sel],
  );
  const curIdx = useMemo(() => {
    let lo = 0, hi = list.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].t <= t) lo = m + 1; else hi = m; }
    return lo - 1;
  }, [list, t]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(`[data-i="${Math.max(curIdx, 0)}"]`);
    if (el && box.current) box.current.scrollTop = el.offsetTop - box.current.clientHeight / 2;
  }, [curIdx]);

  const go = (e: SimEvent) => {
    timeStore.getState().pause();
    timeStore.getState().seek(e.t);
    if (e.job !== undefined) selectJob(e.job);
  };
  const toggle = (c: string) => {
    const n = new Set(cats);
    if (n.has(c)) n.delete(c); else n.add(c);
    setCats(n);
  };
  return (
    <div data-testid="event-timeline">
      <div className="events-h">
        <span className="muted" style={{ fontSize: 11 }}>EVENTS</span>
        {CATS.map((c) => (
          <button key={c} className={`chip${cats.has(c) ? " on" : ""}`} onClick={() => toggle(c)}>{c}</button>
        ))}
        {res.nodes.length > 1 && (
          <button className={`chip${allNodes ? " on" : ""}`} onClick={() => setAllNodes(!allNodes)}>all nodes</button>
        )}
        <span className="spacer" />
        <span className="muted mono" style={{ fontSize: 11 }}>{list.length} events · click to jump</span>
      </div>
      <div className="events" ref={box} style={{ position: "relative" }}>
        {list.map((e, i) => (
          <button key={i} data-i={i} className={`ev${i < curIdx ? " past" : ""}${i === curIdx ? " current" : ""}`}
            onClick={() => go(e)} data-testid="event-row">
            <span className="mono muted">{fmtMet(e.t)}</span>
            <span className={`sev ${e.severity}`} aria-label={e.severity} />
            <span>{e.label}</span>
            <span className="muted" style={{ fontSize: 11 }}>{e.detail}</span>
          </button>
        ))}
        {list.length === 0 && <div className="muted" style={{ padding: "8px 14px" }}>No events in the selected categories.</div>}
      </div>
    </div>
  );
}
