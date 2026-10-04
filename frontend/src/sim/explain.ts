// Deterministic "What is happening?" generator. Pure function of (result, node, t) — no LLM.
import { fmtC, fmtDur, fmtGbps, fmtKw, fmtPct } from "./format";
import type { PreparedResult } from "./result";
import { sampleNode, type NodeSample } from "./sample";

export type Tone = "nominal" | "info" | "warning" | "critical" | "eclipse";

export interface Row { label: string; value: string; tone?: Tone }
export interface Section { key: string; title: string; status: string; tone: Tone; rows: Row[]; note?: string }
export interface Explanation {
  node: string;
  sample: NodeSample;
  headline: string;
  why: string[];
  sections: Section[];
  next?: { label: string; in: number; t: number };
}

const NEXT_TYPES = new Set([
  "eclipse_enter", "eclipse_exit", "aos", "los", "soc_low", "soc_reserve", "throttle_start", "throttle_end",
  "thermal_limit", "power_short_start", "power_short_end", "outage_start", "relay_start", "relay_end",
]);

export function explain(res: PreparedResult, nodeIndex: number, t: number): Explanation {
  const nd = res.nodes[nodeIndex];
  const cfg = res.raw.scenario.nodes[nodeIndex];
  const s = sampleNode(res, nd, t);
  const why: string[] = [];
  const sections: Section[] = [];

  // ---- Sunlight -------------------------------------------------------------------------------
  const ecl = nd.raw.eclipse_windows;
  const inEcl = ecl.find(([a, b]) => t >= a && t < b);
  const nextEcl = ecl.find(([a]) => a > t);
  const sunRows: Row[] = [];
  let sunStatus: string;
  let sunTone: Tone;
  if (s.shadow === "UMBRA" || (s.illum < 0.5 && s.shadow !== "SUNLIGHT")) {
    sunStatus = "Earth eclipse (umbra)";
    sunTone = "eclipse";
    if (inEcl) sunRows.push({ label: "Sunlight returns in", value: fmtDur(inEcl[1] - t) });
  } else if (s.shadow === "PENUMBRA") {
    sunStatus = `Penumbra — ${fmtPct(s.illum)} of solar disc visible`;
    sunTone = "warning";
  } else {
    sunStatus = "Direct solar exposure";
    sunTone = "nominal";
    sunRows.push({ label: "Next eclipse in", value: nextEcl ? fmtDur(nextEcl[0] - t) : "none in horizon" });
  }
  sunRows.push({ label: "Altitude", value: `${s.alt.toFixed(0)} km` });
  sunRows.push({ label: "Sub-satellite point", value: `${s.lat.toFixed(1)}°, ${s.lon.toFixed(1)}°` });
  sections.push({ key: "sun", title: "Sunlight", status: sunStatus, tone: sunTone, rows: sunRows });

  // ---- Power -------------------------------------------------------------------------------------
  const platform = s.pPlatform + s.pThermal + s.pHeater;
  const battRow: Row =
    s.pBatt > 0.05
      ? { label: "Battery", value: `charging +${fmtKw(s.pBatt)}`, tone: "nominal" }
      : s.pBatt < -0.05
        ? { label: "Battery", value: `discharging ${fmtKw(s.pBatt)}`, tone: "warning" }
        : { label: "Battery", value: "idle" };
  const powerRows: Row[] = [
    { label: "Solar generation", value: fmtKw(s.pGen) },
    { label: "AI compute", value: fmtKw(s.pCompute) },
    { label: "Platform + thermal ctrl", value: fmtKw(platform) },
    { label: "Comms", value: fmtKw(s.pComms) },
    battRow,
    { label: "State of charge", value: fmtPct(s.soc), tone: s.soc <= cfg.battery.min_soc + 0.01 ? "critical" : s.soc < 0.25 ? "warning" : undefined },
  ];
  if (s.pCurtailed > 0.05) powerRows.push({ label: "Curtailed solar", value: fmtKw(s.pCurtailed), tone: "info" });
  if (s.pUnmet > 0.001) powerRows.push({ label: "Unmet load", value: fmtKw(s.pUnmet), tone: "critical" });
  let powerStatus = "Balanced";
  let powerTone: Tone = "nominal";
  if (s.pUnmet > 0.001) { powerStatus = "PLATFORM OUTAGE"; powerTone = "critical"; }
  else if (s.powerLimited) { powerStatus = "POWER LIMITED — compute shed"; powerTone = "warning"; }
  else if (s.pBatt < -0.05) { powerStatus = "On battery"; powerTone = "warning"; }
  else if (s.pBatt > 0.05) { powerStatus = "Charging"; }
  sections.push({ key: "power", title: "Power", status: powerStatus, tone: powerTone, rows: powerRows });

  // ---- Compute ---------------------------------------------------------------------------------
  const computeRows: Row[] = [
    { label: "Accelerator utilization", value: fmtPct(s.util) },
    { label: "Jobs running", value: String(s.nRunning) },
    { label: "Jobs queued", value: String(s.nQueued) },
  ];
  if (s.nStalled > 0) computeRows.push({ label: "Stalled (awaiting link)", value: String(s.nStalled), tone: "warning" });
  if (s.nUplink > 0) computeRows.push({ label: "Waiting for input upload", value: String(s.nUplink) });
  if (s.nDownlink > 0) computeRows.push({ label: "Waiting for result download", value: String(s.nDownlink) });
  if (s.throttle < 0.999) computeRows.push({ label: "Clock factor (thermal)", value: fmtPct(s.throttle), tone: "warning" });
  if (s.powerFactor < 0.999) computeRows.push({ label: "Clock factor (power)", value: fmtPct(s.powerFactor), tone: "warning" });
  const cStatus = s.util > 0.6 ? "Busy" : s.util > 0.05 ? "Partially loaded" : "Idle";
  sections.push({ key: "compute", title: "Compute", status: cStatus, tone: "info", rows: computeRows });

  // ---- Thermal ---------------------------------------------------------------------------------
  const margin = cfg.thermal.throttle_c - s.tEquip;
  const thermalTone: Tone = s.thermalCode >= 3 ? "critical" : s.thermalCode === 2 ? "warning" : s.thermalCode === 1 ? "info" : "nominal";
  sections.push({
    key: "thermal", title: "Thermal", status: s.thermal, tone: thermalTone,
    rows: [
      { label: "Heat dissipated", value: fmtKw(s.qDiss) },
      { label: "Radiator rejection", value: fmtKw(s.qReject) },
      { label: "Earth IR absorbed", value: fmtKw(s.qEnv) },
      { label: "Equipment temperature", value: fmtC(s.tEquip) },
      { label: "Radiator temperature", value: fmtC(s.tRad) },
      { label: "Margin to throttle", value: `${margin.toFixed(1)} K`, tone: margin < 0 ? "warning" : undefined },
    ],
    note: "Simplified 2-node model",
  });

  // ---- Network ---------------------------------------------------------------------------------
  const netRows: Row[] = [];
  let netStatus = "No link";
  let netTone: Tone = "info";
  const stations = res.raw.stations;
  if (s.link === "DIRECT" && s.linkStation >= 0) {
    const st = stations[s.linkStation];
    const win = nd.raw.contact_windows.find(([si, a, b]) => si === s.linkStation && t >= a && t < b);
    netStatus = `Contact with ${st.name}`;
    netTone = "nominal";
    netRows.push({ label: "Downlink", value: fmtGbps(s.linkDown) }, { label: "Uplink", value: fmtGbps(s.linkUp) });
    netRows.push({ label: "Latency (one-way)", value: `${s.latencyMs.toFixed(1)} ms` });
    if (win) netRows.push({ label: "Window ends in", value: fmtDur(win[2] - t) });
  } else if (s.link === "ISL") {
    const relay = res.nodes[s.linkRelay];
    netStatus = `Inter-satellite relay via ${relay?.name ?? "neighbour"}`;
    netTone = "nominal";
    netRows.push({ label: "Effective downlink", value: fmtGbps(s.linkDown) }, { label: "Path latency", value: `${s.latencyMs.toFixed(1)} ms` });
  } else if (s.link === "RELAY") {
    const rl = res.raw.relays[s.linkGeo];
    netStatus = `GEO relay: ${rl?.name ?? "relay"}`;
    netTone = "nominal";
    netRows.push({ label: "Relay rate", value: fmtGbps(s.linkDown) }, { label: "Path latency", value: `${s.latencyMs.toFixed(0)} ms` });
  } else {
    const nxt = nd.raw.contact_windows.find(([, a]) => a > t);
    netRows.push({ label: "Next ground contact", value: nxt ? `${stations[nxt[0]].name} in ${fmtDur(nxt[1] - t)}` : "none in horizon" });
  }
  netRows.push({ label: "Upload backlog", value: `${s.upBacklog.toFixed(1)} Gbit` });
  netRows.push({ label: "Download backlog", value: `${s.downBacklog.toFixed(1)} Gbit` });
  sections.push({ key: "network", title: "Network", status: netStatus, tone: netTone, rows: netRows });

  // ---- Why (rules, in priority order) ---------------------------------------------------------
  if (s.pUnmet > 0.001) why.push("The battery has reached its emergency floor with no sunlight: even essential loads cannot be supplied.");
  else if (s.powerLimited && s.illum < 0.5) why.push("In Earth's shadow the battery alone cannot cover the requested compute load, so compute is shed to protect the reserve.");
  else if (s.powerLimited) why.push("The arrays and battery together cannot supply the requested load; the power system is throttling compute.");
  else if (s.illum < 0.5 && s.pBatt < -0.05) why.push("The arrays are in Earth's shadow, so the battery is supplying every load on the bus.");
  else if (s.illum >= 0.999 && s.pBatt > 0.05) why.push("In full sunlight the arrays cover all loads and the surplus recharges the battery.");
  if (s.pCurtailed > 0.05) why.push("The battery cannot absorb all surplus solar power, so some is curtailed (wasted).");
  if (s.thermalCode >= 2) why.push("The radiator cannot reject heat as fast as compute produces it; the equipment is above its throttle threshold, so clocks are reduced.");
  else if (s.thermalCode === 1) why.push("Equipment is warm — heat generation is close to what the radiator can reject at this temperature.");
  if (s.nStalled > 0) why.push("Some realtime jobs hold accelerators but cannot progress without a communication link.");
  if (s.link === "NONE" && s.nUplink > 0) why.push("Jobs are waiting for their input data, which can only be uploaded during a contact window.");
  if (s.pHeater > 0.01) why.push("Survival heaters are on to keep equipment above its minimum operating temperature.");

  // ---- Next event --------------------------------------------------------------------------------
  const nextEv = res.events.find((e) => e.t > t + 0.5 && e.node === nodeIndex && NEXT_TYPES.has(e.type));
  const headline = `${sunStatus} · ${powerStatus} · ${s.thermal}`;
  return {
    node: nd.name, sample: s, headline, why, sections,
    next: nextEv ? { label: nextEv.label.replace(`${nd.name} `, ""), in: nextEv.t - t, t: nextEv.t } : undefined,
  };
}

export function toneColor(tone?: Tone): string {
  switch (tone) {
    case "nominal": return "var(--ok)";
    case "warning": return "var(--warn)";
    case "critical": return "var(--bad)";
    case "eclipse": return "var(--eclipse)";
    case "info": return "var(--accent)";
    default: return "var(--text)";
  }
}
