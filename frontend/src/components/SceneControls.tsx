"use client";
import { useUi } from "@/state/ui";

/** Camera and graphics controls floating over the scene (bottom-right). */
export default function SceneControls() {
  const follow = useUi((s) => s.follow);
  const quality = useUi((s) => s.quality);
  const showClouds = useUi((s) => s.showClouds);
  const set = useUi((s) => s.set);
  const setQuality = useUi((s) => s.setQuality);
  return (
    <div className="scene-controls" data-testid="scene-controls">
      <button className={`btn sm${follow ? " primary" : ""}`} onClick={() => set({ follow: !follow })} title="Camera follows the selected node (or double-click a spacecraft)" data-testid="follow">
        {follow ? "Following" : "Follow node"}
      </button>
      <button className="btn sm" onClick={() => set({ cameraNonce: useUi.getState().cameraNonce + 1 })} title="Reset camera" data-testid="reset-view">
        Reset view
      </button>
      <div className="seg" role="group" aria-label="Graphics quality">
        {(["high", "low"] as const).map((q) => (
          <button key={q} className={quality === q ? "on" : ""} onClick={() => setQuality(q)} data-testid={`quality-${q}`}>{q}</button>
        ))}
      </div>
      {quality === "high" && (
        <label className="muted" title="Illustrative procedural clouds (not weather data)">
          <input type="checkbox" checked={showClouds} onChange={(e) => set({ showClouds: e.target.checked })} /> clouds
        </label>
      )}
    </div>
  );
}
