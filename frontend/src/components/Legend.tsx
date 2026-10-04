"use client";
import { legendFor } from "@/scene/encoding";
import { useUi } from "@/state/ui";

export default function Legend() {
  const mode = useUi((s) => s.mode);
  const showGrid = useUi((s) => s.showGrid);
  const showTracks = useUi((s) => s.showGroundTracks);
  const setUi = useUi((s) => s.set);
  const lg = legendFor(mode);
  return (
    <div className="panel legend" data-testid="legend">
      <div className="muted" style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 4 }}>{lg.title}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", maxWidth: 360 }}>
        {lg.items.map((it) => (
          <span key={it.label} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11 }}>
            {it.shape === "line" || it.shape === "dash" ? (
              <svg width="16" height="6"><line x1="0" y1="3" x2="16" y2="3" stroke={it.color} strokeWidth="2" strokeDasharray={it.shape === "dash" ? "3 3" : undefined} /></svg>
            ) : it.shape === "band" ? (
              <i style={{ width: 14, height: 9, background: it.color, border: "1px solid #333a66", display: "inline-block" }} />
            ) : (
              <i style={{ width: 8, height: 8, borderRadius: 2, background: it.color, display: "inline-block" }} />
            )}
            {it.label}
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 6, fontSize: 11 }} className="muted">
        <label><input type="checkbox" checked={showGrid} onChange={(e) => setUi({ showGrid: e.target.checked })} /> lat/lon grid</label>
        <label><input type="checkbox" checked={showTracks} onChange={(e) => setUi({ showGroundTracks: e.target.checked })} /> ground tracks</label>
        <span className="faint">spacecraft glyphs not to scale</span>
      </div>
    </div>
  );
}
