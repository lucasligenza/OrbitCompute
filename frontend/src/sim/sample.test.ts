import { describe, expect, it } from "vitest";
import { cursorAt, hold, jobPhaseAt, jobProgressAt, lerp, lerpAngle, positionEci, sampleNode } from "./sample";
import { eciToRender, latLonToLocal, lookAngles } from "./frames";
import { explain } from "./explain";
import { prepare, type PreparedResult } from "./result";
import { fmtDur, fmtKw } from "./format";
import type { SimResultRaw } from "./types";

function fakeResult(): PreparedResult {
  const n = 5;
  const dt = 30;
  const arr = (f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));
  const series: Record<string, number[]> = {
    r_eci_x: arr((i) => 7000 * Math.cos(i * 0.01)), r_eci_y: arr((i) => 7000 * Math.sin(i * 0.01)), r_eci_z: arr(() => 0),
    v_eci_x: arr((i) => -7.5 * Math.sin(i * 0.01)), v_eci_y: arr((i) => 7.5 * Math.cos(i * 0.01)), v_eci_z: arr(() => 0),
    lat_deg: arr(() => 0), lon_deg: arr((i) => 178 + i), alt_km: arr(() => 550), illum: [1, 1, 0.5, 0, 0], shadow: [0, 0, 1, 2, 2],
    p_gen_kw: [100, 100, 50, 0, 0], p_compute_kw: arr(() => 40), p_platform_kw: arr(() => 4), p_comms_kw: arr(() => 1),
    p_thermal_kw: arr(() => 2), p_heater_kw: arr(() => 0), p_load_kw: arr(() => 47), p_batt_kw: [40, 40, 3, -47, -47],
    p_curtailed_kw: [13, 13, 0, 0, 0], p_unmet_kw: arr(() => 0), soc: [0.5, 0.52, 0.54, 0.54, 0.5], energy_kwh: arr(() => 30),
    t_equip_c: arr((i) => 40 + i), t_rad_c: arr(() => 20), q_diss_kw: arr(() => 47), q_reject_kw: arr(() => 50), q_env_kw: arr(() => 6),
    throttle: arr(() => 1), thermal_state: arr(() => 0), power_factor: arr(() => 1), power_limited: arr(() => 0),
    util: arr(() => 0.5), alloc_frac: arr(() => 0.5), work_rate_ref: arr(() => 10), n_running: arr(() => 2), n_stalled: arr(() => 0),
    n_queued: arr(() => 1), n_uplink: arr(() => 0), n_downlink: arr(() => 0), link_type: [1, 1, 0, 0, 3], link_station: [0, 0, -1, -1, -1],
    link_relay: arr(() => -1), link_geo: [-1, -1, -1, -1, 0], link_down_gbps: [2, 2, 0, 0, 1.2], link_up_gbps: [0.5, 0.5, 0, 0, 1.2],
    range_km: [900, 900, 0, 0, 72000], latency_ms: [3, 3, 0, 0, 240], uplink_backlog_gbit: arr(() => 0), downlink_backlog_gbit: arr(() => 0),
  };
  const node = { battery: { min_soc: 0.2 }, thermal: { throttle_c: 75, min_operating_c: 0, warm_c: 60, limit_c: 90 }, compute: { accelerator_count: 8 } };
  const raw = {
    engine_version: "test", hash: "h", created_utc: "", scheduler_label: "Priority",
    scenario: { nodes: [node], name: "t" },
    time: { epoch_utc: "2026-10-04T00:00:00Z", step_s: dt, n, duration_s: n * dt },
    sun: { x: arr(() => 1), y: arr(() => 0), z: arr(() => 0), dist_km: arr(() => 1.5e8) },
    gmst_rad: [6.2, 6.25, 6.28, 0.02, 0.05],
    stations: [{ name: "Test Station" }], relays: [{ name: "Relay A" }],
    nodes: [{ id: "N", name: "N", index: 0, orbit: { period_s: 5700 }, derived: {}, series, alloc: [], eclipse_windows: [[75, 150]],
      contact_windows: [[0, 0, 60, 40]], metrics: {} }],
    jobs: [], metrics: {}, checks: {}, provenance: {},
    events: [{ t: 75, node: 0, type: "eclipse_enter", category: "orbit", severity: "info", label: "N entered eclipse", detail: "" }],
  } as unknown as SimResultRaw;
  return prepare(raw);
}

describe("interpolation", () => {
  const res = fakeResult();
  it("cursor clamps and splits", () => {
    expect(cursorAt(res, -10)).toEqual({ i: 0, f: 0 });
    expect(cursorAt(res, 45)).toEqual({ i: 1, f: 0.5 });
    expect(cursorAt(res, 1e9).i).toBe(4);
  });
  it("lerp vs hold", () => {
    const c = cursorAt(res, 45);
    expect(lerp(res.nodes[0].s.p_gen_kw, c)).toBe(75);
    expect(hold(res.nodes[0].s.p_gen_kw, c)).toBe(100);
  });
  it("gmst interpolation crosses 2*pi", () => {
    const v = lerpAngle(res.gmst, cursorAt(res, 75));
    expect(v).toBeGreaterThan(6.28);
    expect(v).toBeLessThan(6.28 + 0.03);
  });
  it("hermite position passes through samples", () => {
    const out: [number, number, number] = [0, 0, 0];
    positionEci(res.nodes[0], { i: 2, f: 0 }, res.dt, out);
    expect(out[0]).toBeCloseTo(res.nodes[0].s.r_eci_x[2], 9);
  });
  it("longitude interpolation wraps the antimeridian", () => {
    const s = sampleNode(res, res.nodes[0], 75); // 180 -> 181(=-179)
    expect(Math.abs(s.lon)).toBeCloseTo(179.5, 6);
  });
  it("scrubbing is a pure lookup", () => {
    const a = JSON.stringify(sampleNode(res, res.nodes[0], 77));
    sampleNode(res, res.nodes[0], 10);
    sampleNode(res, res.nodes[0], 140);
    expect(JSON.stringify(sampleNode(res, res.nodes[0], 77))).toBe(a);
  });
});

describe("frames", () => {
  it("ECI->render is a proper rotation (north is +y)", () => {
    const out: [number, number, number] = [0, 0, 0];
    const north = eciToRender(0, 0, 6378, out);
    expect(north[1]).toBe(6.378);
    expect(Math.abs(north[0]) + Math.abs(north[2])).toBe(0);
    expect(eciToRender(0, 1000, 0, out)[2]).toBe(-1);
    // x cross y = z must map to render x cross render y' = render z'
    const x = [1, 0, 0], y = [0, 0, -1], z = [0, 1, 0];
    const cross = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
    expect(cross.map((v) => v + 0)).toEqual(z); // +0 normalises -0
  });
  it("lon -90 maps to +z render (= -y ECEF)", () => {
    const out: [number, number, number] = [0, 0, 0];
    latLonToLocal(0, -90, 1, out);
    expect(out[2]).toBeCloseTo(1, 12);
  });
});

describe("jobs", () => {
  const job = {
    status: "completed", node: 0, arrival_s: 0, ready_s: 10, first_start_s: 20, compute_done_s: 100, completion_s: 130,
    segments: [[20, 60, 4, 0, 1, 0], [80, 100, 4, 1, 2, 0]] as [number, number, number, number, number, number][],
  };
  it("progress interpolates within segments and holds between", () => {
    expect(jobProgressAt(job, 40)).toBeCloseTo(0.5);
    expect(jobProgressAt(job, 70)).toBe(1);
    expect(jobProgressAt(job, 200)).toBe(2);
  });
  it("phase reconstruction", () => {
    expect(jobPhaseAt(job, 5)).toBe("uplink");
    expect(jobPhaseAt(job, 15)).toBe("queued");
    expect(jobPhaseAt(job, 30)).toBe("running");
    expect(jobPhaseAt(job, 70)).toBe("paused");
    expect(jobPhaseAt(job, 110)).toBe("downlink");
    expect(jobPhaseAt(job, 140)).toBe("completed");
  });
});

describe("explain", () => {
  const res = fakeResult();
  it("is deterministic and reflects eclipse + battery", () => {
    const a = explain(res, 0, 100);
    expect(JSON.stringify(explain(res, 0, 100))).toBe(JSON.stringify(a));
    expect(a.sections.find((s) => s.key === "sun")!.status).toContain("eclipse");
    expect(a.sections.find((s) => s.key === "power")!.status).toBe("On battery");
    expect(a.why.join(" ")).toMatch(/shadow/);
  });
  it("reports contact and next event in sunlight", () => {
    const a = explain(res, 0, 10);
    expect(a.sections.find((s) => s.key === "network")!.status).toContain("Test Station");
    expect(a.next?.t).toBe(75);
  });
});

describe("format", () => {
  it("formats units", () => {
    expect(fmtKw(1500)).toBe("1.50 MW");
    expect(fmtKw(12.34)).toBe("12.3 kW");
    expect(fmtDur(3725)).toBe("1:02:05");
    expect(fmtDur(65)).toBe("01:05");
  });
});

describe("lookAngles", () => {
  // WGS84 geodetic -> ECEF (same formula as the backend)
  const ecef = (lat: number, lon: number, hKm: number): [number, number, number] => {
    const a = 6378.137, e2 = 0.00669437999014, la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
    const N = a / Math.sqrt(1 - e2 * Math.sin(la) ** 2);
    return [(N + hKm) * Math.cos(la) * Math.cos(lo), (N + hKm) * Math.cos(la) * Math.sin(lo), (N * (1 - e2) + hKm) * Math.sin(la)];
  };
  it("zenith pass gives 90 deg elevation and altitude range", () => {
    const st = ecef(37.94, -75.46, 0.01);
    const sat = ecef(37.94, -75.46, 550.01); // with gmst = 0, ECI == ECEF
    const r = lookAngles(sat, 0, st, 37.94, -75.46);
    expect(r.el).toBeCloseTo(90, 3);
    expect(r.range).toBeCloseTo(550, 3);
  });
  it("satellite due north at the horizon side has azimuth ~0 and low elevation", () => {
    const st = ecef(0, 0, 0);
    const sat = ecef(15, 0, 550);
    const r = lookAngles(sat, 0, st, 0, 0);
    expect(r.az).toBeCloseTo(0, 6);
    expect(r.el).toBeGreaterThan(0);
    expect(r.el).toBeLessThan(30);
  });
  it("matches backend elevation for a sample geometry (ground.py look_angles)", () => {
    // Backend reference (uv run python: ground.look_angles): station (37.94, -75.46, 10 m),
    // satellite ECEF (1200, -5200, 4300) km -> el 67.904 deg, range 519.106 km
    const st = ecef(37.94, -75.46, 0.01);
    const r = lookAngles([1200, -5200, 4300], 0, st, 37.94, -75.46);
    expect(r.el).toBeCloseTo(67.904, 2);
    expect(r.range).toBeCloseTo(519.106, 2);
  });
  it("rotation by GMST matches pre-rotated ECEF", () => {
    const st = ecef(10, 20, 0);
    const satEcef = ecef(12, 21, 550);
    const g = 1.234;
    const eci: [number, number, number] = [Math.cos(g) * satEcef[0] - Math.sin(g) * satEcef[1], Math.sin(g) * satEcef[0] + Math.cos(g) * satEcef[1], satEcef[2]];
    const a = lookAngles(eci, g, st, 10, 20), b = lookAngles(satEcef, 0, st, 10, 20);
    expect(a.el).toBeCloseTo(b.el, 9);
    expect(a.az).toBeCloseTo(b.az, 9);
  });
});

describe("mission feed", async () => {
  const { buildFeed, nowIndex } = await import("./feed");
  const res = fakeResult();
  it("starts and ends with mission items, is sorted, and explains events in plain language", () => {
    const f = buildFeed(res);
    expect(f[0].title).toBe("Simulation starts");
    expect(f[f.length - 1].title).toBe("End of simulated horizon");
    for (let i = 1; i < f.length; i++) expect(f[i].t).toBeGreaterThanOrEqual(f[i - 1].t);
    const ecl = f.find((x) => x.title === "Entered Earth's shadow")!;
    expect(ecl.key).toBe(true);
    expect(ecl.meaning).toMatch(/battery/);
  });
  it("derives link changes from recorded link state", () => {
    const f = buildFeed(res);
    expect(f.some((x) => x.title === "No communication link" && x.t === 60)).toBe(true);
    expect(f.some((x) => x.title.startsWith("Link up via") && x.t === 120)).toBe(true);
  });
  it("nowIndex is a binary search over time", () => {
    const f = buildFeed(res);
    expect(nowIndex(f, -1)).toBe(-1);
    expect(f[nowIndex(f, 80)].t).toBeLessThanOrEqual(80);
  });
});
