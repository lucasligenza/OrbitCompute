"use client";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Icon } from "@/components/viz/Icon";
import { useScenario } from "@/state/scenario";
import { useSimTime } from "@/state/time";
import { useUi, type TourId } from "@/state/ui";
import { act, beginTour, restoreUserScenario, tourChangedScenario } from "./actions";
import { chapters, DEEP, QUICK, TOURS, tourCtx, type TourStep } from "./tours";

const KEY = "orbitcompute.tutorial.seen";

export function maybeStartTutorial() {
  try {
    if (!localStorage.getItem(KEY)) useUi.getState().set({ tourMenu: true });
  } catch {
    /* storage unavailable: skip auto-start */
  }
}

function markSeen() {
  try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ }
}

function startTour(id: TourId, step = 0) {
  markSeen();
  if (!useUi.getState().tour) beginTour();
  useUi.getState().set({ tourMenu: false, tour: { id, step } });
}

/** Launcher: choose the quick interface tour or the deep dive (or a chapter). */
function Launcher() {
  const setUi = useUi((s) => s.set);
  const chs = useMemo(() => chapters(DEEP), []);
  const close = () => { markSeen(); setUi({ tourMenu: false }); };
  return (
    <div className="tour-backdrop" role="dialog" aria-label="Choose a tour" data-testid="tour-launcher">
      <div className="tour-launcher card raised">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="satellite" size={18} color="var(--accent)" />
          <h3 style={{ margin: 0, fontSize: 16 }}>Explore OrbitCompute</h3>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={close} aria-label="Close">✕</button>
        </div>
        <p className="muted" style={{ margin: "6px 0 12px", fontSize: 12.5 }}>
          Optional guided tours. You can reopen them any time with the <b>?</b> button.
        </p>
        <div className="tour-options">
          <button className="tour-option" onClick={() => startTour("quick")} data-testid="start-quick">
            <span className="tour-option-h"><Icon name="layers" size={15} color="var(--accent)" /> Quick tour</span>
            <span className="muted">The interface in about 2 minutes: scene, modes, timeline, panels, feed, design and compare.</span>
            <span className="tour-meta mono">{QUICK.length} steps · ~2 min</span>
          </button>
          <button className="tour-option deep" onClick={() => startTour("deep")} data-testid="start-deep">
            <span className="tour-option-h"><Icon name="orbit" size={15} color="#ffd98a" /> Deep dive: how a space data center works</span>
            <span className="muted">Orbits, shadow, power, compute, heat, communications, scheduling and constellations. The tour drives the simulation and quotes its real numbers.</span>
            <span className="tour-meta mono">{chs.length} chapters · {DEEP.length} steps · ~10 min</span>
          </button>
        </div>
        <div className="tour-chapters">
          <div className="muted" style={{ fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>Or jump to a deep-dive chapter</div>
          <div className="tour-chips">
            {chs.map((ch, i) => (
              <button key={ch.name} className="chip" onClick={() => startTour("deep", ch.first)} data-testid={`chapter-${i}`}>{i + 1}. {ch.name}</button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button className="btn sm ghost" onClick={close} data-testid="tutorial-skip">No thanks</button>
        </div>
      </div>
    </div>
  );
}

/** Runs the active tour: setup per step, spotlight, card with live numbers. */
function Runner({ id, step }: { id: TourId; step: number }) {
  const setUi = useUi((s) => s.set);
  const res = useScenario((s) => s.result);
  const t = useSimTime(4);
  const steps = TOURS[id];
  const cur = steps[step];
  const chs = useMemo(() => chapters(steps), [steps]);
  const chapterIdx = chs.findIndex((c, i) => step >= c.first && (i === chs.length - 1 || step < chs[i + 1].first));
  const [readyStep, setReadyStep] = useState<TourStep | null>(null);
  const busy = readyStep !== cur;
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    act.pause();
    Promise.resolve(cur.setup?.()).finally(() => { if (!cancelled) setReadyStep(cur); });
    return () => { cancelled = true; };
  }, [cur]);

  useLayoutEffect(() => {
    const measure = () => {
      const el = cur.target ? document.querySelector(`[data-tutorial="${cur.target}"]`) : null;
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    const iv = setInterval(measure, 300);
    window.addEventListener("resize", measure);
    return () => { clearInterval(iv); window.removeEventListener("resize", measure); };
  }, [cur]);

  const go = (n: number) => { setExiting(false); setUi({ tour: { id, step: n } }); };
  const finish = async (restore: boolean) => {
    act.pause();
    setUi({ tour: null });
    if (restore) await restoreUserScenario();
  };
  const body = res ? (typeof cur.body === "function" ? cur.body(tourCtx(res, t)) : cur.body) : [];
  const last = step === steps.length - 1;
  const changed = tourChangedScenario();

  // Placement: beside the highlighted element, or bottom-centre when the scene is the subject.
  const vw = window.innerWidth, vh = window.innerHeight;
  const W = Math.min(390, vw - 24);
  const pad = 6;
  const sceneOnly = !rect || cur.target === "scene" || cur.target === "";
  const hole = rect && !sceneOnly ? { left: rect.left - pad, top: rect.top - pad, width: rect.width + 2 * pad, height: rect.height + 2 * pad } : null;
  let style: React.CSSProperties;
  if (!hole) style = { left: (vw - W) / 2, bottom: 96, width: W };
  else if (hole.left + hole.width + W + 16 < vw) style = { left: hole.left + hole.width + 12, top: Math.min(Math.max(hole.top, 60), vh - 330), width: W };
  else if (hole.left > W + 16) style = { left: hole.left - W - 12, top: Math.min(Math.max(hole.top, 60), vh - 330), width: W };
  else style = { left: Math.min(Math.max(hole.left, 12), vw - W - 12), top: hole.top > 340 ? hole.top - 320 : hole.top + hole.height + 12, width: W };

  return (
    <>
      {hole && <div className="tut-hole" style={hole} />}
      <div className={`tut-card${id === "deep" ? " deep" : ""}`} style={style} role="dialog" aria-label={cur.title} data-testid="tutorial">
        {id === "deep" && chapterIdx >= 0 && (
          <div className="tut-chapter">
            <span className="mono">Chapter {chapterIdx + 1}/{chs.length}</span>
            <select value={chapterIdx} onChange={(e) => go(chs[Number(e.target.value)].first)} aria-label="Jump to chapter" data-testid="tour-chapter-select">
              {chs.map((c, i) => <option key={c.name} value={i}>{i + 1}. {c.name}</option>)}
            </select>
          </div>
        )}
        <div className="tut-progress"><i style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>
        <h4>{cur.title}</h4>
        {busy ? <p className="muted"><span className="spinner" /> &nbsp;Setting up this moment…</p> : body.map((p, i) => <p key={i}>{p}</p>)}
        {!busy && cur.tryIt && <div className="tut-try"><Icon name="bolt" size={12} color="#ffd98a" /> <span><b>Try it:</b> {cur.tryIt}</span></div>}
        {exiting ? (
          <div className="tut-f">
            <span className="muted" style={{ fontSize: 11.5 }}>The tour loaded example scenarios.</span>
            <span className="spacer" />
            <button className="btn sm" onClick={() => finish(false)} data-testid="tour-keep">Keep this one</button>
            <button className="btn sm primary" onClick={() => finish(true)} data-testid="tour-restore">Return to my scenario</button>
          </div>
        ) : (
          <div className="tut-f">
            <button className="btn sm ghost" onClick={() => (changed ? setExiting(true) : finish(false))} data-testid="tour-exit">Exit tour</button>
            <span className="muted mono" style={{ fontSize: 10.5 }}>{step + 1}/{steps.length}</span>
            <span className="spacer" />
            {step > 0 && <button className="btn sm" onClick={() => go(step - 1)} disabled={busy}>Back</button>}
            {!last
              ? <button className="btn sm primary" onClick={() => go(step + 1)} disabled={busy} data-testid="tutorial-next">Next</button>
              : changed
                ? <button className="btn sm primary" onClick={() => setExiting(true)} data-testid="tour-done">Finish</button>
                : <button className="btn sm primary" onClick={() => finish(false)} data-testid="tour-done">Finish</button>}
          </div>
        )}
      </div>
    </>
  );
}

export default function Tutorial() {
  const tour = useUi((s) => s.tour);
  const menu = useUi((s) => s.tourMenu);
  const hasResult = useScenario((s) => !!s.result);
  if (!hasResult) return null;
  if (menu) return <Launcher />;
  if (!tour) return null;
  return <Runner key={`${tour.id}`} id={tour.id} step={tour.step} />;
}
