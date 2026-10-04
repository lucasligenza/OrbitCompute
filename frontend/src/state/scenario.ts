import { create } from "zustand";
import { api } from "@/sim/api";
import { prepare, type PreparedResult } from "@/sim/result";
import type { Catalog, Scenario } from "@/sim/types";
import { timeStore } from "./time";
import { useUi } from "./ui";

export const DEFAULT_PRESET = "leo-inference";

interface ScenarioState {
  catalog: Catalog | null;
  draft: Scenario | null;
  result: PreparedResult | null;
  status: "idle" | "loading" | "running" | "error";
  error: string | null;
  /** draft differs from the scenario that produced `result` */
  dirty: boolean;
  init: () => Promise<void>;
  loadPreset: (id: string) => Promise<void>;
  loadScenario: (s: Scenario) => Promise<void>;
  edit: (fn: (s: Scenario) => void) => void;
  run: () => Promise<void>;
}

function clone<T>(x: T): T {
  return structuredClone(x);
}

export const useScenario = create<ScenarioState>((set, get) => ({
  catalog: null,
  draft: null,
  result: null,
  status: "idle",
  error: null,
  dirty: false,
  init: async () => {
    if (get().catalog) return;
    set({ status: "loading", error: null });
    try {
      const catalog = await api.catalog();
      set({ catalog });
      await get().loadPreset(DEFAULT_PRESET);
    } catch (e) {
      set({ status: "error", error: `Cannot reach the simulation engine: ${(e as Error).message}` });
    }
  },
  loadPreset: async (id) => {
    set({ status: "loading", error: null });
    try {
      const s = await api.preset(id);
      await get().loadScenario(s);
    } catch (e) {
      set({ status: "error", error: (e as Error).message });
    }
  },
  loadScenario: async (s) => {
    set({ draft: clone(s), dirty: true });
    useUi.getState().set({ selectedNode: 0, selectedJob: null, preview: null });
    await get().run();
    timeStore.getState().seek(0);
  },
  edit: (fn) => {
    const d = get().draft;
    if (!d) return;
    const next = clone(d);
    fn(next);
    if (next.provenance === "PRESET") next.provenance = "USER";
    set({ draft: next, dirty: true });
  },
  run: async () => {
    const d = get().draft;
    if (!d) return;
    set({ status: "running", error: null });
    try {
      const raw = await api.simulate(d);
      const result = prepare(raw);
      const ts = timeStore.getState();
      ts.setDuration(result.duration);
      const ui = useUi.getState();
      if (ui.selectedNode >= result.nodes.length) ui.selectNode(0);
      set({ result, status: "idle", dirty: false });
    } catch (e) {
      set({ status: "error", error: (e as Error).message });
    }
  },
}));
