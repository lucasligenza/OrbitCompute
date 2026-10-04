// Unified mission feed: one chronological, plain-language stream across all nodes, built purely
// from the immutable result (engine events + recorded link state). Noisy job events are summarised.
import type { PreparedResult } from "./result";
import type { SimEvent } from "./types";

export type FeedCategory = "orbit" | "power" | "thermal" | "network" | "compute" | "mission";
export type FeedSeverity = "info" | "nominal" | "warning" | "critical";

export interface FeedItem {
  id: string;
  t: number;
  node: number; // -1 = whole mission
  category: FeedCategory;
  severity: FeedSeverity;
  /** shown under "Key events" (what a newcomer should notice) */
  key: boolean;
  title: string;
  meaning: string;
  count?: number;
  job?: number;
}

const MEANING: Record<string, { title: string; meaning: string; key: boolean }> = {
  eclipse_enter: { title: "Entered Earth's shadow", meaning: "The Sun is blocked, so solar power drops to zero and the battery takes over every load.", key: true },
  eclipse_exit: { title: "Back in sunlight", meaning: "The solar arrays generate again and start recharging the battery.", key: true },
  soc_low: { title: "Battery below 25%", meaning: "Getting close to the reserve level where AI compute is switched off to protect the spacecraft.", key: true },
  soc_reserve: { title: "Battery reserve reached", meaning: "AI compute is shut off so essential systems keep running until the arrays recharge the battery.", key: true },
  power_short_start: { title: "Power shortage: compute slowed", meaning: "The arrays and battery cannot supply everything requested, so compute is throttled or paused.", key: true },
  power_short_end: { title: "Power shortage over", meaning: "There is enough power again and compute runs normally.", key: true },
  outage_start: { title: "Platform power outage", meaning: "Critical: even essential spacecraft systems cannot be powered.", key: true },
  throttle_start: { title: "Overheating: chips slowed down", meaning: "The radiators cannot shed heat as fast as the compute produces it, so clocks are reduced to cool down.", key: true },
  throttle_end: { title: "Cooled down: full speed again", meaning: "The equipment is back below its throttle temperature.", key: true },
  thermal_limit: { title: "Thermal limit reached", meaning: "Critical temperature: compute stops until the hardware cools.", key: true },
  aos: { title: "Ground station in view", meaning: "A ground station can see the spacecraft above its elevation mask.", key: false },
  los: { title: "Ground station out of view", meaning: "The spacecraft has dropped below the station's elevation mask.", key: false },
  relay_start: { title: "GEO relay link started", meaning: "Data is routed through a geostationary relay satellite.", key: false },
  relay_end: { title: "GEO relay link ended", meaning: "The relay is no longer used or visible.", key: false },
  isl_start: { title: "Relaying through a neighbour", meaning: "An inter-satellite link reaches the ground through another spacecraft.", key: false },
};

const LINK_NAMES = ["none", "ground", "inter-satellite", "GEO relay"];
const BUCKET_S = 900; // job events summarised per node per 15 minutes

function linkTarget(res: PreparedResult, node: number, i: number): string {
  const s = res.nodes[node].s;
  const type = s.link_type[i];
  if (type === 1) return res.raw.stations[s.link_station[i]]?.name.split(" (")[0] ?? "ground station";
  if (type === 2) return `${res.nodes[s.link_relay[i]]?.name ?? "neighbour"} (inter-satellite)`;
  if (type === 3) return (res.raw.relays[s.link_geo[i]]?.name ?? "GEO relay").replace(" (illustrative)", "");
  return "";
}

/** Communication status changes derived from the recorded link state (any link vs none). */
function linkChanges(res: PreparedResult): FeedItem[] {
  const out: FeedItem[] = [];
  res.nodes.forEach((nd, m) => {
    const lt = nd.s.link_type;
    for (let i = 1; i < lt.length; i++) {
      const was = lt[i - 1] > 0, is = lt[i] > 0;
      const t = i * res.dt;
      if (!was && is) {
        out.push({ id: `link-up-${m}-${i}`, t, node: m, category: "network", severity: "nominal", key: true,
          title: `Link up via ${linkTarget(res, m, i)}`,
          meaning: `Data can flow again (${LINK_NAMES[lt[i]]} link). Waiting uploads and downloads resume.` });
      } else if (was && !is) {
        out.push({ id: `link-down-${m}-${i}`, t, node: m, category: "network", severity: "info", key: true,
          title: "No communication link",
          meaning: "Out of reach of every ground station and relay: results wait on board and realtime jobs stall." });
      } else if (was && is && lt[i] !== lt[i - 1]) {
        out.push({ id: `link-sw-${m}-${i}`, t, node: m, category: "network", severity: "info", key: false,
          title: `Switched to ${linkTarget(res, m, i)}`, meaning: `The spacecraft now uses a ${LINK_NAMES[lt[i]]} link.` });
      }
    }
  });
  return out;
}

function summariseJobs(res: PreparedResult, events: SimEvent[]): FeedItem[] {
  type Bucket = { t: number; node: number; type: string; jobs: number[] };
  const buckets = new Map<string, Bucket>();
  for (const e of events) {
    if (e.type !== "job_complete" && e.type !== "deadline_miss" && e.type !== "job_rejected") continue;
    const key = `${e.type}|${e.node}|${Math.floor(e.t / BUCKET_S)}`;
    const b = buckets.get(key) ?? { t: e.t, node: e.node, type: e.type, jobs: [] };
    b.jobs.push(e.job ?? -1);
    b.t = Math.min(b.t, e.t);
    buckets.set(key, b);
  }
  const out: FeedItem[] = [];
  for (const [k, b] of buckets) {
    const n = b.jobs.length;
    const byType = new Map<string, number>();
    for (const j of b.jobs) { const ty = res.jobs[j]?.type ?? "job"; byType.set(ty, (byType.get(ty) ?? 0) + 1); }
    const mix = [...byType.entries()].sort((a, c) => c[1] - a[1]).map(([ty, c]) => `${c} ${ty}`).join(", ");
    const plural = n === 1 ? "job" : "jobs";
    if (b.type === "job_complete") {
      out.push({ id: k, t: b.t, node: b.node, category: "compute", severity: "nominal", key: false, count: n, job: b.jobs[0],
        title: `${n} ${plural} finished`, meaning: `Completed work: ${mix}.` });
    } else if (b.type === "deadline_miss") {
      out.push({ id: k, t: b.t, node: b.node, category: "compute", severity: "critical", key: true, count: n, job: b.jobs[0],
        title: `${n} ${plural} missed ${n === 1 ? "its" : "their"} deadline`,
        meaning: `Not finished in time (${mix}). Usually caused by power limits, throttling, missing links or a busy queue.` });
    } else {
      out.push({ id: k, t: b.t, node: -1, category: "compute", severity: "warning", key: true, count: n, job: b.jobs[0],
        title: `${n} ${plural} rejected`, meaning: `No spacecraft has enough accelerators for ${n === 1 ? "this job" : "these jobs"} (${mix}).` });
    }
  }
  return out;
}

export function buildFeed(res: PreparedResult): FeedItem[] {
  const m = res.raw.metrics;
  const sc = res.raw.scenario;
  const items: FeedItem[] = [{
    id: "start", t: 0, node: -1, category: "mission", severity: "info", key: true,
    title: "Simulation starts",
    meaning: `${sc.nodes.length} hypothetical compute ${sc.nodes.length === 1 ? "spacecraft" : "spacecraft"}, ${m.jobs_total} jobs arriving over ${(res.duration / 3600).toFixed(0)} h, ${res.raw.scheduler_label} scheduler.`,
  }];
  for (const e of res.events) {
    const def = MEANING[e.type];
    if (!def) continue;
    const st = e.station !== undefined ? res.raw.stations[e.station]?.name.split(" (")[0] : undefined;
    items.push({
      id: `${e.type}-${e.node}-${e.t}-${e.station ?? ""}`, t: e.t, node: e.node, category: e.category, severity: e.severity, key: def.key,
      title: st ? `${def.title}: ${st}` : def.title, meaning: def.meaning,
    });
  }
  items.push(...linkChanges(res), ...summariseJobs(res, res.events));
  items.push({
    id: "end", t: res.duration, node: -1, category: "mission", severity: m.deadline_misses > 0 || m.outage_time_s > 0 ? "warning" : "nominal", key: true,
    title: "End of simulated horizon",
    meaning: `${m.jobs_completed} of ${m.jobs_total} jobs completed, ${m.deadline_misses} deadline misses, ${(m.utilization_mean * 100).toFixed(0)}% mean utilization.`,
  });
  const order: Record<string, number> = { mission: 0, orbit: 1, power: 2, thermal: 3, network: 4, compute: 5 };
  items.sort((a, b) => a.t - b.t || order[a.category] - order[b.category] || a.id.localeCompare(b.id));
  return items;
}

/** Index of the last item with t <= now (−1 if none). */
export function nowIndex(items: FeedItem[], t: number): number {
  let lo = 0, hi = items.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (items[mid].t <= t) lo = mid + 1; else hi = mid; }
  return lo - 1;
}
