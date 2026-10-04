"use client";
import { useScenario } from "@/state/scenario";
import { useSimTime } from "@/state/time";
import { useUi } from "@/state/ui";
import { cursorAt, sampleNode } from "@/sim/sample";
import { EARTH_R, ecefToLocal, latLonToLocal } from "@/sim/frames";
import { fmtDur } from "@/sim/format";
import { encodeNode } from "./encoding";
import { dataFlowVisible } from "./DataFlow";
import { flowFor, routeFor } from "./userRoutes";
import { bindLabel } from "./labels";

function local(fn: (out: [number, number, number]) => void): [number, number, number] {
  const p: [number, number, number] = [0, 0, 0];
  fn(p);
  return p;
}

/** DOM labels positioned by LabelProjector. Content updates at a low rate; positions every frame. */
export default function LabelLayer() {
  const res = useScenario((s) => s.result);
  const mode = useUi((s) => s.mode);
  const selected = useUi((s) => s.selectedNode);
  const overlay = useUi((s) => s.overlay);
  const preview = useUi((s) => s.preview);
  const t = useSimTime(6);
  if (!res) return null;
  const c = cursorAt(res, t);
  const sel = res.nodes[Math.min(selected, res.nodes.length - 1)];
  const activeStation = sel.s.link_type[c.i] === 1 ? sel.s.link_station[c.i] : -1;
  const showRelays = res.raw.scenario.nodes.some((n) => n.comms.relay_enabled);
  // What the selected node means for people on the ground right now
  const route = routeFor(res, sel.index, c.i, t);
  const flow = flowFor(res, sel.index, c.i);
  const ep = route.endpoint;
  const userLabel = !ep || !dataFlowVisible(mode) ? null
    : route.linkType > 0
      ? (flow.live > 0 ? `serving users · ${flow.live} live session${flow.live === 1 ? "" : "s"}` : "users connected · data flowing")
      : flow.waiting > 0
        ? `users waiting${flow.stalled > 0 ? ` · ${flow.stalled} session${flow.stalled === 1 ? "" : "s"} stalled` : ""} · next contact ${isFinite(route.nextContactIn) ? `in ${fmtDur(route.nextContactIn)}` : "not in horizon"}`
        : null;
  return (
    <div className="label-layer" aria-hidden>
      {res.nodes.map((nd) => {
        const s = sampleNode(res, nd, t);
        const enc = encodeNode(mode, s, res.raw.scenario.nodes[nd.index]);
        return (
          <div key={`${res.hash}-n${nd.index}`} ref={bindLabel(`node-${nd.index}`)} className="lbl-anchor">
            <div className={`node-label${nd.index === selected ? " selected" : ""}`} data-testid={`node-label-${nd.index}`}>
              <span className="nl-dot" style={{ background: enc.color }} />
              <span className="nl-name">{nd.name}</span>
              <span className="nl-val">{enc.label}</span>
            </div>
          </div>
        );
      })}
      {res.raw.stations.map((st, i) =>
        mode === "network" || i === activeStation ? (
          <div key={`${res.hash}-s${st.id}`} className="lbl-anchor"
            ref={bindLabel(`st-${res.hash}-${i}`, local((p) => latLonToLocal(st.lat_deg, st.lon_deg, EARTH_R * 1.003, p)))}>
            <div className={`station-label${i === activeStation ? " active" : ""}`}>{st.name.split(" (")[0]}</div>
          </div>
        ) : null,
      )}
      {showRelays && res.raw.relays.map((rl, i) => {
        const lon = (rl.lon_deg * Math.PI) / 180;
        return (
          <div key={`${res.hash}-r${rl.id}`} className="lbl-anchor"
            ref={bindLabel(`relay-${res.hash}-${i}`, local((p) => ecefToLocal(rl.radius_km * Math.cos(lon), rl.radius_km * Math.sin(lon), 0, p)))}>
            <div className="relay-label">{rl.name}</div>
          </div>
        );
      })}
      {userLabel && ep && (
        <div key={`${res.hash}-ep-${ep.key}-${route.linkType > 0}`} className="lbl-anchor"
          ref={bindLabel(`ep-${res.hash}-${ep.key}`, local((p) => latLonToLocal(ep.lat, ep.lon, EARTH_R * 1.004, p)))}>
          <div className={`user-label${route.linkType > 0 ? "" : " waiting"}`} data-testid="user-label">
            <span className="ul-dot" />{sel.name}: {userLabel}
          </div>
        </div>
      )}
      {overlay === "design" && preview && (
        <div className="lbl-anchor" ref={bindLabel("preview")}>
          <div className="preview-label">PREVIEW orbit</div>
        </div>
      )}
    </div>
  );
}
