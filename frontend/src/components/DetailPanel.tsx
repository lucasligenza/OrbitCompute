"use client";
import { useUi, MODES } from "@/state/ui";
import OrbitPanel from "@/panels/OrbitPanel";
import PowerPanel from "@/panels/PowerPanel";
import ThermalPanel from "@/panels/ThermalPanel";
import ComputePanel from "@/panels/ComputePanel";
import NetworkPanel from "@/panels/NetworkPanel";
import SystemPanel from "@/panels/SystemPanel";

export default function DetailPanel() {
  const mode = useUi((s) => s.mode);
  const open = useUi((s) => s.detailOpen);
  const setUi = useUi((s) => s.set);
  const m = MODES.find((x) => x.key === mode)!;
  if (!open) {
    return (
      <div className="panel detail collapsed" data-testid="detail-panel">
        <div className="panel-h"><button className="btn sm ghost" onClick={() => setUi({ detailOpen: true })}>▸ {m.label} detail</button></div>
      </div>
    );
  }
  return (
    <section className="panel detail" data-testid="detail-panel" data-mode={mode} data-tutorial="detail" aria-label={`${m.label} detail`}>
      <div className="panel-h">
        <h3>{m.label}</h3>
        <span className="faint" style={{ fontSize: 11 }}>{m.hint}</span>
        <span className="spacer" />
        <button className="btn sm ghost" aria-label="Collapse" onClick={() => setUi({ detailOpen: false })}>◂</button>
      </div>
      <div className="panel-b">
        {mode === "orbit" && <OrbitPanel />}
        {mode === "power" && <PowerPanel />}
        {mode === "thermal" && <ThermalPanel />}
        {mode === "compute" && <ComputePanel />}
        {mode === "network" && <NetworkPanel />}
        {mode === "system" && <SystemPanel />}
      </div>
    </section>
  );
}
