// Prepared (immutable) result: JSON arrays converted to typed arrays once.
import type { JobRecord, NodeResultRaw, SimEvent, SimResultRaw } from "./types";

export type Series = Float64Array;

export interface PreparedNode {
  raw: NodeResultRaw;
  id: string;
  name: string;
  index: number;
  s: Record<string, Series>;
  /** job indices on this node, sorted */
  jobIdx: number[];
}

export interface PreparedResult {
  raw: SimResultRaw;
  hash: string;
  dt: number;
  n: number;
  duration: number;
  epochMs: number;
  sun: { x: Series; y: Series; z: Series };
  gmst: Series;
  nodes: PreparedNode[];
  jobs: JobRecord[];
  events: SimEvent[];
}

export function prepare(raw: SimResultRaw): PreparedResult {
  const toArr = (a: number[]) => Float64Array.from(a);
  const nodes: PreparedNode[] = raw.nodes.map((nd) => {
    const s: Record<string, Series> = {};
    for (const [k, v] of Object.entries(nd.series)) s[k] = toArr(v);
    return {
      raw: nd, id: nd.id, name: nd.name, index: nd.index, s,
      jobIdx: raw.jobs.filter((j) => j.node === nd.index).map((j) => j.idx),
    };
  });
  return {
    raw,
    hash: raw.hash,
    dt: raw.time.step_s,
    n: raw.time.n,
    duration: raw.time.duration_s,
    epochMs: Date.parse(raw.time.epoch_utc),
    sun: { x: toArr(raw.sun.x), y: toArr(raw.sun.y), z: toArr(raw.sun.z) },
    gmst: toArr(raw.gmst_rad),
    nodes,
    jobs: raw.jobs,
    events: raw.events,
  };
}
