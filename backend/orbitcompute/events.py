"""Post-hoc event extraction from recorded series.

Crossing times are refined by linear interpolation between samples, so events are not quantised
to the step size (true for geometry; system-state events are quantised to the step).
"""

from __future__ import annotations

import numpy as np

from .thermal import STATE_NAMES


def _crossings(y: np.ndarray, level: float, t: np.ndarray):
    """Yield (t_cross, direction) where y crosses `level` (+1 upward, -1 downward)."""
    above = y >= level
    idx = np.flatnonzero(above[1:] != above[:-1])
    for i in idx:
        y0, y1 = y[i], y[i + 1]
        frac = 0.5 if y1 == y0 else (level - y0) / (y1 - y0)
        yield float(t[i] + frac * (t[i + 1] - t[i])), (1 if above[i + 1] else -1)


def _edges(flag: np.ndarray, t: np.ndarray):
    """Yield (t, rising?) at sample transitions of a boolean series."""
    idx = np.flatnonzero(flag[1:] != flag[:-1])
    for i in idx:
        yield float(t[i + 1]), bool(flag[i + 1])


def _ev(events, t, node, typ, cat, sev, label, detail="", **extra):
    events.append({"t": round(t, 1), "node": node, "type": typ, "category": cat, "severity": sev,
                   "label": label, "detail": detail, **extra})


def extract_events(result: dict, visible, geo, jobs, rejected, stations) -> list[dict]:
    n = result["time"]["n"]
    dt = result["time"]["step_s"]
    horizon = result["time"]["duration_s"]
    t = np.arange(n) * dt
    events: list[dict] = []
    names = [nd["name"] for nd in result["nodes"]]
    for m, nd in enumerate(result["nodes"]):
        s = {k: np.asarray(v) for k, v in nd["series"].items()}
        name = names[m]
        cfg = result["scenario"]["nodes"][m]
        # Eclipse (illumination fraction crosses 0.5)
        for tc, d in _crossings(s["illum"], 0.5, t):
            if d < 0:
                _ev(events, tc, m, "eclipse_enter", "orbit", "info", f"{name} entered eclipse",
                    "Earth blocks the Sun; arrays stop generating.")
            else:
                _ev(events, tc, m, "eclipse_exit", "orbit", "nominal", f"{name} exited eclipse",
                    "Direct sunlight restored; arrays generating.")
        # Battery
        for tc, d in _crossings(s["soc"], 0.25, t):
            if d < 0:
                _ev(events, tc, m, "soc_low", "power", "warning", f"{name} battery below 25%")
        floor = cfg["battery"]["min_soc"] + 0.005
        for tc, d in _crossings(s["soc"], floor, t):
            if d < 0:
                _ev(events, tc, m, "soc_reserve", "power", "critical", f"{name} battery reserve reached",
                    f"SOC at floor ({cfg['battery']['min_soc'] * 100:.0f}%); no further discharge possible.")
        for tc, rising in _edges(s["power_limited"] > 0, t):
            if rising:
                _ev(events, tc, m, "power_short_start", "power", "warning", f"{name} power shortage",
                    "Bus cannot supply requested load; compute is being shed.")
            else:
                _ev(events, tc, m, "power_short_end", "power", "nominal", f"{name} power shortage ended")
        for tc, rising in _edges(s["p_unmet_kw"] > 1e-9, t):
            if rising:
                _ev(events, tc, m, "outage_start", "power", "critical", f"{name} platform power outage",
                    "Even non-compute loads are unmet.")
        # Thermal
        for tc, rising in _edges(s["throttle"] < 0.999, t):
            if rising:
                _ev(events, tc, m, "throttle_start", "thermal", "warning", f"{name} compute throttling started",
                    "Equipment temperature above throttle threshold; clocks reduced.")
            else:
                _ev(events, tc, m, "throttle_end", "thermal", "nominal", f"{name} compute throttling ended")
        for tc, rising in _edges(s["thermal_state"] >= 3, t):
            if rising:
                _ev(events, tc, m, "thermal_limit", "thermal", "critical", f"{name} {STATE_NAMES[3]}",
                    "Compute halted until the equipment cools.")
        # Ground stations
        for si, st in enumerate(stations):
            el = np.degrees(geo[m].elevation[:, si])
            for tc, d in _crossings(el, st.min_elevation_deg, t):
                if d > 0:
                    _ev(events, tc, m, "aos", "network", "nominal", f"{name} acquired {st.name}",
                        f"Elevation above {st.min_elevation_deg:.0f}° mask.", station=si)
                else:
                    _ev(events, tc, m, "los", "network", "info", f"{name} lost {st.name}", station=si)
        for tc, rising in _edges(s["link_type"] == 2, t):
            if rising:
                k = int(round(tc / dt))
                relay = int(s["link_relay"][k])
                _ev(events, tc, m, "isl_start", "network", "info",
                    f"{name} relaying via {names[relay] if relay >= 0 else 'ISL'}")
        relay_names = [r["name"] for r in result.get("relays", [])]
        for tc, rising in _edges(s["link_type"] == 3, t):
            k = min(int(round(tc / dt)), n - 1)
            q = int(s["link_geo"][k]) if rising else -1
            label = f"{name} relay link via {relay_names[q]}" if rising and q >= 0 else f"{name} relay link lost"
            _ev(events, tc, m, "relay_start" if rising else "relay_end", "network", "info", label)
    for j in jobs:
        if j.node < 0:
            continue
        node_name = names[j.node]
        if j.first_start_s is not None:
            _ev(events, j.first_start_s, j.node, "job_start", "compute", "info",
                f"{j.spec.job_id} started on {node_name}", j.spec.name or "", job=j.idx)
        if j.completion_s is not None:
            late = j.missed
            _ev(events, j.completion_s, j.node, "job_complete", "compute", "warning" if late else "nominal",
                f"{j.spec.job_id} completed{' (late)' if late else ''}", j.spec.name or "", job=j.idx)
        if j.missed and j.spec.deadline_s is not None and j.spec.deadline_s <= horizon:
            _ev(events, j.spec.deadline_s, j.node, "deadline_miss", "compute", "critical",
                f"{j.spec.job_id} missed deadline", j.spec.name or "", job=j.idx)
    for i in rejected:
        j = jobs[i]
        _ev(events, j.spec.arrival_s, -1, "job_rejected", "compute", "warning",
            f"{j.spec.job_id} rejected", "No node has enough accelerators.", job=j.idx)
    events.sort(key=lambda e: (e["t"], e["node"], e["type"]))
    return events
