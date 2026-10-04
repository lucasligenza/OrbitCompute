import { create } from "zustand";
import type { OrbitPreview } from "@/sim/types";

export type Mode = "orbit" | "power" | "thermal" | "compute" | "network" | "system";
export const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: "orbit", label: "Orbit", hint: "Spacecraft, orbit tracks, ground tracks" },
  { key: "power", label: "Power", hint: "Solar generation, battery, eclipse" },
  { key: "thermal", label: "Thermal", hint: "Temperatures, radiators, throttling" },
  { key: "compute", label: "Compute", hint: "Utilization, jobs, queues" },
  { key: "network", label: "Network", hint: "Links, contact windows, data transfer" },
  { key: "system", label: "System", hint: "Combined mission state" },
];

export type Overlay = null | "design" | "compare";
export type Quality = "high" | "low";
export type Detail = "simple" | "advanced";

const QKEY = "orbitcompute.quality";
const DKEY = "orbitcompute.detail";
function initialDetail(): Detail {
  try {
    return localStorage.getItem(DKEY) === "advanced" ? "advanced" : "simple";
  } catch {
    return "simple";
  }
}
function initialQuality(): Quality {
  try {
    const v = localStorage.getItem(QKEY);
    if (v === "high" || v === "low") return v;
  } catch {
    /* storage unavailable */
  }
  return "high";
}

interface UiState {
  mode: Mode;
  selectedNode: number;
  selectedJob: number | null;
  detailOpen: boolean;
  explainOpen: boolean;
  eventsOpen: boolean;
  overlay: Overlay;
  tutorialStep: number | null;
  showGrid: boolean;
  showGroundTracks: boolean;
  preview: { nodeIndex: number; data: OrbitPreview } | null;
  quality: Quality;
  detail: Detail;
  rightTab: "now" | "feed";
  setDetail: (d: Detail) => void;
  showClouds: boolean;
  follow: boolean;
  /** incremented to request a camera reset / fly-to */
  cameraNonce: number;
  setQuality: (q: Quality) => void;
  setMode: (m: Mode) => void;
  selectNode: (i: number) => void;
  selectJob: (j: number | null) => void;
  set: (p: Partial<UiState>) => void;
}

export const useUi = create<UiState>((set) => ({
  mode: "orbit",
  selectedNode: 0,
  selectedJob: null,
  detailOpen: true,
  explainOpen: true,
  eventsOpen: false,
  overlay: null,
  tutorialStep: null,
  showGrid: true,
  showGroundTracks: true,
  preview: null,
  quality: typeof window === "undefined" ? "high" : initialQuality(),
  detail: typeof window === "undefined" ? "simple" : initialDetail(),
  rightTab: "now",
  setDetail: (detail) => {
    try { localStorage.setItem(DKEY, detail); } catch { /* ignore */ }
    set({ detail });
  },
  showClouds: true,
  follow: false,
  cameraNonce: 0,
  setQuality: (quality) => {
    try { localStorage.setItem(QKEY, quality); } catch { /* ignore */ }
    set({ quality });
  },
  setMode: (mode) => set({ mode }),
  selectNode: (selectedNode) => set({ selectedNode, selectedJob: null }),
  selectJob: (selectedJob) => set({ selectedJob }),
  set: (p) => set(p),
}));
