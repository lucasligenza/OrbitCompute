"""Deterministic integrated simulation of orbital compute nodes.

Sample k represents the instant t_k = k*dt (state: position, SOC, temperatures, throttle) and the
decisions/flows applied over [t_k, t_k + dt) (powers, allocations, transfers).
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, field
from datetime import datetime, timezone

import numpy as np

from . import ENGINE_VERSION
from . import compute as cm
from .constants import C_KM_S, R_EARTH, ZERO_C_K
from .eclipse import beta_angle_rad, illumination_fraction, shadow_state
from .events import extract_events
from .frames import ecef_to_geodetic, eci_to_ecef
from .ground import line_of_sight, look_angles, station_ecef
from .orbit import KeplerElements, period_s, propagate_kepler, propagate_tle, sso_inclination_rad, tle_mean_elements
from .power import Battery, array_power_kw, rated_array_kw, settle_bus, solar_flux_w_m2
from .scheduler import LABELS, POLICIES, Ctx
from .schema import NodeConfig, Scenario
from .sun import sun_position_eci, sun_right_ascension
from .thermal import ThermalModel
from .timebase import jd_array, parse_epoch
from .workloads import (
    COMPLETED,
    DOWNLINK,
    PAUSED,
    QUEUED,
    REJECTED,
    RUNNING,
    UPLINK,
    Job,
    generate_jobs,
)

LINK_NONE, LINK_DIRECT, LINK_ISL, LINK_RELAY = 0, 1, 2, 3
GEO_RADIUS_KM = 42164.0
GEO_ALT_KM = GEO_RADIUS_KM - R_EARTH


def canonical_json(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def scenario_hash(scenario: Scenario) -> str:
    payload = canonical_json(scenario.model_dump(mode="json")) + "|" + ENGINE_VERSION
    return hashlib.sha256(payload.encode()).hexdigest()


# ------------------------------------------------------------------------------------------------
# Geometry
# ------------------------------------------------------------------------------------------------
@dataclass
class Geometry:
    r_eci: np.ndarray
    v_eci: np.ndarray
    lat: np.ndarray
    lon: np.ndarray
    alt: np.ndarray
    illum: np.ndarray
    shadow: np.ndarray
    sun_dist: np.ndarray
    elevation: np.ndarray  # (n, S) rad
    slant: np.ndarray  # (n, S) km
    elements: dict


def resolve_elements(cfg: NodeConfig, epoch: datetime, r_sun0: np.ndarray) -> KeplerElements:
    o = cfg.orbit
    a = R_EARTH + o.altitude_km
    inc = sso_inclination_rad(a, o.eccentricity) if o.sun_synchronous else math.radians(o.inclination_deg)
    if o.ltan_h is not None:
        raan = float(sun_right_ascension(r_sun0)) + math.radians((o.ltan_h - 12.0) * 15.0)
    else:
        raan = math.radians(o.raan_deg)
    return KeplerElements(a, o.eccentricity, inc, raan % (2 * math.pi), math.radians(o.arg_perigee_deg),
                          math.radians(o.mean_anomaly_deg))


def node_geometry(cfg: NodeConfig, epoch: datetime, t: np.ndarray, jd_d, jd_f, gmst, r_sun, stations) -> Geometry:
    if cfg.orbit.mode == "tle":
        r, v = propagate_tle(cfg.orbit.tle_line1, cfg.orbit.tle_line2, jd_d, jd_f)
        me = tle_mean_elements(cfg.orbit.tle_line1, cfg.orbit.tle_line2)
        elements = {"source": "TLE (REAL)", "name": cfg.orbit.tle_name, **{k: float(v_) for k, v_ in me.items()}}
    else:
        el = resolve_elements(cfg, epoch, r_sun[0])
        r, v = propagate_kepler(el, t)
        elements = {
            "source": "Keplerian + J2 secular",
            "a_km": el.a_km, "altitude_km": el.a_km - R_EARTH, "eccentricity": el.e,
            "inclination_deg": math.degrees(el.i_rad), "raan_deg": math.degrees(el.raan_rad),
            "arg_perigee_deg": math.degrees(el.argp_rad), "mean_anomaly_deg": math.degrees(el.m0_rad),
            "period_s": period_s(el.a_km),
        }
    r_ecef = eci_to_ecef(r, gmst)
    lat, lon, alt = ecef_to_geodetic(r_ecef)
    illum = illumination_fraction(r, r_sun)
    beta = beta_angle_rad(r_sun[:1], np.cross(r[:1], v[:1]))[0]
    elements["beta_deg_at_epoch"] = math.degrees(float(beta))
    s = len(stations)
    elev = np.zeros((len(t), s))
    slant = np.zeros((len(t), s))
    for j, st in enumerate(stations):
        elev[:, j], slant[:, j] = look_angles(r_ecef, st.lat_deg, st.lon_deg, st.alt_m)
    return Geometry(r, v, lat, lon, alt, illum, shadow_state(illum), np.linalg.norm(r_sun - r, axis=1),
                    elev, slant, elements)


def _windows(mask: np.ndarray, t: np.ndarray, dt: float) -> list[list[float]]:
    """Contiguous True runs as [t_start, t_end] (sample resolution)."""
    out = []
    n = len(mask)
    k = 0
    while k < n:
        if mask[k]:
            j = k
            while j + 1 < n and mask[j + 1]:
                j += 1
            out.append([float(t[k]), float(t[j] + dt)])
            k = j + 1
        else:
            k += 1
    return out


def _time_to(mask: np.ndarray, dt: float) -> np.ndarray:
    """Seconds until mask is next True (0 where True). Beyond horizon -> +inf."""
    out = np.full(len(mask), np.inf)
    nxt = np.inf
    for k in range(len(mask) - 1, -1, -1):
        if mask[k]:
            nxt = 0.0
        elif np.isfinite(nxt):
            nxt += dt
        out[k] = nxt
    return out


# ------------------------------------------------------------------------------------------------
# Node runtime state
# ------------------------------------------------------------------------------------------------
@dataclass
class NodeState:
    cfg: NodeConfig
    battery: Battery
    thermal: ThermalModel
    t_e: float
    t_r: float
    jobs: list[int] = field(default_factory=list)
    rec: dict = field(default_factory=dict)
    alloc: list = field(default_factory=list)
    backlog_work: float = 0.0

    def push(self, **kw):
        for k, v in kw.items():
            self.rec.setdefault(k, []).append(v)


def _add_segment(job: Job, t0: float, t1: float, k: int, p0: float, p1: float, stalled: bool, s_eff: float):
    seg = job.segments
    if seg and abs(seg[-1][1] - t0) < 1e-6 and seg[-1][2] == k and seg[-1][5] == int(stalled) \
            and abs(seg[-1][6] - s_eff) < 0.05:
        seg[-1][1] = t1
        seg[-1][4] = p1
    else:
        seg.append([t0, t1, k, p0, p1, int(stalled), s_eff])


def run(scenario: Scenario) -> dict:
    sim = scenario.sim
    epoch = parse_epoch(sim.epoch_utc)
    dt = float(sim.step_s)
    n = int(math.floor(sim.duration_s / dt))
    dt_h = dt / 3600.0
    t = np.arange(n) * dt
    jd_d, jd_f = jd_array(epoch, t)
    from .timebase import gmst_rad  # local import keeps namespace small

    gmst = gmst_rad(jd_d, jd_f)
    r_sun = sun_position_eci(jd_d, jd_f)
    stations = scenario.ground_stations
    n_st = len(stations)
    nodes = scenario.nodes
    m_nodes = len(nodes)

    geo = [node_geometry(nc, epoch, t, jd_d, jd_f, gmst, r_sun, stations) for nc in nodes]
    masks = np.radians([s.min_elevation_deg for s in stations]) if n_st else np.zeros(0)
    visible = [g.elevation >= masks[None, :] if n_st else np.zeros((n, 0), bool) for g in geo]
    sunlit = [g.illum >= 0.5 for g in geo]
    t_to_sun = [_time_to(s, dt) for s in sunlit]
    t_to_ecl = [_time_to(~s, dt) for s in sunlit]
    ecl_windows = [_windows(~s, t, dt) for s in sunlit]

    def next_eclipse_duration(m: int) -> np.ndarray:
        out = np.zeros(n)
        wins = ecl_windows[m]
        typical = max((w[1] - w[0] for w in wins), default=0.0)
        wi = 0
        for k in range(n):
            while wi < len(wins) and wins[wi][1] <= t[k]:
                wi += 1
            out[k] = (wins[wi][1] - wins[wi][0]) if wi < len(wins) else typical
        return out

    next_ecl = [next_eclipse_duration(m) for m in range(m_nodes)]
    p_gen = [array_power_kw(nc.solar, g.illum, g.sun_dist) for nc, g in zip(nodes, geo)]
    thermals = [ThermalModel(nc.thermal) for nc in nodes]
    q_env = [th.q_env_w(np.linalg.norm(g.r_eci, axis=1), g.illum, solar_flux_w_m2(g.sun_dist))
             for th, g in zip(thermals, geo)]
    isl_los = {}
    for a in range(m_nodes):
        for b in range(a + 1, m_nodes):
            if nodes[a].comms.isl_enabled and nodes[b].comms.isl_enabled:
                los = line_of_sight(geo[a].r_eci, geo[b].r_eci)
                isl_los[(a, b)] = isl_los[(b, a)] = los

    def initial_temps(nc: NodeConfig, th: ThermalModel, q_env0: float) -> tuple[float, float]:
        if nc.thermal.initial_temp_c is not None:
            t0 = nc.thermal.initial_temp_c + ZERO_C_K
            return t0, t0
        c = nc.compute
        p_c = cm.idle_kw(c) + 0.5 * c.accelerator_count * cm.dynamic_kw_per_accel(c)
        q = (nc.platform.avionics_kw + nc.comms.idle_kw + nc.platform.thermal_base_kw
             + p_c * (1 + nc.platform.pump_fraction)) * 1000.0
        t_e, t_r = th.steady_state(q, q_env0)
        return max(t_e, th.t_min), t_r

    relays = scenario.relays
    relay_los = []  # per node: (n, R) bool, and range km
    for m in range(m_nodes):
        if not relays or not nodes[m].comms.relay_enabled:
            relay_los.append(None)
            continue
        r_ecef = eci_to_ecef(geo[m].r_eci, gmst)
        los = np.zeros((n, len(relays)), bool)
        rng_km = np.zeros((n, len(relays)))
        for q, rl in enumerate(relays):
            lon = math.radians(rl.lon_deg)
            pos = np.array([GEO_RADIUS_KM * math.cos(lon), GEO_RADIUS_KM * math.sin(lon), 0.0])
            los[:, q] = line_of_sight(r_ecef, np.broadcast_to(pos, r_ecef.shape))
            rng_km[:, q] = np.linalg.norm(r_ecef - pos, axis=1)
        relay_los.append((los, rng_km))

    states = []
    for m, (nc, th) in enumerate(zip(nodes, thermals)):
        t_e0, t_r0 = initial_temps(nc, th, float(q_env[m][0]))
        states.append(NodeState(nc, Battery.from_config(nc.battery), th, t_e0, t_r0))
    specs = generate_jobs(scenario.workload, nodes, sim.duration_s)
    jobs = [Job(idx=i, spec=s) for i, s in enumerate(specs)]
    next_arrival = 0
    policy = POLICIES[sim.scheduler]
    rejected: list[int] = []

    # Direct-link selection per node/step: highest elevation visible station.
    direct = []
    for m in range(m_nodes):
        el = np.where(visible[m], geo[m].elevation, -np.inf) if n_st else np.full((n, 0), -np.inf)
        best = np.argmax(el, axis=1) if n_st else np.zeros(n, int)
        has = np.isfinite(el[np.arange(n), best]) if n_st else np.zeros(n, bool)
        direct.append((np.where(has, best, -1)))

    for k in range(n):
        tk = float(t[k])
        # ---- 1. dispatch arrivals ------------------------------------------------------------
        while next_arrival < len(jobs) and jobs[next_arrival].spec.arrival_s <= tk:
            job = jobs[next_arrival]
            next_arrival += 1
            best, best_score = -1, math.inf
            for m, st in enumerate(states):
                c = st.cfg.compute
                if c.accelerator_count < job.min_width:
                    continue
                score = (st.backlog_work + job.spec.work_ref_acc_h) / cm.capacity_ref(c)
                if job.realtime and direct[m][k] >= 0:
                    score *= 0.7
                if score < best_score - 1e-12:
                    best, best_score = m, score
            if best < 0:
                job.state = REJECTED
                rejected.append(job.idx)
                continue
            st = states[best]
            c = st.cfg.compute
            job.node = best
            width = min(job.spec.accelerators, c.accelerator_count)
            job.est_runtime_s = job.spec.work_ref_acc_h / (width * c.relative_throughput) * 3600.0
            job.est_energy_kwh = job.est_runtime_s / 3600.0 * width * c.max_w * c.host_overhead / 1000.0
            if job.needs_input:
                job.state = UPLINK
                job.input_left = job.spec.input_gbit
            else:
                job.state = QUEUED
                job.ready_s = tk
            st.jobs.append(job.idx)
            st.backlog_work += job.spec.work_ref_acc_h

        # ---- per-node step ------------------------------------------------------------------
        links = []
        for m in range(m_nodes):
            d = int(direct[m][k])
            if d >= 0:
                s_ = stations[d]
                c = nodes[m].comms
                links.append((LINK_DIRECT, d, -1, min(s_.downlink_gbps, c.terminal_rate_gbps),
                              min(s_.uplink_gbps, c.terminal_rate_gbps), float(geo[m].slant[k, d])))
            else:
                links.append(None)
        for m in range(m_nodes):
            if relay_los[m] is None or (links[m] is not None and links[m][0] == LINK_DIRECT):
                continue
            los, rng_km = relay_los[m]
            vis = np.flatnonzero(los[k])
            if len(vis) == 0:
                continue
            q = int(vis[np.argmin(rng_km[k, vis])])
            rate = min(relays[q].rate_gbps, nodes[m].comms.relay_rate_gbps)
            if links[m] is None or rate > links[m][3]:
                # (type, station-or-relay index, relay node, down, up, path length incl. GEO->ground)
                links[m] = (LINK_RELAY, q, -1, rate, rate, float(rng_km[k, q]) + GEO_ALT_KM)

        for m in range(m_nodes):
            if links[m] is None and nodes[m].comms.isl_enabled:
                best = None
                for o in range(m_nodes):
                    if o == m or links[o] is None or links[o][0] not in (LINK_DIRECT, LINK_RELAY) or (m, o) not in isl_los:
                        continue
                    if not isl_los[(m, o)][k]:
                        continue
                    hop = float(np.linalg.norm(geo[m].r_eci[k] - geo[o].r_eci[k]))
                    if best is None or hop < best[0]:
                        best = (hop, o)
                if best is not None:
                    hop, o = best
                    _, d, _, down, up, rng = links[o]
                    isl = nodes[m].comms.isl_rate_gbps
                    # ISL to a neighbour that has a direct or GEO-relay link (one hop only)
                    links[m] = (LINK_ISL, d, o, min(down, isl), min(up, isl), rng + hop)
        for m, st in enumerate(states):
            nc = st.cfg
            c = nc.compute
            th = st.thermal
            link = links[m]
            has_link = link is not None
            down_rate = link[3] if has_link else 0.0
            up_rate = link[4] if has_link else 0.0

            # ---- 2. network transfers ---------------------------------------------------
            node_jobs = [jobs[i] for i in st.jobs]
            up_cap = up_rate * dt
            up_done = 0.0
            if up_cap > 0:
                for j in sorted((j for j in node_jobs if j.state == UPLINK),
                                key=lambda j: (-j.spec.priority, j.spec.arrival_s, j.spec.job_id)):
                    if up_cap <= 1e-12:
                        break
                    x = min(up_cap, j.input_left)
                    j.input_left -= x
                    up_cap -= x
                    up_done += x
                    if j.input_left <= 1e-9:
                        j.input_left = 0.0
                        j.state = QUEUED
                        j.ready_s = tk + (up_done / up_rate)
            down_cap = down_rate * dt
            down_done = 0.0
            if down_cap > 0:
                for j in sorted((j for j in node_jobs if j.state == DOWNLINK),
                                key=lambda j: (j.compute_done_s, j.spec.job_id)):
                    if down_cap <= 1e-12:
                        break
                    x = min(down_cap, j.output_left)
                    j.output_left -= x
                    down_cap -= x
                    down_done += x
                    if j.output_left <= 1e-9:
                        j.output_left = 0.0
                        j.state = COMPLETED
                        j.completion_s = tk + down_done / down_rate
            up_backlog = sum(j.input_left for j in node_jobs if j.state == UPLINK)
            down_backlog = sum(j.output_left for j in node_jobs if j.state == DOWNLINK)

            # ---- 3. thermal state ---------------------------------------------------------
            s = th.throttle(st.t_e)
            t_state = th.state(st.t_e)
            heater = th.heater_kw(st.t_e)

            # ---- 4. power budget inputs -----------------------------------------------------
            pg = float(p_gen[m][k])
            p_comms = nc.comms.active_kw if has_link else nc.comms.idle_kw
            pf = nc.platform.pump_fraction
            p_nc = nc.platform.avionics_kw + p_comms + nc.platform.thermal_base_kw + heater
            p_idle = cm.idle_kw(c)
            dyn = cm.dynamic_kw_per_accel(c, s)
            bat = st.battery
            p_bavail = bat.discharge_available_kw(dt_h)

            # ---- 5. schedule -----------------------------------------------------------------
            # Jobs whose input finished uploading mid-step become eligible next step.
            cands = [j for j in node_jobs if j.state in (QUEUED, RUNNING, PAUSED) and j.ready_s <= tk + 1e-9]
            q_rej_net = th.rejection_w(st.t_r) - float(q_env[m][k])
            ctx = Ctx(
                t=tk, dt=dt, n_acc=c.accelerator_count, throughput=c.relative_throughput, s=s,
                per_acc_kw=dyn * (1 + pf), p_gen_kw=pg, p_batt_avail_kw=p_bavail,
                p_base_kw=p_nc + p_idle * (1 + pf), battery_kwh=bat.energy_kwh, battery_min_kwh=bat.e_min,
                battery_max_charge_kw=nc.battery.max_charge_kw, charge_eff=nc.battery.charge_efficiency,
                discharge_eff=nc.battery.discharge_efficiency, illum=float(geo[m].illum[k]),
                time_to_sun_s=float(t_to_sun[m][k]), time_to_eclipse_s=float(t_to_ecl[m][k]),
                next_eclipse_s=float(next_ecl[m][k]), link=has_link, downlink_backlog_gbit=down_backlog,
                downlink_rate_gbps=down_rate if has_link else min(
                    [s_.downlink_gbps for s_ in stations] or [1.0]),
                t_e=st.t_e, t_target=th.t_throttle - 5.0, q_reject_net_w=q_rej_net, c_e=th.c_e,
            )
            alloc = policy(ctx, cands) if c.accelerator_count > 0 and cands else {}
            assert sum(alloc.values()) <= c.accelerator_count

            # ---- 6/7. bus: shed compute if supply is short ------------------------------------
            stalled = {i for i in alloc if jobs[i].realtime and not has_link}
            active = sum(kk for i, kk in alloc.items() if i not in stalled)
            p_dyn = active * dyn
            p_avail = pg + p_bavail
            demand = p_nc + (p_idle + p_dyn) * (1 + pf)
            phi = 1.0
            compute_off = False
            if demand > p_avail + 1e-9:
                room = (p_avail - p_nc) / (1 + pf)
                if room >= p_idle and p_dyn > 0:
                    phi = max(0.0, min(1.0, (room - p_idle) / p_dyn))
                else:
                    phi = 0.0
                    compute_off = room < p_idle
            # compute_off: accelerators powered down (battery at reserve with no generation, etc.)
            p_compute = 0.0 if compute_off else p_idle + p_dyn * phi
            p_thermal = nc.platform.thermal_base_kw + pf * p_compute
            p_load = nc.platform.avionics_kw + p_comms + p_thermal + heater + p_compute
            e_before = bat.energy_kwh
            bus = settle_bus(bat, pg, p_load, dt_h)
            power_limited = (phi < 0.999 and active > 0) or compute_off or bus.unmet_kw > 1e-9

            # ---- 8. thermal integration -----------------------------------------------------
            q_diss = (p_load - bus.unmet_kw) * 1000.0 + bus.loss_kwh / dt_h * 1000.0
            t_e0, t_r0 = st.t_e, st.t_r
            st.t_e, st.t_r, q_rad = th.step(st.t_e, st.t_r, q_diss, float(q_env[m][k]), dt)

            # ---- 9. job progress --------------------------------------------------------------
            s_eff = 0.0 if compute_off else s * phi
            work_rate = 0.0
            alloc_rec = []
            for i in sorted(alloc):
                j = jobs[i]
                kk = alloc[i]
                is_stalled = i in stalled
                if j.first_start_s is None:
                    j.first_start_s = tk
                j.state = RUNNING
                p0 = j.progress
                t_end = tk + dt
                if not is_stalled and s_eff > 0:
                    rate = kk * c.relative_throughput * s_eff  # ref-acc-h per hour
                    work_rate += rate
                    need_h = j.remaining / rate
                    if need_h <= dt_h:
                        t_end = tk + need_h * 3600.0
                        j.progress = j.spec.work_ref_acc_h
                        j.compute_done_s = t_end
                        if j.needs_output:
                            j.state = DOWNLINK
                            j.output_left = j.spec.output_gbit
                        else:
                            j.state = COMPLETED
                            j.completion_s = t_end
                    else:
                        j.progress += rate * dt_h
                st.backlog_work -= j.progress - p0
                _add_segment(j, tk, t_end, kk, p0, j.progress, is_stalled, s_eff)
                alloc_rec.append([i, kk, int(is_stalled)])
            for j in cands:
                if j.idx not in alloc and j.state == RUNNING:
                    j.state = PAUSED
            # ---- deadlines --------------------------------------------------------------------
            for j in node_jobs:
                dl = j.spec.deadline_s
                if dl is None or j.missed:
                    continue
                if j.completion_s is not None:
                    if j.completion_s > dl:
                        j.missed = True
                elif dl <= tk + dt:
                    j.missed = True
            st.jobs = [i for i in st.jobs if jobs[i].state != COMPLETED]

            # ---- 10. record ---------------------------------------------------------------------
            n_running = sum(1 for i in alloc if i not in stalled)
            n_queued = sum(1 for j in node_jobs if j.state in (QUEUED, PAUSED))
            st.alloc.append(alloc_rec)
            ltype, lst, lrel = (link[0], link[1], link[2]) if has_link else (LINK_NONE, -1, -1)
            lgeo = lst if ltype == LINK_RELAY else -1
            lst = -1 if ltype == LINK_RELAY else lst
            rng = link[5] if has_link else 0.0
            st.push(
                p_gen_kw=pg, p_compute_kw=p_compute, p_platform_kw=nc.platform.avionics_kw, p_comms_kw=p_comms,
                p_thermal_kw=p_thermal, p_heater_kw=heater, p_load_kw=p_load,
                p_batt_kw=bus.charge_kw - bus.discharge_kw, p_curtailed_kw=bus.curtailed_kw,
                p_unmet_kw=bus.unmet_kw, batt_loss_kwh=bus.loss_kwh,
                soc=e_before / nc.battery.capacity_kwh if nc.battery.capacity_kwh > 0 else 0.0,
                energy_kwh=e_before, t_equip_c=t_e0 - ZERO_C_K, t_rad_c=t_r0 - ZERO_C_K,
                q_diss_kw=q_diss / 1000.0, q_reject_kw=q_rad / 1000.0, q_env_kw=float(q_env[m][k]) / 1000.0,
                throttle=s, thermal_state=t_state, power_factor=0.0 if compute_off else phi,
                power_limited=int(power_limited),
                util=(active * s_eff) / c.accelerator_count if c.accelerator_count else 0.0,
                alloc_frac=sum(alloc.values()) / c.accelerator_count if c.accelerator_count else 0.0,
                work_rate_ref=work_rate, n_running=n_running, n_stalled=len(stalled), n_queued=n_queued,
                n_uplink=sum(1 for j in node_jobs if j.state == UPLINK),
                n_downlink=sum(1 for j in node_jobs if j.state == DOWNLINK),
                link_type=ltype, link_station=lst, link_relay=lrel, link_geo=lgeo,
                link_down_gbps=down_rate, link_up_gbps=up_rate, range_km=rng,
                latency_ms=rng / C_KM_S * 1000.0, uplinked_gbit=up_done, downlinked_gbit=down_done,
                uplink_backlog_gbit=up_backlog, downlink_backlog_gbit=down_backlog,
            )
            st.rec.setdefault("_e_after", []).append(bat.energy_kwh)

    return _assemble(scenario, epoch, t, dt, gmst, r_sun, geo, states, jobs, rejected, ecl_windows,
                     visible, stations)


# ------------------------------------------------------------------------------------------------
# Result assembly
# ------------------------------------------------------------------------------------------------
def _r(a, nd=3):
    return np.round(np.asarray(a, dtype=float), nd).tolist()


def _node_metrics(rec: dict, dt: float, jobs_on: list[Job], horizon: float) -> dict:
    dt_h = dt / 3600.0
    a = {k: np.asarray(v) for k, v in rec.items()}
    started = [j for j in jobs_on if j.first_start_s is not None and j.ready_s is not None]
    completed = [j for j in jobs_on if j.state == COMPLETED]
    return {
        "jobs_assigned": len(jobs_on),
        "jobs_completed": len(completed),
        "deadline_misses": sum(1 for j in jobs_on if j.missed),
        "mean_queue_time_s": float(np.mean([j.first_start_s - j.ready_s for j in started])) if started else 0.0,
        "mean_turnaround_s": float(np.mean([j.completion_s - j.spec.arrival_s for j in completed])) if completed else 0.0,
        "work_done_ref_acc_h": float(np.sum(a["work_rate_ref"]) * dt_h),
        "energy_consumed_kwh": float(np.sum(a["p_load_kw"] - a["p_unmet_kw"]) * dt_h),
        "compute_energy_kwh": float(np.sum(a["p_compute_kw"]) * dt_h),
        "solar_available_kwh": float(np.sum(a["p_gen_kw"]) * dt_h),
        "curtailed_kwh": float(np.sum(a["p_curtailed_kw"]) * dt_h),
        "unmet_kwh": float(np.sum(a["p_unmet_kw"]) * dt_h),
        "battery_losses_kwh": float(np.sum(a["batt_loss_kwh"])),
        "utilization_mean": float(np.mean(a["util"])),
        "throttled_time_s": float(np.sum(a["throttle"] < 0.999) * dt),
        "thermal_limit_time_s": float(np.sum(a["thermal_state"] == 3) * dt),
        "power_limited_time_s": float(np.sum(a["power_limited"]) * dt),
        "outage_time_s": float(np.sum(a["p_unmet_kw"] > 1e-9) * dt),
        "network_availability": float(np.mean(a["link_type"] > 0)),
        "direct_contact_fraction": float(np.mean(a["link_type"] == LINK_DIRECT)),
        "uplinked_gbit": float(np.sum(a["uplinked_gbit"])),
        "downlinked_gbit": float(np.sum(a["downlinked_gbit"])),
        "min_soc": float(np.min(a["soc"])),
        "max_equip_temp_c": float(np.max(a["t_equip_c"])),
        "compute_availability": float(np.mean((a["power_factor"] > 0.999) & (a["thermal_state"] < 3))),
    }


def _aggregate(per_node: list[dict], jobs: list[Job], rejected: list[int]) -> dict:
    def tot(k):
        return float(sum(p[k] for p in per_node))

    def mean(k):
        return float(np.mean([p[k] for p in per_node]))

    started = [j for j in jobs if j.first_start_s is not None and j.ready_s is not None]
    completed = [j for j in jobs if j.state == COMPLETED]
    return {
        "jobs_total": len(jobs),
        "jobs_rejected": len(rejected),
        "jobs_completed": len(completed),
        "deadline_misses": sum(1 for j in jobs if j.missed),
        "mean_queue_time_s": float(np.mean([j.first_start_s - j.ready_s for j in started])) if started else 0.0,
        "work_done_ref_acc_h": tot("work_done_ref_acc_h"),
        "energy_consumed_kwh": tot("energy_consumed_kwh"),
        "compute_energy_kwh": tot("compute_energy_kwh"),
        "solar_available_kwh": tot("solar_available_kwh"),
        "curtailed_kwh": tot("curtailed_kwh"),
        "unmet_kwh": tot("unmet_kwh"),
        "utilization_mean": mean("utilization_mean"),
        "throttled_time_s": tot("throttled_time_s"),
        "thermal_limit_time_s": tot("thermal_limit_time_s"),
        "power_limited_time_s": tot("power_limited_time_s"),
        "outage_time_s": tot("outage_time_s"),
        "network_availability": mean("network_availability"),
        "downlinked_gbit": tot("downlinked_gbit"),
        "uplinked_gbit": tot("uplinked_gbit"),
        "min_soc": float(min(p["min_soc"] for p in per_node)),
        "max_equip_temp_c": float(max(p["max_equip_temp_c"] for p in per_node)),
        "compute_availability": mean("compute_availability"),
    }


def _assemble(scenario, epoch, t, dt, gmst, r_sun, geo, states, jobs, rejected, ecl_windows, visible, stations):
    n = len(t)
    horizon = n * dt
    sun_dist = np.linalg.norm(r_sun, axis=1)
    sun_unit = r_sun / sun_dist[:, None]
    node_out = []
    per_node_metrics = []
    checks = {"energy_identity_max_residual_kw": 0.0, "battery_update_max_residual_kwh": 0.0,
              "battery_bounds_ok": True, "thermal_bounds_ok": True}
    for m, (st, g) in enumerate(zip(states, geo)):
        rec = st.rec
        a = {k: np.asarray(v, dtype=float) for k, v in rec.items()}
        nc = st.cfg
        bat = nc.battery
        # Conservation checks
        charge = np.clip(a["p_batt_kw"], 0, None)
        dis = np.clip(-a["p_batt_kw"], 0, None)
        resid = a["p_gen_kw"] + dis + a["p_unmet_kw"] - (a["p_load_kw"] + charge + a["p_curtailed_kw"])
        checks["energy_identity_max_residual_kw"] = max(checks["energy_identity_max_residual_kw"],
                                                        float(np.max(np.abs(resid))) if n else 0.0)
        de = a["_e_after"] - a["energy_kwh"]
        expected = (charge * bat.charge_efficiency - dis / bat.discharge_efficiency) * dt / 3600.0
        checks["battery_update_max_residual_kwh"] = max(checks["battery_update_max_residual_kwh"],
                                                        float(np.max(np.abs(de - expected))) if n else 0.0)
        e_min = bat.capacity_kwh * min(bat.emergency_soc, bat.min_soc)
        e_max = bat.capacity_kwh * bat.max_soc
        if np.any(a["energy_kwh"] < e_min - 1e-6) or np.any(a["energy_kwh"] > e_max + 1e-6):
            checks["battery_bounds_ok"] = False
        if not (np.all(np.isfinite(a["t_equip_c"])) and a["t_equip_c"].min() > -270 and a["t_equip_c"].max() < 330):
            checks["thermal_bounds_ok"] = False

        jobs_on = [j for j in jobs if j.node == m]
        metrics = _node_metrics(rec, dt, jobs_on, horizon)
        per_node_metrics.append(metrics)
        contact = []
        for s_i in range(len(stations)):
            for w in _windows(visible[m][:, s_i], t, dt):
                k0, k1 = int(round(w[0] / dt)), int(round(w[1] / dt))
                contact.append([s_i, w[0], w[1], float(np.degrees(g.elevation[k0:k1, s_i].max()))])
        contact.sort(key=lambda c: (c[1], c[0]))
        c = nc.compute
        series = {
            "r_eci_x": _r(g.r_eci[:, 0], 2), "r_eci_y": _r(g.r_eci[:, 1], 2), "r_eci_z": _r(g.r_eci[:, 2], 2),
            "v_eci_x": _r(g.v_eci[:, 0], 5), "v_eci_y": _r(g.v_eci[:, 1], 5), "v_eci_z": _r(g.v_eci[:, 2], 5),
            "lat_deg": _r(np.degrees(g.lat), 4), "lon_deg": _r(np.degrees(g.lon), 4), "alt_km": _r(g.alt, 2),
            "illum": _r(g.illum, 4), "shadow": g.shadow.astype(int).tolist(),
        }
        for key, vals in rec.items():
            if key.startswith("_") or key == "batt_loss_kwh":
                continue
            arr = np.asarray(vals)
            series[key] = arr.astype(int).tolist() if arr.dtype.kind in "ib" else _r(arr, 4)
        node_out.append({
            "id": nc.id,
            "name": nc.name,
            "index": m,
            "orbit": g.elements,
            "derived": {
                "rated_solar_kw": rated_array_kw(nc.solar),
                "compute_max_kw": cm.max_kw(c),
                "compute_idle_kw": cm.idle_kw(c),
                "capacity_ref_acc": cm.capacity_ref(c),
                "battery_usable_kwh": bat.capacity_kwh * (bat.max_soc - bat.min_soc),
                "radiator_capacity_kw_at_throttle": st.thermal.rejection_w(st.thermal.t_throttle - 10) / 1000.0,
                "thermal_substeps": st.thermal.substeps(dt),
                "accelerator_class": c.accelerator_class,
            },
            "series": series,
            "alloc": st.alloc,
            "eclipse_windows": ecl_windows[m],
            "contact_windows": contact,
            "metrics": metrics,
        })

    job_out = []
    for j in jobs:
        status = j.state
        job_out.append({
            "idx": j.idx, "job_id": j.spec.job_id, "name": j.spec.name, "type": j.spec.type,
            "priority": j.spec.priority, "node": j.node, "accelerators": j.spec.accelerators,
            "work_ref_acc_h": j.spec.work_ref_acc_h, "input_gbit": j.spec.input_gbit,
            "output_gbit": j.spec.output_gbit, "network_dependency": j.spec.network_dependency,
            "arrival_s": j.spec.arrival_s, "deadline_s": j.spec.deadline_s, "ready_s": j.ready_s,
            "first_start_s": j.first_start_s, "compute_done_s": j.compute_done_s, "completion_s": j.completion_s,
            "status": status, "missed": j.missed, "progress": j.progress,
            "est_runtime_s": round(j.est_runtime_s, 1), "est_energy_kwh": round(j.est_energy_kwh, 3),
            "segments": [[round(s[0], 1), round(s[1], 1), s[2], round(s[3], 5), round(s[4], 5), s[5]]
                         for s in j.segments],
        })

    result = {
        "engine_version": ENGINE_VERSION,
        "hash": scenario_hash(scenario),
        "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "scenario": scenario.model_dump(mode="json"),
        "scheduler_label": LABELS[scenario.sim.scheduler],
        "time": {"epoch_utc": epoch.isoformat().replace("+00:00", "Z"), "step_s": dt, "n": n,
                 "duration_s": horizon},
        "sun": {"x": _r(sun_unit[:, 0], 6), "y": _r(sun_unit[:, 1], 6), "z": _r(sun_unit[:, 2], 6),
                "dist_km": _r(sun_dist, 0)},
        "gmst_rad": _r(gmst, 7),
        "stations": [{**s.model_dump(), "ecef_km": station_ecef(s.lat_deg, s.lon_deg, s.alt_m).tolist()}
                     for s in stations],
        "relays": [{**rl.model_dump(), "radius_km": GEO_RADIUS_KM} for rl in scenario.relays],
        "nodes": node_out,
        "jobs": job_out,
        "metrics": _aggregate(per_node_metrics, jobs, rejected),
        "checks": checks,
        "provenance": {
            "orbit": "PHYSICS (Kepler+J2) or REAL input propagated with SGP4",
            "eclipse": "PHYSICS (conical shadow)",
            "power": "MODEL", "thermal": "MODEL (simplified 2-node)", "compute": "MODEL",
            "network": "MODEL (geometric visibility, fixed rates; GEO relays illustrative)", "scheduler": "MODEL — not flight validation",
        },
    }
    result["events"] = extract_events(result, visible, geo, jobs, rejected, stations)
    return result
