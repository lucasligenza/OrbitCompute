"use client";
// Unified, beginner-friendly mission feed: every node, every subsystem, in plain language.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { buildFeed, nowIndex, type FeedItem } from "@/sim/feed";
import { fmtDur, fmtMet } from "@/sim/format";
import { useScenario } from "@/state/scenario";
import { timeStore, useSimTime, useTimeState } from "@/state/time";
import { useUi } from "@/state/ui";
import { Icon, type IconName } from "./viz/Icon";

const CAT_ICON: Record<string, IconName> = { orbit: "orbit", power: "bolt", thermal: "thermo", network: "antenna", compute: "chip", mission: "satellite" };
const SEV_COLOR: Record<string, string> = { critical: "#ef4444", warning: "#f5a524", nominal: "#3ecf8e", info: "#4da3ff" };
const MAX_ROWS = 1500;

function iconFor(it: FeedItem): IconName {
  if (it.id.startsWith("eclipse_enter")) return "moon";
  if (it.id.startsWith("eclipse_exit")) return "sun";
  if (it.severity === "critical") return "warning";
  return CAT_ICON[it.category];
}

const Row = memo(function Row({ it, past, nodeName, onPick }: { it: FeedItem; past: boolean; nodeName?: string; onPick: (it: FeedItem) => void }) {
  const col = SEV_COLOR[it.severity];
  return (
    <button className={`feed-row${past ? "" : " future"}`} onClick={() => onPick(it)} data-testid="event-row" title="Jump to this moment">
      <span className="feed-time mono">{fmtMet(it.t)}</span>
      <span className="feed-ico" style={{ color: col, borderColor: `${col}66`, background: `${col}14` }}>
        <Icon name={iconFor(it)} size={13} color={col} />
      </span>
      <span className="feed-body">
        <span className="feed-title">
          {it.title}
          {(it.severity === "critical" || it.severity === "warning") && <span className="feed-sev" style={{ color: col, borderColor: col }}>{it.severity}</span>}
          {nodeName && <span className="feed-node mono">{nodeName}</span>}
        </span>
        <span className="feed-meaning">{it.meaning}</span>
      </span>
    </button>
  );
});

function ComingUp({ items, t, onPick }: { items: FeedItem[]; t: number; onPick: (it: FeedItem) => void }) {
  const next = items.filter((x) => x.t > t + 0.5 && x.key && x.id !== "end").slice(0, 3);
  if (next.length === 0) return null;
  return (
    <div className="card pad coming" data-testid="coming-up">
      <div className="muted" style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 4 }}>Coming up</div>
      {next.map((it) => (
        <button key={it.id} className="coming-row" onClick={() => onPick(it)}>
          <Icon name={iconFor(it)} size={12} color={SEV_COLOR[it.severity]} />
          <span className="coming-title">{it.title}</span>
          <span className="mono muted">in {fmtDur(it.t - t)}</span>
        </button>
      ))}
    </div>
  );
}

export default function MissionFeed() {
  const res = useScenario((s) => s.result)!;
  const selectNode = useUi((s) => s.selectNode);
  const selectJob = useUi((s) => s.selectJob);
  const playing = useTimeState((s) => s.playing);
  const t = useSimTime(4);
  const [scope, setScope] = useState<"key" | "all">("key");
  const [node, setNode] = useState<number>(-2); // -2 = all nodes
  const all = useMemo(() => buildFeed(res), [res]);
  const multi = res.nodes.length > 1;
  const items = useMemo(() => {
    const f = all.filter((it) => (scope === "all" || it.key) && (node === -2 || it.node === node || it.node === -1));
    return f.slice(0, MAX_ROWS);
  }, [all, scope, node]);
  const nowIdx = nowIndex(items, t);
  const box = useRef<HTMLDivElement>(null);
  const userScrollAt = useRef(0);
  // Keep the "now" divider in view while playing (unless the user scrolled recently).
  useEffect(() => {
    const el = box.current;
    if (!el || !playing || performance.now() - userScrollAt.current < 6000) return;
    const marker = el.querySelector<HTMLElement>("[data-now]");
    if (marker) el.scrollTop = marker.offsetTop - el.clientHeight * 0.65;
  }, [nowIdx, playing]);
  useEffect(() => {
    const el = box.current;
    if (!el || playing) return;
    const marker = el.querySelector<HTMLElement>("[data-now]");
    if (marker && (marker.offsetTop < el.scrollTop || marker.offsetTop > el.scrollTop + el.clientHeight)) el.scrollTop = marker.offsetTop - el.clientHeight * 0.5;
  }, [nowIdx, playing]);

  const pick = (it: FeedItem) => {
    timeStore.getState().pause();
    timeStore.getState().seek(it.t);
    if (it.node >= 0) selectNode(it.node);
    if (it.job !== undefined && it.job >= 0) selectJob(it.job);
  };
  const keyCount = all.filter((x) => x.key).length;
  return (
    <div className="feed" data-testid="mission-feed">
      <div className="feed-controls">
        <div className="seg" role="group" aria-label="Feed scope">
          <button className={scope === "key" ? "on" : ""} onClick={() => setScope("key")} data-testid="feed-key">Key events</button>
          <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")} data-testid="feed-all">Everything</button>
        </div>
        {multi && (
          <select className="select" value={node} onChange={(e) => setNode(Number(e.target.value))} aria-label="Feed node filter" style={{ padding: "3px 6px" }}>
            <option value={-2}>All nodes</option>
            {res.nodes.map((n) => <option key={n.index} value={n.index}>{n.name}</option>)}
          </select>
        )}
        <span className="muted mono" style={{ marginLeft: "auto", fontSize: 10.5 }}>{scope === "key" ? keyCount : all.length} items</span>
      </div>
      <ComingUp items={items} t={t} onPick={pick} />
      <div className="feed-list" ref={box} onWheel={() => { userScrollAt.current = performance.now(); }}>
        {items.map((it, i) => (
          <div key={it.id}>
            <Row it={it} past={i <= nowIdx} nodeName={multi && it.node >= 0 ? res.nodes[it.node].name : undefined} onPick={pick} />
            {i === nowIdx && (
              <div className="feed-now" data-now>
                <span>NOW · {fmtMet(t)}</span>
              </div>
            )}
          </div>
        ))}
        {nowIdx < 0 && <div className="feed-now" data-now><span>NOW · {fmtMet(t)}</span></div>}
        {all.length > MAX_ROWS && scope === "all" && <div className="muted" style={{ padding: 8, fontSize: 11 }}>Showing the first {MAX_ROWS} items.</div>}
      </div>
    </div>
  );
}
