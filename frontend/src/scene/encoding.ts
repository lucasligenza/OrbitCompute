// Mode-dependent visual encoding of a node. Every color is paired with a text label so status is
// never conveyed by color alone.
import type { Mode } from "@/state/ui";
import type { NodeSample } from "@/sim/sample";
import type { NodeConfig } from "@/sim/types";
import { fmtPct } from "@/sim/format";

export const C = {
  accent: "#4da3ff",
  ok: "#3ecf8e",
  warn: "#f5a524",
  bad: "#ef4444",
  eclipse: "#6b72ff",
  neutral: "#c9d1db",
  dim: "#5b6573",
  cold: "#5aa9e6",
};

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (p: number, s: number) => (p >> s) & 255;
  const m = (s: number) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * Math.min(Math.max(t, 0), 1));
  return `#${((m(16) << 16) | (m(8) << 8) | m(0)).toString(16).padStart(6, "0")}`;
}

export interface Encoding { color: string; label: string; status: string }

export function encodeNode(mode: Mode, s: NodeSample, cfg: NodeConfig): Encoding {
  switch (mode) {
    case "power": {
      const color = s.soc <= cfg.battery.min_soc + 0.01 ? C.bad : s.soc < 0.4 ? C.warn : C.ok;
      const state = s.illum < 0.5 ? "eclipse" : s.illum < 0.999 ? "penumbra" : "sunlit";
      return { color: s.illum < 0.5 ? mix(color, C.eclipse, 0.45) : color, label: `SOC ${fmtPct(s.soc)} · ${state}`, status: state };
    }
    case "thermal": {
      const th = cfg.thermal;
      const color =
        s.thermalCode >= 3 ? C.bad
          : s.thermalCode === 2 ? mix(C.warn, C.bad, 0.5)
            : s.thermalCode === 1 ? C.warn
              : s.tEquip < th.min_operating_c + 5 ? C.cold
                : mix(C.cold, C.neutral, (s.tEquip - th.min_operating_c) / Math.max(th.warm_c - th.min_operating_c, 1));
      return { color, label: `${s.tEquip.toFixed(0)}°C · ${s.thermal}`, status: s.thermal };
    }
    case "compute": {
      const color = mix("#2a3646", C.accent, 0.25 + 0.75 * s.util);
      return { color, label: `${fmtPct(s.util)} util · ${s.nRunning} jobs`, status: s.util > 0.05 ? "active" : "idle" };
    }
    case "network": {
      const color = s.link === "NONE" ? C.dim : s.link === "DIRECT" ? C.ok : s.link === "RELAY" ? "#a78bfa" : C.accent;
      const waiting = s.nStalled > 0 ? ` · ${s.nStalled} session${s.nStalled === 1 ? "" : "s"} waiting` : s.upBacklog > 0.01 ? " · uploads queued" : "";
      const label = s.link === "NONE" ? `no link${waiting}` : s.link === "DIRECT" ? `ground ${s.linkDown.toFixed(1)} Gbps` : s.link === "RELAY" ? "GEO relay" : "ISL relay";
      return { color, label, status: s.link };
    }
    case "system": {
      const bad = s.pUnmet > 0 || s.thermalCode >= 3;
      const warn = s.powerLimited || s.thermalCode === 2 || s.soc < 0.25;
      return {
        color: bad ? C.bad : warn ? C.warn : C.ok,
        label: bad ? "FAULT" : warn ? "DEGRADED" : "NOMINAL",
        status: bad ? "fault" : warn ? "degraded" : "nominal",
      };
    }
    default: {
      return { color: s.illum < 0.5 ? mix(C.neutral, C.eclipse, 0.5) : C.neutral, label: `${s.alt.toFixed(0)} km`, status: "" };
    }
  }
}

export interface LegendItem { color: string; label: string; shape?: "dot" | "line" | "dash" | "band" }

export function legendFor(mode: Mode): { title: string; items: LegendItem[] } {
  switch (mode) {
    case "power":
      return { title: "Battery state of charge", items: [
        { color: C.ok, label: "SOC ≥ 40%" }, { color: C.warn, label: "SOC < 40%" }, { color: C.bad, label: "At reserve" },
        { color: "#1a1f3a", label: "Earth shadow (umbra)", shape: "band" },
      ] };
    case "thermal":
      return { title: "Equipment temperature", items: [
        { color: C.cold, label: "Cold / heater" }, { color: C.neutral, label: "Normal" }, { color: C.warn, label: "Warm" },
        { color: mix(C.warn, C.bad, 0.5), label: "Throttled" }, { color: C.bad, label: "Thermal limit" },
      ] };
    case "compute":
      return { title: "Accelerator utilization", items: [
        { color: mix("#2a3646", C.accent, 0.25), label: "Idle" }, { color: mix("#2a3646", C.accent, 0.62), label: "50%" },
        { color: C.accent, label: "100%" },
      ] };
    case "network":
      return { title: "Communication links", items: [
        { color: C.ok, label: "Ground link", shape: "dash" }, { color: C.accent, label: "Inter-satellite", shape: "dash" },
        { color: "#a78bfa", label: "GEO relay", shape: "dash" }, { color: C.dim, label: "No link" },
        { color: "rgba(77,163,255,0.5)", label: "Station visibility circle", shape: "line" },
        { color: "#5ec8ff", label: "User requests ↑" }, { color: "#3ecf8e", label: "Results to users ↓" },
        { color: "#f5a524", label: "Users waiting (no link)" },
        { color: "#ffe2b0", label: "User cities & backhaul: illustrative", shape: "line" },
      ] };
    case "system":
      return { title: "Mission state", items: [
        { color: C.ok, label: "Nominal" }, { color: C.warn, label: "Degraded (power/thermal/SOC)" }, { color: C.bad, label: "Fault (outage / limit)" },
      ] };
    default:
      return { title: "Orbit", items: [
        { color: C.neutral, label: "Spacecraft (sunlit)" }, { color: mix(C.neutral, C.eclipse, 0.5), label: "Spacecraft (eclipse)" },
        { color: C.accent, label: "Orbit path (past bright)", shape: "line" }, { color: C.warn, label: "Ground track", shape: "line" },
      ] };
  }
}
