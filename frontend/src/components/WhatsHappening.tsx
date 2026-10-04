"use client";
import { useMemo } from "react";
import { useScenario } from "@/state/scenario";
import { timeStore, useSimTime } from "@/state/time";
import { useUi } from "@/state/ui";
import { explain, toneColor } from "@/sim/explain";
import { fmtC, fmtDur, fmtKw, fmtPct } from "@/sim/format";
import DetailToggle from "./DetailToggle";
import MissionFeed from "./MissionFeed";
import { Icon, type IconName } from "./viz/Icon";

const SEC_ICON: Record<string, IconName> = { sun: "sun", power: "bolt", compute: "chip", thermal: "thermo", network: "antenna" };

export default function WhatsHappening() {
  const res = useScenario((s) => s.result)!;
  const sel = useUi((s) => s.selectedNode);
  const open = useUi((s) => s.explainOpen);
  const adv = useUi((s) => s.detail === "advanced");
  const setUi = useUi((s) => s.set);
  const tab = useUi((s) => s.rightTab);
  const selectNode = useUi((s) => s.selectNode);
  const t = useSimTime(10);
  const idx = Math.min(sel, res.nodes.length - 1);
  const ex = useMemo(() => explain(res, idx, t), [res, idx, t]);
  const cfg = res.raw.scenario.nodes[idx];
  const s = ex.sample;

  if (!open) {
    return (
      <div className="panel explain collapsed" data-testid="explain-panel">
        <div className="panel-h"><button className="btn sm ghost" onClick={() => setUi({ explainOpen: true })}>◂ Now · Feed</button></div>
      </div>
    );
  }
  const sunIcon: IconName = s.illum < 0.5 ? "moon" : "sun";
  return (
    <aside className={`panel explain${tab === "feed" ? " tall" : ""}`} data-testid="explain-panel" data-tutorial="explain" aria-label="What is happening">
      <div className="panel-h">
        <div className="rtabs" role="tablist" aria-label="Right panel">
          <button role="tab" aria-selected={tab === "now"} className={tab === "now" ? "on" : ""} onClick={() => setUi({ rightTab: "now" })} data-testid="tab-now">
            <Icon name="satellite" size={12} /> Now
          </button>
          <button role="tab" aria-selected={tab === "feed"} className={tab === "feed" ? "on" : ""} onClick={() => setUi({ rightTab: "feed" })} data-testid="tab-feed" data-tutorial="feed" title="Mission feed: every event in plain language">
            <Icon name="queue" size={12} /> Feed
          </button>
        </div>
        <span className="spacer" />
        {tab === "now" && <DetailToggle testPrefix="explain" />}
        <button className="btn sm ghost" aria-label="Collapse" onClick={() => setUi({ explainOpen: false })}>▸</button>
      </div>
      {tab === "feed" ? <MissionFeed /> : (
      <div className="panel-b">
        <div className="sr-only">What is happening?</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="satellite" size={16} color="var(--accent)" />
          <span className="mono" style={{ fontWeight: 700, fontSize: 13 }}>ORBITAL COMPUTE NODE {ex.node}</span>
          <span className="spacer" />
          {res.nodes.length > 1 && (
            <select className="select" value={idx} onChange={(e) => selectNode(Number(e.target.value))} aria-label="Selected node" style={{ padding: "3px 6px" }}>
              {res.nodes.map((n) => <option key={n.index} value={n.index}>{n.name}</option>)}
            </select>
          )}
        </div>
        <div className="muted" style={{ fontSize: 11, margin: "2px 0 0 24px" }}>
          {cfg.compute.accelerator_count} × {res.raw.nodes[idx].derived.accelerator_class} · hypothetical node
        </div>

        {/* status chips: one per subsystem, icon + text + colour */}
        <div className="chips" data-testid="status-chips">
          {ex.sections.map((sec) => (
            <div key={sec.key} className={`schip${sec.key === "network" ? " wide" : ""}`} style={{ boxShadow: `inset 2px 0 0 ${toneColor(sec.tone)}` }}>
              <Icon name={sec.key === "sun" ? sunIcon : SEC_ICON[sec.key]} size={15} color={toneColor(sec.tone)} />
              <div style={{ minWidth: 0 }}>
                <div className="k">{sec.title}</div>
                <div className="s" style={{ color: toneColor(sec.tone) }} title={sec.status}>{sec.status}</div>
              </div>
            </div>
          ))}
        </div>

        {ex.why.length > 0 && (
          <div className="why" data-testid="why">
            {ex.why.slice(0, adv ? 4 : 2).map((w, i) => <p key={i}>{w}</p>)}
          </div>
        )}

        {!adv && (
          <div className="bignums card" data-testid="big-numbers">
            <div className="bignum"><div className="n" style={{ color: "#ffd98a" }}>{fmtKw(s.pGen, 0)}</div><div className="k">solar</div></div>
            <div className="bignum"><div className="n" style={{ color: s.pBatt < -0.05 ? "#f5a524" : "#3ecf8e" }}>{fmtPct(s.soc)}</div><div className="k">{s.pBatt > 0.05 ? "charging" : s.pBatt < -0.05 ? "on battery" : "battery"}</div></div>
            <div className="bignum"><div className="n" style={{ color: "#4da3ff" }}>{fmtPct(s.util)}</div><div className="k">compute</div></div>
            <div className="bignum"><div className="n" style={{ color: toneColor(ex.sections[3].tone) }}>{fmtC(s.tEquip).replace(" °C", "°")}</div><div className="k">equipment</div></div>
          </div>
        )}

        {adv && ex.sections.map((sec) => (
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
        {!adv && (
          /* keep compact power status addressable in Simple view (tests and screen readers) */
          <div className="sr-only" data-testid="explain-power">{ex.sections.find((x) => x.key === "power")?.status}</div>
        )}

        {ex.next && (
          <button className="next-ev" onClick={() => { timeStore.getState().pause(); timeStore.getState().seek(ex.next!.t); }}
            title="Jump to this event">
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Icon name="clock" size={14} color="var(--muted)" />
              <span><span className="muted" style={{ fontSize: 10.5, letterSpacing: "0.1em" }}>NEXT EVENT</span><br />{ex.next.label}</span>
            </span>
            <span className="mono">in {fmtDur(ex.next.in)}</span>
          </button>
        )}
      </div>
      )}
    </aside>
  );
}
