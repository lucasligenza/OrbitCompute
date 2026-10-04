"use client";
import { useEffect, useLayoutEffect, useState } from "react";
import { timeStore } from "@/state/time";
import { useUi, type Mode } from "@/state/ui";

interface Step {
  target: string; // data-tutorial anchor
  title: string;
  body: string[];
  mode?: Mode;
  before?: () => void;
}

const STEPS: Step[] = [
  {
    target: "scene", title: "Welcome to OrbitCompute",
    body: [
      "This is a hypothetical AI compute spacecraft orbiting Earth. Everything you see comes from a deterministic engine: orbital mechanics, sunlight, power, heat, workloads and communications.",
      "Drag to rotate, scroll to zoom. Click a spacecraft to select it.",
    ],
    mode: "orbit",
  },
  {
    target: "modes", title: "1 · Orbit",
    body: ["The bright trail is where the node has been, the faint path where it is going; the amber line is its ground track. Visualization modes re-encode the same scene — try them later (keys 1–6)."],
    mode: "orbit",
  },
  {
    target: "scrubber", title: "2 · Sunlight and eclipse",
    body: [
      "Purple bands on the timeline are Earth eclipses, computed from Sun–Earth geometry (conical shadow), not timers. Green bands are ground-station contacts.",
      "Press play or drag the timeline. Scrubbing backward restores the exact state — the scene is a pure function of time.",
    ],
    before: () => timeStore.getState().setSpeed(100),
  },
  {
    target: "detail", title: "3 · Solar + battery",
    body: ["In Power mode the flow diagram shows where every kilowatt goes. Watch solar fall to zero in eclipse and the battery take over. If generation plus battery cannot cover the load, compute is shed first."],
    mode: "power",
  },
  {
    target: "detail", title: "4 · Compute workloads",
    body: ["Each cell is an accelerator, colored by the job it runs. Realtime inference jobs stall (hatched) without a communication link. Click a job to inspect its progress, power and deadline."],
    mode: "compute",
  },
  {
    target: "detail", title: "5 · Thermal rejection",
    body: ["In vacuum, heat only leaves by radiation: P = εσAT⁴. If compute produces heat faster than the radiator rejects it, the equipment warms past its threshold and clocks are throttled. This is a simplified two-node model."],
    mode: "thermal",
  },
  {
    target: "detail", title: "6 · Communications",
    body: ["Ground stations see the node only above their elevation mask, so contact is intermittent. Data waits in upload/download queues; GEO relays or inter-satellite links can fill the gaps."],
    mode: "network",
  },
  {
    target: "explain", title: "What is happening?",
    body: ["The Now tab explains the selected node at the current instant — generated deterministically from the simulation state, with the reason behind it. Switch between Simple and Advanced for more detail."],
    before: () => useUi.getState().set({ rightTab: "now" }),
  },
  {
    target: "feed", title: "Mission feed",
    body: ["The Mission feed lists everything that happens — eclipses, power shortages, overheating, link changes, finished jobs — in plain language, across all spacecraft. Click any entry to jump there; 'Coming up' shows what is next."],
    before: () => useUi.getState().set({ rightTab: "feed" }),
  },
  {
    target: "design", title: "7 · Scheduler and design",
    body: ["Open Design to change orbit, hardware, workload, ground stations and the scheduling strategy, then press Run simulation."],
  },
  {
    target: "compare", title: "8 · Scenario comparison",
    body: ["Compare two designs — or the same design under two schedulers — with synchronized timelines and metric deltas. You can reopen this tutorial with the ? button."],
  },
];

const KEY = "orbitcompute.tutorial.seen";

export function maybeStartTutorial() {
  try {
    if (!localStorage.getItem(KEY)) useUi.getState().set({ tutorialStep: 0 });
  } catch {
    /* storage unavailable: skip auto-start */
  }
}

export default function Tutorial() {
  const step = useUi((s) => s.tutorialStep);
  const setUi = useUi((s) => s.set);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cur = step !== null ? STEPS[step] : null;

  useEffect(() => {
    if (!cur) return;
    if (cur.mode) useUi.getState().setMode(cur.mode);
    useUi.getState().set({ detailOpen: true, explainOpen: true });
    cur.before?.();
  }, [cur]);

  useLayoutEffect(() => {
    if (!cur) return;
    const measure = () => {
      const el = document.querySelector(`[data-tutorial="${cur.target}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    const id = setInterval(measure, 300);
    window.addEventListener("resize", measure);
    return () => { clearInterval(id); window.removeEventListener("resize", measure); };
  }, [cur]);

  if (!cur || step === null) return null;
  const finish = () => {
    try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ }
    setUi({ tutorialStep: null });
  };
  const pad = 6;
  const hole = rect && cur.target !== "scene"
    ? { left: rect.left - pad, top: rect.top - pad, width: rect.width + 2 * pad, height: rect.height + 2 * pad }
    : null;
  // Card placement: beside the highlighted element when possible.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  let left = vw / 2 - 170, top = vh / 2 - 120;
  if (hole) {
    if (hole.left + hole.width + 360 < vw) { left = hole.left + hole.width + 12; top = Math.min(hole.top, vh - 260); }
    else if (hole.left > 360) { left = hole.left - 352; top = Math.min(hole.top, vh - 260); }
    else { left = Math.min(Math.max(hole.left, 12), vw - 352); top = hole.top > 280 ? hole.top - 250 : hole.top + hole.height + 12; }
  }
  return (
    <>
      {hole ? <div className="tut-hole" style={hole} /> : <div className="tut-mask" style={{ background: "rgba(0,0,0,0.35)" }} />}
      <div className="tut-card" style={{ left, top }} role="dialog" aria-label={cur.title} data-testid="tutorial">
        <div className="muted mono" style={{ fontSize: 10.5 }}>{step + 1} / {STEPS.length}</div>
        <h4>{cur.title}</h4>
        {cur.body.map((p, i) => <p key={i}>{p}</p>)}
        <div className="tut-f">
          <button className="btn sm ghost" onClick={finish} data-testid="tutorial-skip">Skip</button>
          <span className="spacer" />
          {step > 0 && <button className="btn sm" onClick={() => setUi({ tutorialStep: step - 1 })}>Back</button>}
          {step < STEPS.length - 1
            ? <button className="btn sm primary" onClick={() => setUi({ tutorialStep: step + 1 })} data-testid="tutorial-next">Next</button>
            : <button className="btn sm primary" onClick={finish}>Done</button>}
        </div>
      </div>
    </>
  );
}
