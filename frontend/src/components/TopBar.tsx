"use client";
import { useScenario } from "@/state/scenario";
import { useSimTime } from "@/state/time";
import { MODES, useUi } from "@/state/ui";
import { fmtUtc } from "@/sim/format";
import { Badge } from "./Badge";
import { Icon, type IconName } from "./viz/Icon";

const MODE_ICON: Record<string, IconName> = { orbit: "orbit", power: "bolt", thermal: "thermo", compute: "chip", network: "antenna", system: "layers" };

function Clock() {
  const t = useSimTime(5);
  const res = useScenario((s) => s.result);
  if (!res) return null;
  return (
    <div className="utc" data-testid="utc" title="Simulation time (UTC)">
      {(() => { const u = fmtUtc(res.epochMs, t); return <><span className="date">{u.slice(0, 11)}</span>{u.slice(11)}</>; })()}
    </div>
  );
}

export default function TopBar() {
  const mode = useUi((s) => s.mode);
  const setMode = useUi((s) => s.setMode);
  const overlay = useUi((s) => s.overlay);
  const setUi = useUi((s) => s.set);
  const catalog = useScenario((s) => s.catalog);
  const draft = useScenario((s) => s.draft);
  const loadPreset = useScenario((s) => s.loadPreset);
  const result = useScenario((s) => s.result);

  return (
    <header className="topbar">
      <div className="brand">
        <b>ORBITCOMPUTE</b>
        <span>AI compute infrastructure in orbit · simulation</span>
      </div>
      <select
        className="select"
        aria-label="Scenario preset"
        data-testid="preset-select"
        data-tutorial="presets"
        value={draft?.preset_id ?? ""}
        onChange={(e) => e.target.value && loadPreset(e.target.value)}
      >
        {!draft?.preset_id && <option value="">{draft?.name ?? "Custom scenario"}</option>}
        {catalog?.scenarios.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {draft && <span className="prov"><Badge kind={draft.provenance} /></span>}
      <nav className="tabs" role="tablist" aria-label="Visualization mode" data-tutorial="modes">
        {MODES.map((m, i) => (
          <button
            key={m.key}
            role="tab"
            aria-selected={mode === m.key}
            className={`tab${mode === m.key ? " on" : ""}`}
            title={`${m.hint} (${i + 1})`}
            data-testid={`mode-${m.key}`}
            onClick={() => setMode(m.key)}
          >
            <Icon name={MODE_ICON[m.key]} size={12} />
            <span className="tab-l">{m.label}</span>
          </button>
        ))}
      </nav>
      <div className="spacer" />
      <Clock />
      {result && <span className="badge sched-badge" title="Scheduler in this result">{result.raw.scheduler_label}</span>}
      <button className={`btn${overlay === "design" ? " primary" : ""}`} data-testid="open-design" data-tutorial="design"
        onClick={() => setUi({ overlay: overlay === "design" ? null : "design" })}>
        Design
      </button>
      <button className={`btn${overlay === "compare" ? " primary" : ""}`} data-testid="open-compare" data-tutorial="compare"
        onClick={() => setUi({ overlay: overlay === "compare" ? null : "compare" })}>
        Compare
      </button>
      <button className="btn ghost" aria-label="Open tutorial" title="Tutorial" data-testid="open-tutorial"
        onClick={() => setUi({ tourMenu: true })}>
        ?
      </button>
    </header>
  );
}
