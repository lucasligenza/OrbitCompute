// Pure interpolation of engine samples. Scrubbing is a lookup: sampleAt(result, t) depends only on
// (result, t). Sample k is the state at t_k plus the flows applied over [t_k, t_k + dt).
import type { PreparedNode, PreparedResult, Series } from "./result";

export interface Cursor {
  i: number; // sample index (clamped)
  f: number; // fraction toward i+1 in [0, 1)
}

export function cursorAt(res: PreparedResult, t: number): Cursor {
  const x = Math.min(Math.max(t, 0), res.duration) / res.dt;
  const i = Math.min(Math.floor(x), res.n - 1);
  const f = i >= res.n - 1 ? 0 : x - i;
  return { i, f };
}

/** Linear interpolation for continuous quantities. */
export function lerp(a: Series, c: Cursor): number {
  const i1 = Math.min(c.i + 1, a.length - 1);
  return a[c.i] + (a[i1] - a[c.i]) * c.f;
}

/** Sample-and-hold for discrete states and per-step flows. */
export function hold(a: Series, c: Cursor): number {
  return a[c.i];
}

/** Interpolate an angle that increases monotonically (e.g. GMST) across the 2*pi wrap. */
export function lerpAngle(a: Series, c: Cursor): number {
  const i1 = Math.min(c.i + 1, a.length - 1);
  let d = a[i1] - a[c.i];
  if (d < -Math.PI) d += 2 * Math.PI;
  return a[c.i] + d * c.f;
}

/** Cubic Hermite interpolation of ECI position using velocity (km). */
export function positionEci(nd: PreparedNode, c: Cursor, dt: number, out: [number, number, number]) {
  const { s } = nd;
  const i0 = c.i;
  const i1 = Math.min(c.i + 1, s.r_eci_x.length - 1);
  const f = c.f;
  const h00 = 2 * f ** 3 - 3 * f ** 2 + 1;
  const h10 = f ** 3 - 2 * f ** 2 + f;
  const h01 = -2 * f ** 3 + 3 * f ** 2;
  const h11 = f ** 3 - f ** 2;
  const px = [s.r_eci_x, s.r_eci_y, s.r_eci_z];
  const vx = [s.v_eci_x, s.v_eci_y, s.v_eci_z];
  for (let k = 0; k < 3; k++) {
    out[k] = h00 * px[k][i0] + h10 * dt * vx[k][i0] + h01 * px[k][i1] + h11 * dt * vx[k][i1];
  }
  return out;
}

export const SHADOW = ["SUNLIGHT", "PENUMBRA", "UMBRA"] as const;
export const THERMAL = ["NORMAL", "WARM", "THROTTLED", "THERMAL LIMIT"] as const;
export const LINK = ["NONE", "DIRECT", "ISL", "RELAY"] as const;

export interface NodeSample {
  t: number;
  illum: number; shadow: (typeof SHADOW)[number];
  lat: number; lon: number; alt: number;
  pGen: number; pCompute: number; pPlatform: number; pComms: number; pThermal: number; pHeater: number;
  pLoad: number; pBatt: number; pCurtailed: number; pUnmet: number; soc: number; energy: number;
  tEquip: number; tRad: number; qDiss: number; qReject: number; qEnv: number;
  throttle: number; thermal: (typeof THERMAL)[number]; thermalCode: number;
  powerFactor: number; powerLimited: boolean;
  util: number; allocFrac: number; workRate: number;
  nRunning: number; nStalled: number; nQueued: number; nUplink: number; nDownlink: number;
  link: (typeof LINK)[number]; linkStation: number; linkRelay: number; linkGeo: number;
  linkDown: number; linkUp: number; rangeKm: number; latencyMs: number;
  upBacklog: number; downBacklog: number;
}

export function sampleNode(res: PreparedResult, nd: PreparedNode, t: number): NodeSample {
  const c = cursorAt(res, t);
  const s = nd.s;
  const L = (k: string) => lerp(s[k], c);
  const H = (k: string) => hold(s[k], c);
  const lon = (() => {
    // interpolate longitude across the antimeridian
    const i1 = Math.min(c.i + 1, s.lon_deg.length - 1);
    let d = s.lon_deg[i1] - s.lon_deg[c.i];
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    let v = s.lon_deg[c.i] + d * c.f;
    if (v > 180) v -= 360;
    if (v < -180) v += 360;
    return v;
  })();
  const thermalCode = H("thermal_state");
  return {
    t,
    illum: L("illum"), shadow: SHADOW[H("shadow")] ?? "SUNLIGHT",
    lat: L("lat_deg"), lon, alt: L("alt_km"),
    pGen: L("p_gen_kw"), pCompute: H("p_compute_kw"), pPlatform: H("p_platform_kw"), pComms: H("p_comms_kw"),
    pThermal: H("p_thermal_kw"), pHeater: H("p_heater_kw"), pLoad: H("p_load_kw"), pBatt: H("p_batt_kw"),
    pCurtailed: H("p_curtailed_kw"), pUnmet: H("p_unmet_kw"), soc: L("soc"), energy: L("energy_kwh"),
    tEquip: L("t_equip_c"), tRad: L("t_rad_c"), qDiss: H("q_diss_kw"), qReject: H("q_reject_kw"), qEnv: L("q_env_kw"),
    throttle: H("throttle"), thermal: THERMAL[thermalCode] ?? "NORMAL", thermalCode,
    powerFactor: H("power_factor"), powerLimited: H("power_limited") > 0,
    util: H("util"), allocFrac: H("alloc_frac"), workRate: H("work_rate_ref"),
    nRunning: H("n_running"), nStalled: H("n_stalled"), nQueued: H("n_queued"),
    nUplink: H("n_uplink"), nDownlink: H("n_downlink"),
    link: LINK[H("link_type")] ?? "NONE", linkStation: H("link_station"), linkRelay: H("link_relay"),
    linkGeo: H("link_geo"), linkDown: H("link_down_gbps"), linkUp: H("link_up_gbps"),
    rangeKm: H("range_km"), latencyMs: H("latency_ms"),
    upBacklog: L("uplink_backlog_gbit"), downBacklog: L("downlink_backlog_gbit"),
  };
}

/** Job progress (reference accelerator-hours) at time t, from recorded segments. */
export function jobProgressAt(job: { segments: [number, number, number, number, number, number][] }, t: number) {
  let p = 0;
  for (const [t0, t1, , p0, p1] of job.segments) {
    if (t < t0) break;
    if (t >= t1) { p = p1; continue; }
    p = p0 + ((p1 - p0) * (t - t0)) / Math.max(t1 - t0, 1e-9);
    break;
  }
  return p;
}

export type JobPhase = "pending" | "uplink" | "queued" | "running" | "stalled" | "paused" | "downlink" | "completed" | "rejected";

/** Lifecycle phase of a job at time t, reconstructed from immutable timestamps + segments. */
export function jobPhaseAt(
  job: {
    status: string; node: number; arrival_s: number; ready_s: number | null; first_start_s: number | null;
    compute_done_s: number | null; completion_s: number | null; segments: [number, number, number, number, number, number][];
  },
  t: number,
): JobPhase {
  if (job.status === "rejected" || job.node < 0) return t >= job.arrival_s ? "rejected" : "pending";
  if (t < job.arrival_s) return "pending";
  if (job.completion_s !== null && t >= job.completion_s) return "completed";
  if (job.compute_done_s !== null && t >= job.compute_done_s) return "downlink";
  if (job.ready_s === null || t < job.ready_s) return "uplink";
  for (const seg of job.segments) {
    if (t >= seg[0] && t < seg[1]) return seg[5] ? "stalled" : "running";
  }
  return job.first_start_s !== null && t > job.first_start_s ? "paused" : "queued";
}
