// User data routes for the packet visualisation.
//
// ILLUSTRATIVE parts: which cities "use" the service and the terrestrial backhaul arcs between
// those cities and the ground endpoint are not modelled by the engine. SIMULATED parts: which
// endpoint is in use (station / GEO-relay ground terminal / via an ISL neighbour), whether any link
// exists, uplink/downlink volumes and realtime inference sessions — all read from the result.
import type { PreparedResult } from "@/sim/result";
import { latLonToLocal } from "@/sim/frames";
import { METROS } from "./cityLights";

export interface Endpoint {
  key: string;
  lat: number;
  lon: number;
  label: string;
  kind: "station" | "relay-ground";
}

export interface Route {
  /** ground endpoint users connect through (home station when there is no link) */
  endpoint: Endpoint | null;
  linkType: number; // 0 none, 1 direct, 2 ISL, 3 GEO relay
  hopNode: number; // ISL neighbour, or -1
  geo: number; // GEO relay index on the path, or -1
  /** seconds until the next ground contact when there is no link (Infinity if none) */
  nextContactIn: number;
}

export interface City { lat: number; lon: number; w: number }

const stationEndpoint = (res: PreparedResult, si: number): Endpoint => {
  const st = res.raw.stations[si];
  return { key: `st${si}`, lat: st.lat_deg, lon: st.lon_deg, label: st.name.split(" (")[0], kind: "station" };
};
const relayGround = (res: PreparedResult, q: number): Endpoint => {
  const rl = res.raw.relays[q];
  // Relay ground terminal assumed at the sub-relay point (illustrative).
  return { key: `rg${q}`, lat: 0, lon: rl.lon_deg, label: `${rl.name.replace(" (illustrative)", "")} ground terminal`, kind: "relay-ground" };
};

export function routeFor(res: PreparedResult, m: number, i: number, t: number): Route {
  const s = res.nodes[m].s;
  const type = s.link_type[i];
  if (type === 1) return { endpoint: stationEndpoint(res, s.link_station[i]), linkType: 1, hopNode: -1, geo: -1, nextContactIn: 0 };
  if (type === 3) return { endpoint: relayGround(res, s.link_geo[i]), linkType: 3, hopNode: -1, geo: s.link_geo[i], nextContactIn: 0 };
  if (type === 2) {
    const o = s.link_relay[i];
    const os = res.nodes[o]?.s;
    if (os && os.link_type[i] === 1) return { endpoint: stationEndpoint(res, os.link_station[i]), linkType: 2, hopNode: o, geo: -1, nextContactIn: 0 };
    if (os && os.link_type[i] === 3) return { endpoint: relayGround(res, os.link_geo[i]), linkType: 2, hopNode: o, geo: os.link_geo[i], nextContactIn: 0 };
  }
  // No link: users keep sending to the "home" station (most recent contact, else the next one).
  const wins = res.nodes[m].raw.contact_windows;
  let last: (typeof wins)[number] | undefined;
  for (const w of wins) if (w[2] <= t) last = w;
  const next = wins.find((w) => w[1] > t);
  const home = last ?? next;
  return {
    endpoint: home ? stationEndpoint(res, home[0]) : null,
    linkType: 0, hopNode: -1, geo: -1,
    nextContactIn: next ? next[1] - t : Infinity,
  };
}

const cityCache = new Map<string, City[]>();
const toRad = Math.PI / 180;
function angle(lat1: number, lon1: number, lat2: number, lon2: number) {
  const a = Math.sin(lat1 * toRad) * Math.sin(lat2 * toRad) + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos((lon2 - lon1) * toRad);
  return Math.acos(Math.min(1, Math.max(-1, a)));
}

/** The six largest-weighted metros near an endpoint (illustrative service area). */
export function citiesNear(ep: Endpoint): City[] {
  const hit = cityCache.get(ep.key);
  if (hit) return hit;
  const scored = METROS.map(([lat, lon, w]) => ({ lat, lon, w, d: angle(ep.lat, ep.lon, lat, lon) }))
    .filter((c) => c.d > 0.004) // skip a city sitting on the station itself
    .sort((a, b) => (a.d - 0.25 * a.w) - (b.d - 0.25 * b.w));
  const out = scored.slice(0, 6).map(({ lat, lon, w }) => ({ lat, lon, w }));
  cityCache.set(ep.key, out);
  return out;
}

const arcCache = new Map<string, Float32Array>();
export const ARC_PTS = 40;

/** Lifted great-circle arc from a city to the endpoint, in Earth-fixed render coordinates. */
export function arcLocal(city: City, ep: Endpoint, R: number): Float32Array {
  const key = `${ep.key}|${city.lat},${city.lon}`;
  const hit = arcCache.get(key);
  if (hit) return hit;
  const a: [number, number, number] = [0, 0, 0], b: [number, number, number] = [0, 0, 0];
  latLonToLocal(city.lat, city.lon, 1, a);
  latLonToLocal(ep.lat, ep.lon, 1, b);
  const om = Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  const so = Math.sin(om) || 1e-6;
  const lift = Math.min(0.06, 0.012 + om * 0.05);
  const out = new Float32Array(ARC_PTS * 3);
  for (let k = 0; k < ARC_PTS; k++) {
    const f = k / (ARC_PTS - 1);
    const wa = Math.sin((1 - f) * om) / so, wb = Math.sin(f * om) / so;
    const r = R * (1.004 + lift * Math.sin(Math.PI * f));
    out[k * 3] = (wa * a[0] + wb * b[0]) * r;
    out[k * 3 + 1] = (wa * a[1] + wb * b[1]) * r;
    out[k * 3 + 2] = (wa * a[2] + wb * b[2]) * r;
  }
  arcCache.set(key, out);
  return out;
}

const rtCache = new WeakMap<PreparedResult, Float32Array[]>();
/** Realtime inference sessions actively served per node per step (from recorded allocations). */
export function realtimeActive(res: PreparedResult): Float32Array[] {
  const hit = rtCache.get(res);
  if (hit) return hit;
  const out = res.nodes.map((nd) => {
    const a = new Float32Array(res.n);
    for (let i = 0; i < res.n; i++) {
      let c = 0;
      for (const [j, , stalled] of nd.raw.alloc[i] ?? []) if (!stalled && res.jobs[j]?.network_dependency === "realtime") c++;
      a[i] = c;
    }
    return a;
  });
  rtCache.set(res, out);
  return out;
}

export interface Flow { up: number; down: number; waiting: number; live: number; stalled: number }

/** Visual intensities in [0, 1] derived from simulated link use and realtime sessions. */
export function flowFor(res: PreparedResult, m: number, i: number): Flow {
  const s = res.nodes[m].s;
  const live = realtimeActive(res)[m][i];
  const stalled = s.n_stalled[i];
  if (s.link_type[i] > 0) {
    const upUtil = s.uplinked_gbit[i] / Math.max(s.link_up_gbps[i] * res.dt, 1e-9);
    const downUtil = s.downlinked_gbit[i] / Math.max(s.link_down_gbps[i] * res.dt, 1e-9);
    const rt = Math.min(live / 4, 1);
    return {
      up: Math.min(1, 0.12 + 0.55 * rt + 0.5 * upUtil),
      down: Math.min(1, 0.12 + 0.55 * rt + 0.5 * downUtil),
      waiting: 0, live, stalled,
    };
  }
  const waiting = Math.min(1, 0.45 * Math.min(stalled / 2, 1) + (s.uplink_backlog_gbit[i] > 0.01 ? 0.35 : 0) + (s.n_queued[i] > 0 ? 0.15 : 0));
  return { up: 0, down: 0, waiting, live, stalled };
}
