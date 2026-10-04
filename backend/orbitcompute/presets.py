"""Illustrative presets (PRESET). Examples only — not real spacecraft proposals or product specs."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

from .schema import Scenario

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
REFERENCE_TLE: dict = json.loads((DATA_DIR / "reference_tle.json").read_text())

# --- Accelerator classes (order-of-magnitude public TDP ranges; generic, not products) ----------
ACCELERATOR_CLASSES: dict[str, dict[str, Any]] = {
    "dc-700": {
        "label": "Datacenter accelerator class (~700 W)",
        "idle_w": 100.0, "max_w": 700.0, "relative_throughput": 1.0, "memory_gb": 80.0,
    },
    "hp-1000": {
        "label": "High-power accelerator class (~1 kW)",
        "idle_w": 150.0, "max_w": 1000.0, "relative_throughput": 1.8, "memory_gb": 192.0,
    },
    "inf-350": {
        "label": "Efficient inference accelerator class (~350 W)",
        "idle_w": 50.0, "max_w": 350.0, "relative_throughput": 0.45, "memory_gb": 48.0,
    },
    "rad-60": {
        "label": "Radiation-tolerant compute class (~60 W)",
        "idle_w": 15.0, "max_w": 60.0, "relative_throughput": 0.03, "memory_gb": 16.0,
    },
}

# --- Orbit presets ------------------------------------------------------------------------------
ORBIT_PRESETS: dict[str, dict[str, Any]] = {
    "leo-equatorial": {"label": "LEO equatorial (550 km, 0°)", "altitude_km": 550, "inclination_deg": 0.0},
    "leo-mid-inclination": {"label": "Mid-inclination LEO (550 km, 53°)", "altitude_km": 550, "inclination_deg": 53.0},
    "leo-sso-dawn-dusk": {
        "label": "Sun-synchronous dawn–dusk (600 km, LTAN 18:00)",
        "altitude_km": 600, "sun_synchronous": True, "ltan_h": 18.0,
    },
    "leo-sso-noon": {
        "label": "Sun-synchronous noon–midnight (550 km, LTAN 12:00)",
        "altitude_km": 550, "sun_synchronous": True, "ltan_h": 12.0,
    },
    "high-leo": {"label": "High LEO (1100 km, 53°)", "altitude_km": 1100, "inclination_deg": 53.0},
    "iss-reference": {
        "label": f"Reference: {REFERENCE_TLE['name']} orbit (real TLE)",
        "mode": "tle", "tle_name": REFERENCE_TLE["name"],
        "tle_line1": REFERENCE_TLE["line1"], "tle_line2": REFERENCE_TLE["line2"],
    },
}

# --- Ground stations: approximate public site coordinates (REAL), link parameters (PRESET) ------
GROUND_STATIONS: list[dict[str, Any]] = [
    {"id": "wallops", "name": "Wallops, Virginia (USA)", "lat_deg": 37.94, "lon_deg": -75.46, "alt_m": 10},
    {"id": "svalbard", "name": "Svalbard (Norway)", "lat_deg": 78.23, "lon_deg": 15.41, "alt_m": 450},
    {"id": "troll", "name": "Troll, Antarctica", "lat_deg": -72.01, "lon_deg": 2.54, "alt_m": 1270},
    {"id": "fairbanks", "name": "Fairbanks, Alaska (USA)", "lat_deg": 64.86, "lon_deg": -147.85, "alt_m": 200},
    {"id": "hartebeesthoek", "name": "Hartebeesthoek (South Africa)", "lat_deg": -25.89, "lon_deg": 27.69, "alt_m": 1415},
    {"id": "new-norcia", "name": "New Norcia (Australia)", "lat_deg": -31.05, "lon_deg": 116.19, "alt_m": 250},
    {"id": "okinawa", "name": "Okinawa (Japan)", "lat_deg": 26.50, "lon_deg": 127.90, "alt_m": 50},
    {"id": "punta-arenas", "name": "Punta Arenas (Chile)", "lat_deg": -52.94, "lon_deg": -70.85, "alt_m": 20},
]
# Illustrative geostationary data relays (PRESET; not modelled on any specific system).
GEO_RELAYS: list[dict[str, Any]] = [
    {"id": "relay-a", "name": "GEO relay A (illustrative)", "lon_deg": -41.0, "rate_gbps": 1.2},
    {"id": "relay-b", "name": "GEO relay B (illustrative)", "lon_deg": 79.0, "rate_gbps": 1.2},
    {"id": "relay-c", "name": "GEO relay C (illustrative)", "lon_deg": -171.0, "rate_gbps": 1.2},
]

_STATION_DEFAULTS = {"min_elevation_deg": 10.0, "downlink_gbps": 2.0, "uplink_gbps": 0.5}


def stations(*ids: str, **overrides: Any) -> list[dict[str, Any]]:
    by_id = {s["id"]: s for s in GROUND_STATIONS}
    return [{**_STATION_DEFAULTS, **by_id[i], **overrides} for i in ids]


ALL_STATIONS = [s["id"] for s in GROUND_STATIONS]


def _merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def node(node_id: str, name: str, accel: str, count: int, **over: Any) -> dict:
    cls = ACCELERATOR_CLASSES[accel]
    base = {
        "id": node_id,
        "name": name,
        "compute": {
            "accelerator_class": accel, "accelerator_count": count,
            "idle_w": cls["idle_w"], "max_w": cls["max_w"],
            "relative_throughput": cls["relative_throughput"], "memory_gb": cls["memory_gb"],
        },
    }
    return _merge(base, over)


def orbit(preset: str, **over: Any) -> dict:
    p = {k: v for k, v in ORBIT_PRESETS[preset].items() if k != "label"}
    return {"preset": preset, **p, **over}


SCENARIO_PRESETS: dict[str, dict[str, Any]] = {
    "leo-inference": {
        "name": "LEO inference node",
        "description": "A single mid-inclination node serving latency-sensitive inference. Eclipses every orbit; "
                       "realtime sessions rely on illustrative GEO relays between ground contacts — try disabling them.",
        "sim": {"duration_s": 12 * 3600, "step_s": 30, "scheduler": "network"},
        "nodes": [node("OC-01", "OC-01", "inf-350", 96,
                       orbit=orbit("leo-mid-inclination"),
                       compute={"host_overhead": 1.3},
                       solar={"area_m2": 300},
                       battery={"capacity_kwh": 60, "max_charge_kw": 40, "max_discharge_kw": 70},
                       thermal={"radiator_area_m2": 110},
                       comms={"relay_enabled": True, "relay_rate_gbps": 1.2})],
        "ground_stations": stations(*ALL_STATIONS),
        "workload": {"seed": 7, "intensity": 0.8,
                     "mix": {"inference": 0.6, "training": 0.0, "batch": 0.2, "background": 0.2}},
    },
    "sso-batch": {
        "name": "Sun-synchronous batch compute",
        "description": "Dawn–dusk sun-synchronous orbit: near-continuous sunlight in this season, a small battery, "
                       "and batch jobs limited by polar ground-station downlink.",
        "sim": {"duration_s": 12 * 3600, "step_s": 30, "scheduler": "network"},
        "nodes": [node("OC-SSO", "OC-SSO", "dc-700", 128,
                       orbit=orbit("leo-sso-dawn-dusk"),
                       solar={"area_m2": 420},
                       battery={"capacity_kwh": 40, "max_charge_kw": 30, "max_discharge_kw": 60},
                       thermal={"radiator_area_m2": 360, "conductance_kw_per_k": 8.0,
                                "equipment_heat_capacity_kj_per_k": 6000},
                       comms={"terminal_rate_gbps": 10})],
        "ground_stations": stations("svalbard", "troll", "fairbanks", "wallops", "punta-arenas",
                                    downlink_gbps=3.0, uplink_gbps=1.0),
        "workload": {"seed": 11, "intensity": 0.9,
                     "mix": {"inference": 0.0, "training": 0.2, "batch": 0.6, "background": 0.2}},
    },
    "power-constrained-training": {
        "name": "Power-constrained training satellite",
        "description": "Compute hardware sized beyond what the arrays can sustain over an orbit. Compare FIFO against "
                       "the energy-aware scheduler.",
        "sim": {"duration_s": 12 * 3600, "step_s": 30, "scheduler": "energy"},
        "nodes": [node("OC-TR", "OC-TR", "dc-700", 64,
                       orbit=orbit("leo-mid-inclination", altitude_km=500),
                       solar={"area_m2": 150},
                       battery={"capacity_kwh": 80, "max_charge_kw": 40, "max_discharge_kw": 80,
                                "initial_soc": 0.7},
                       thermal={"radiator_area_m2": 170})],
        "ground_stations": stations("wallops", "svalbard", "hartebeesthoek", "new-norcia"),
        "workload": {"seed": 3, "intensity": 1.0,
                     "mix": {"inference": 0.0, "training": 0.7, "batch": 0.0, "background": 0.3}},
    },
    "distributed-inference": {
        "name": "Distributed inference constellation",
        "description": "Six inference nodes in three planes, flying in pairs 30° apart. One node per pair carries a "
                       "GEO-relay terminal; its partner reaches the network through an inter-satellite link.",
        "sim": {"duration_s": 12 * 3600, "step_s": 30, "scheduler": "network"},
        "nodes": [
            node(f"OC-{p}{k}", f"OC-{p}{k}", "inf-350", 32,
                 orbit=orbit("leo-mid-inclination", raan_deg=120.0 * (ord(p) - 65),
                             mean_anomaly_deg=30.0 * k + 120.0 * (ord(p) - 65)),
                 compute={"host_overhead": 1.3},
                 solar={"area_m2": 105},
                 battery={"capacity_kwh": 25, "max_charge_kw": 15, "max_discharge_kw": 25},
                 thermal={"radiator_area_m2": 60, "equipment_heat_capacity_kj_per_k": 1000,
                          "conductance_kw_per_k": 1.5, "heater_max_kw": 2.0},
                 platform={"avionics_kw": 1.5, "thermal_base_kw": 0.4},
                 comms={"isl_enabled": True, "isl_rate_gbps": 5.0, "relay_enabled": k == 0})
            for p in "ABC" for k in (0, 1)
        ],
        "ground_stations": stations(*ALL_STATIONS),
        "workload": {"seed": 21, "intensity": 0.8,
                     "mix": {"inference": 0.7, "training": 0.0, "batch": 0.2, "background": 0.1}},
    },
    "large-training": {
        "name": "Large orbital training platform",
        "description": "A megawatt-class training platform. The radiator is deliberately marginal: watch thermal "
                       "throttling, then try the thermal-aware scheduler or more radiator area.",
        "sim": {"duration_s": 12 * 3600, "step_s": 30, "scheduler": "priority"},
        "nodes": [node("OC-XL", "OC-XL", "hp-1000", 512,
                       orbit=orbit("leo-mid-inclination", altitude_km=700),
                       compute={"host_overhead": 1.2},
                       solar={"area_m2": 2400},
                       battery={"capacity_kwh": 500, "max_charge_kw": 400, "max_discharge_kw": 800},
                       thermal={"radiator_area_m2": 900, "equipment_heat_capacity_kj_per_k": 40000,
                                "conductance_kw_per_k": 40.0, "heater_max_kw": 20.0},
                       platform={"avionics_kw": 15.0, "thermal_base_kw": 5.0},
                       comms={"terminal_rate_gbps": 40, "active_kw": 4.0})],
        "ground_stations": stations(*ALL_STATIONS, downlink_gbps=5.0, uplink_gbps=2.0),
        "workload": {"seed": 5, "intensity": 0.9,
                     "mix": {"inference": 0.0, "training": 0.8, "batch": 0.0, "background": 0.2}},
    },
    "monolith-128": {
        "name": "Monolithic node (128 accelerators)",
        "description": "One large node. Compare with 'Four distributed nodes' — same total hardware.",
        "sim": {"duration_s": 12 * 3600, "step_s": 30, "scheduler": "network"},
        "nodes": [node("OC-M", "OC-M", "dc-700", 128,
                       orbit=orbit("leo-mid-inclination"),
                       solar={"area_m2": 420},
                       battery={"capacity_kwh": 120, "max_charge_kw": 80, "max_discharge_kw": 140},
                       thermal={"radiator_area_m2": 320, "conductance_kw_per_k": 8.0,
                                "equipment_heat_capacity_kj_per_k": 6000})],
        "ground_stations": stations(*ALL_STATIONS),
        "workload": {"seed": 13, "intensity": 0.85},
    },
    "distributed-4x32": {
        "name": "Four distributed nodes (4 × 32 accelerators)",
        "description": "The monolithic node's hardware split across four nodes in two planes, each with its own "
                       "avionics overhead.",
        "sim": {"duration_s": 12 * 3600, "step_s": 30, "scheduler": "network"},
        "nodes": [
            node(f"OC-D{i + 1}", f"OC-D{i + 1}", "dc-700", 32,
                 orbit=orbit("leo-mid-inclination", raan_deg=90.0 * (i // 2), mean_anomaly_deg=180.0 * (i % 2)),
                 solar={"area_m2": 105},
                 battery={"capacity_kwh": 30, "max_charge_kw": 20, "max_discharge_kw": 35},
                 thermal={"radiator_area_m2": 80, "equipment_heat_capacity_kj_per_k": 1500,
                          "conductance_kw_per_k": 2.0, "heater_max_kw": 2.0},
                 platform={"avionics_kw": 1.5, "thermal_base_kw": 0.4})
            for i in range(4)
        ],
        "ground_stations": stations(*ALL_STATIONS),
        "workload": {"seed": 13, "intensity": 0.85},
    },
    "iss-reference": {
        "name": "Hypothetical node on the ISS orbit (real TLE)",
        "description": "The orbit is real (CelesTrak TLE, propagated with SGP4 from its epoch). The compute node is "
                       "entirely hypothetical.",
        "sim": {"epoch_utc": REFERENCE_TLE["epoch_utc"], "duration_s": 12 * 3600, "step_s": 30,
                "scheduler": "priority"},
        "nodes": [node("OC-ISSREF", "OC-ISSREF", "dc-700", 32,
                       orbit=orbit("iss-reference"),
                       solar={"area_m2": 110},
                       battery={"capacity_kwh": 30, "max_charge_kw": 20, "max_discharge_kw": 35},
                       thermal={"radiator_area_m2": 80, "equipment_heat_capacity_kj_per_k": 1500,
                                "conductance_kw_per_k": 2.0},
                       platform={"avionics_kw": 1.5})],
        "ground_stations": stations(*ALL_STATIONS),
        "workload": {"seed": 1, "intensity": 0.7},
    },
}


def scenario_preset(preset_id: str) -> Scenario:
    raw = copy.deepcopy(SCENARIO_PRESETS[preset_id])
    raw.setdefault("relays", copy.deepcopy(GEO_RELAYS))
    raw["preset_id"] = preset_id
    raw["provenance"] = "PRESET"
    return Scenario.model_validate(raw)


def catalog() -> dict[str, Any]:
    return {
        "scenarios": [
            {"id": k, "name": v["name"], "description": v["description"], "node_count": len(v["nodes"])}
            for k, v in SCENARIO_PRESETS.items()
        ],
        "orbits": ORBIT_PRESETS,
        "accelerators": ACCELERATOR_CLASSES,
        "ground_stations": [{**_STATION_DEFAULTS, **s} for s in GROUND_STATIONS],
        "relays": GEO_RELAYS,
        "reference_tle": REFERENCE_TLE,
    }
