"use client";
import { useCallback, useMemo, useRef } from "react";
import { useScenario } from "@/state/scenario";
import { SPEEDS, timeStore, useSimTime, useTimeState } from "@/state/time";
import { useUi } from "@/state/ui";
import { fmtMet } from "@/sim/format";
import EventTimeline from "./EventTimeline";

const MAJOR = new Set(["soc_reserve", "outage_start", "thermal_limit", "throttle_start", "power_short_start", "deadline_miss"]);
const SEV_COLOR: Record<string, string> = { critical: "var(--bad)", warning: "var(--warn)", nominal: "var(--ok)", info: "var(--accent)" };

function Scrubber() {
  const res = useScenario((s) => s.result)!;
  const sel = useUi((s) => s.selectedNode);
  const t = useSimTime(20);
  const ref = useRef<HTMLDivElement>(null);
  const dur = res.duration;
  const nd = res.nodes[sel] ?? res.nodes[0];

  const seekFromEvent = useCallback((clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    timeStore.getState().seek(((clientX - r.left) / r.width) * dur);
  }, [dur]);

  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    seekFromEvent(e.clientX);
  };
  const onMove = (e: React.PointerEvent) => {
    if (e.buttons & 1) seekFromEvent(e.clientX);
  };

  const ticks = useMemo(
    () => res.events.filter((e) => MAJOR.has(e.type) && (e.node === sel || e.node < 0)).slice(0, 400),
    [res, sel],
  );
  const hours = Math.floor(dur / 3600);
  return (
    <div
      ref={ref}
      className="scrub"
      role="slider"
      aria-label="Simulation time"
      aria-valuemin={0}
      aria-valuemax={dur}
      aria-valuenow={Math.round(t)}
      tabIndex={0}
      data-testid="scrubber"
      data-tutorial="scrubber"
      onPointerDown={onDown}
      onPointerMove={onMove}
    >
      {Array.from({ length: hours + 1 }, (_, h) => (
        <span key={h} className="scrub-label" style={{ left: `${((h * 3600) / dur) * 100}%` }}>
          {h % 2 === 0 ? `${h}h` : ""}
        </span>
      ))}
      <div className="scrub-track">
        {nd.raw.contact_windows.map(([, a, b], i) => (
          <div key={`c${i}`} className="scrub-band" title="Ground contact"
            style={{ left: `${(a / dur) * 100}%`, width: `${((b - a) / dur) * 100}%`, background: "rgba(62,207,142,0.35)", top: 0, bottom: "60%" }} />
        ))}
        {nd.raw.eclipse_windows.map(([a, b], i) => (
          <div key={`e${i}`} className="scrub-band" title="Eclipse"
            style={{ left: `${(a / dur) * 100}%`, width: `${((b - a) / dur) * 100}%`, background: "rgba(107,114,255,0.55)", top: "45%" }} />
        ))}
      </div>
      {ticks.map((e, i) => (
        <div key={i} className="scrub-tick" title={e.label}
          style={{ left: `${(e.t / dur) * 100}%`, background: SEV_COLOR[e.severity] }} />
      ))}
      <div className="scrub-head" style={{ left: `calc(${(t / dur) * 100}% - 1px)` }} />
    </div>
  );
}

export default function TimeControls() {
  const playing = useTimeState((s) => s.playing);
  const speed = useTimeState((s) => s.speed);
  const t = useSimTime(10);
  const eventsOpen = useUi((s) => s.eventsOpen);
  const setUi = useUi((s) => s.set);
  return (
    <div className="dock">
      <div className="timebar">
        <button className="play" aria-label={playing ? "Pause" : "Play"} data-testid="play" data-tutorial="play"
          onClick={() => timeStore.getState().toggle()}>
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="1" width="3" height="10" fill="currentColor" /><rect x="7" y="1" width="3" height="10" fill="currentColor" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 1 L11 6 L2 11 Z" fill="currentColor" /></svg>
          )}
        </button>
        <div className="speeds" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button key={s} className={speed === s ? "on" : ""} data-testid={`speed-${s}`} onClick={() => timeStore.getState().setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        <div className="met" data-testid="met">{fmtMet(t)}</div>
        <Scrubber />
        <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.3 }}>
          <div><span style={{ color: "var(--eclipse)" }}>■</span> eclipse</div>
          <div><span style={{ color: "var(--ok)" }}>■</span> contact</div>
        </div>
        <button className={`btn sm${eventsOpen ? " primary" : ""}`} data-testid="toggle-events" data-tutorial="events"
          onClick={() => setUi({ eventsOpen: !eventsOpen })}>
          Events
        </button>
      </div>
      {eventsOpen && <EventTimeline />}
    </div>
  );
}
