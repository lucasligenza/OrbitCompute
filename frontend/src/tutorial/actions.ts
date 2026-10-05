// Actions a guided-tour step can use to drive the app. Everything goes through the normal stores,
// so the tour shows exactly what a user would see.
import type { Scenario } from "@/sim/types";
import { jobPhaseAt } from "@/sim/sample";
import { useScenario } from "@/state/scenario";
import { timeStore } from "@/state/time";
import { useUi, type CompareSide, type DesignTab, type Detail, type Mode } from "@/state/ui";

const session: { snapshot: Scenario | null; changed: boolean } = { snapshot: null, changed: false };

export function beginTour() {
  const d = useScenario.getState().draft;
  session.snapshot = d ? structuredClone(d) : null;
  session.changed = false;
}

/** Whether the tour replaced the user's scenario (offer to restore at the end). */
export function tourChangedScenario() {
  return session.changed && !!session.snapshot;
}

export async function restoreUserScenario() {
  const snap = session.snapshot;
  session.changed = false;
  if (snap) await useScenario.getState().loadScenario(snap);
}

const res = () => useScenario.getState().result;

export const act = {
  async preset(id: string) {
    if (useScenario.getState().draft?.preset_id === id && res()) return;
    session.changed = true;
    await useScenario.getState().loadPreset(id);
  },
  mode(m: Mode) { useUi.getState().setMode(m); },
  detail(d: Detail) { useUi.getState().setDetail(d); },
  right(tab: "now" | "feed") { useUi.getState().set({ rightTab: tab, explainOpen: true }); },
  panels() { useUi.getState().set({ detailOpen: true, explainOpen: true }); },
  overlay(o: null | "design" | "compare") { useUi.getState().set({ overlay: o }); },
  design(tab: DesignTab) { useUi.getState().set({ designTab: tab, overlay: "design" }); },
  compare(a: CompareSide, b: CompareSide) { useUi.getState().set({ compareRequest: { a, b }, overlay: "compare" }); },
  selectNode(i: number) { useUi.getState().selectNode(i); },
  pause() { timeStore.getState().pause(); },
  play(speed: number) { timeStore.getState().setSpeed(speed); timeStore.getState().play(); },
  seekFrac(f: number) { const r = res(); if (r) timeStore.getState().seek(r.duration * f); },
  /** Jump to the nth event of a type (optionally for one node), offset in seconds. Returns success. */
  seekEvent(type: string, opts: { node?: number; nth?: number; offset?: number } = {}) {
    const r = res();
    if (!r) return false;
    const list = r.events.filter((e) => e.type === type && (opts.node === undefined || e.node === opts.node));
    const e = list[Math.min(opts.nth ?? 0, list.length - 1)];
    if (!e) return false;
    timeStore.getState().seek(Math.max(0, e.t + (opts.offset ?? 0)));
    return true;
  },
  /** Select the running job with the most accelerators on the selected node at the current time. */
  selectBusiestJob() {
    const r = res();
    if (!r) return;
    const ui = useUi.getState();
    const nd = r.nodes[Math.min(ui.selectedNode, r.nodes.length - 1)];
    const t = timeStore.getState().t;
    const i = Math.min(Math.floor(t / r.dt), r.n - 1);
    const alloc = [...(nd.raw.alloc[i] ?? [])].filter(([j]) => jobPhaseAt(r.jobs[j], t) === "running").sort((a, b) => b[1] - a[1]);
    if (alloc.length) ui.selectJob(alloc[0][0]);
  },
};
