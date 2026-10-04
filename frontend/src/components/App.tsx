"use client";
import { useEffect } from "react";
import OrbitScene from "@/scene/OrbitScene";
import { useScenario } from "@/state/scenario";
import { timeStore } from "@/state/time";
import { useUi } from "@/state/ui";
import TopBar from "./TopBar";
import TimeControls from "./TimeControls";
import WhatsHappening from "./WhatsHappening";
import DetailPanel from "./DetailPanel";
import Legend from "./Legend";
import SceneControls from "./SceneControls";
import DesignDrawer from "@/editor/DesignDrawer";
import CompareView from "@/compare/CompareView";
import Tutorial, { maybeStartTutorial } from "@/tutorial/Tutorial";

export default function App() {
  const init = useScenario((s) => s.init);
  const status = useScenario((s) => s.status);
  const error = useScenario((s) => s.error);
  const hasResult = useScenario((s) => !!s.result);
  const overlay = useUi((s) => s.overlay);

  useEffect(() => {
    init().then(() => maybeStartTutorial());
  }, [init]);

  // Keyboard: space = play/pause, arrows = step, 1-6 = modes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const ts = timeStore.getState();
      if (e.code === "Space") { e.preventDefault(); ts.toggle(); }
      else if (e.key === "ArrowRight") ts.seek(ts.t + (e.shiftKey ? 600 : 60));
      else if (e.key === "ArrowLeft") ts.seek(ts.t - (e.shiftKey ? 600 : 60));
      else if (/^[1-6]$/.test(e.key)) {
        const modes = ["orbit", "power", "thermal", "compute", "network", "system"] as const;
        useUi.getState().setMode(modes[Number(e.key) - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <TopBar />
      <div className="stage">
        <OrbitScene />
        {hasResult && (
          <>
            <DetailPanel />
            <WhatsHappening />
            <Legend />
            <SceneControls />
          </>
        )}
        {status === "running" && (
          <div className="banner" role="status"><span className="spinner" /> &nbsp;Running deterministic simulation…</div>
        )}
        {status === "loading" && !hasResult && <div className="banner" role="status"><span className="spinner" /> &nbsp;Loading…</div>}
        {error && (
          <div className="banner error" role="alert">
            {error}
            {!hasResult && <div className="muted" style={{ marginTop: 4 }}>Start the engine: <span className="mono">cd backend &amp;&amp; uv run uvicorn orbitcompute.api:app --port 8000</span></div>}
          </div>
        )}
        {overlay === "design" && <DesignDrawer />}
        {overlay === "compare" && <CompareView />}
      </div>
      {hasResult && <TimeControls />}
      <Tutorial />
    </div>
  );
}
