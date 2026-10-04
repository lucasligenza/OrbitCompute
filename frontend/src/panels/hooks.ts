"use client";
import { useMemo } from "react";
import { useScenario } from "@/state/scenario";
import { useSimTime } from "@/state/time";
import { useUi } from "@/state/ui";
import { sampleNode } from "@/sim/sample";

/** Selected node + its interpolated sample at the current time (throttled). */
export function useSelected(hz = 10) {
  const res = useScenario((s) => s.result)!;
  const sel = useUi((s) => s.selectedNode);
  const idx = Math.min(sel, res.nodes.length - 1);
  const nd = res.nodes[idx];
  const cfg = res.raw.scenario.nodes[idx];
  const t = useSimTime(hz);
  const s = useMemo(() => sampleNode(res, nd, t), [res, nd, t]);
  return { res, nd, cfg, s, t, idx };
}
