"""FastAPI application. Run: uv run uvicorn orbitcompute.api:app --port 8000"""

from __future__ import annotations

import math
import urllib.request
from datetime import datetime, timezone
from functools import lru_cache

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel

from . import ENGINE_VERSION
from .constants import R_EARTH
from .eclipse import beta_angle_rad, eclipse_fraction_estimate
from .frames import ecef_to_geodetic, eci_to_ecef
from .ground import footprint_half_angle_rad
from .orbit import period_s, propagate_kepler, propagate_tle, tle_mean_elements
from .presets import SCENARIO_PRESETS, catalog, scenario_preset
from .schema import NodeConfig, OrbitConfig, Scenario
from .simulate import resolve_elements, run, scenario_hash
from .store import Store
from .sun import sun_position_eci
from .timebase import gmst_rad, jd_array, parse_epoch

app = FastAPI(title="OrbitCompute API", version=ENGINE_VERSION)
app.add_middleware(GZipMiddleware, minimum_size=2048)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
                   allow_methods=["*"], allow_headers=["*"])


@lru_cache(maxsize=1)
def store() -> Store:
    return Store()


@app.get("/api/health")
def health():
    return {"ok": True, "engine_version": ENGINE_VERSION}


@app.get("/api/catalog")
def get_catalog():
    return catalog()


@app.get("/api/presets/{preset_id}")
def get_preset(preset_id: str):
    if preset_id not in SCENARIO_PRESETS:
        raise HTTPException(404, "unknown preset")
    return scenario_preset(preset_id).model_dump(mode="json")


def _simulate(scenario: Scenario) -> dict:
    h = scenario_hash(scenario)
    cached = store().get_result(h)
    if cached is not None:
        return cached
    result = run(scenario)
    store().put_result(result)
    return result


@app.post("/api/simulate")
def simulate(scenario: Scenario):
    return _simulate(scenario)


@app.get("/api/results")
def list_results(limit: int = 50):
    return store().list_results(limit)


@app.get("/api/results/{h}")
def get_result(h: str):
    r = store().get_result(h)
    if r is None:
        raise HTTPException(404, "result not found")
    return r


class CompareRequest(BaseModel):
    a: Scenario
    b: Scenario


@app.post("/api/compare")
def compare(req: CompareRequest):
    ra, rb = _simulate(req.a), _simulate(req.b)
    keys = sorted(set(ra["metrics"]) & set(rb["metrics"]))
    return {
        "a": {"hash": ra["hash"], "name": ra["scenario"]["name"], "metrics": ra["metrics"]},
        "b": {"hash": rb["hash"], "name": rb["scenario"]["name"], "metrics": rb["metrics"]},
        "delta": {k: rb["metrics"][k] - ra["metrics"][k] for k in keys
                  if isinstance(ra["metrics"][k], (int, float))},
    }


# --- scenarios -----------------------------------------------------------------------------------
@app.get("/api/scenarios")
def list_scenarios():
    return store().list_scenarios()


@app.get("/api/scenarios/{sid}")
def get_scenario(sid: str):
    s = store().get_scenario(sid)
    if s is None:
        raise HTTPException(404, "scenario not found")
    return s


@app.post("/api/scenarios")
def create_scenario(scenario: Scenario):
    return {"id": store().save_scenario(scenario.model_dump(mode="json"))}


@app.put("/api/scenarios/{sid}")
def update_scenario(sid: str, scenario: Scenario):
    return {"id": store().save_scenario(scenario.model_dump(mode="json"), sid)}


@app.delete("/api/scenarios/{sid}")
def delete_scenario(sid: str):
    if not store().delete_scenario(sid):
        raise HTTPException(404, "scenario not found")
    return {"deleted": sid}


# --- orbit preview (design mode) ----------------------------------------------------------------
class OrbitPreviewRequest(BaseModel):
    orbit: OrbitConfig
    epoch_utc: str = "2026-10-04T00:00:00Z"
    min_elevation_deg: float = 10.0
    points: int = 240


@app.post("/api/orbit/preview")
def orbit_preview(req: OrbitPreviewRequest):
    """Quick orbit geometry for design mode (labelled PREVIEW in the UI; not a simulation)."""
    epoch = parse_epoch(req.epoch_utc)
    jd0 = jd_array(epoch, np.array([0.0]))
    r_sun0 = sun_position_eci(*jd0)[0]
    if req.orbit.mode == "tle":
        me = tle_mean_elements(req.orbit.tle_line1, req.orbit.tle_line2)
        per = me["period_s"]
        t = np.linspace(0, per, req.points)
        jd_d, jd_f = jd_array(epoch, t)
        r, v = propagate_tle(req.orbit.tle_line1, req.orbit.tle_line2, jd_d, jd_f)
        alt = me["altitude_km"]
        elements = me
    else:
        node = NodeConfig(id="preview", name="preview", orbit=req.orbit)
        el = resolve_elements(node, epoch, r_sun0)
        per = period_s(el.a_km)
        t = np.linspace(0, per, req.points)
        r, v = propagate_kepler(el, t)
        alt = el.a_km - R_EARTH
        elements = {"a_km": el.a_km, "altitude_km": alt, "eccentricity": el.e,
                    "inclination_deg": math.degrees(el.i_rad), "raan_deg": math.degrees(el.raan_rad),
                    "arg_perigee_deg": math.degrees(el.argp_rad), "mean_anomaly_deg": math.degrees(el.m0_rad),
                    "period_s": per}
    beta = float(beta_angle_rad(r_sun0[None, :], np.cross(r[:1], v[:1]))[0])
    jd_d, jd_f = jd_array(epoch, t)
    lat, lon, _ = ecef_to_geodetic(eci_to_ecef(r, gmst_rad(jd_d, jd_f)))
    ecl = eclipse_fraction_estimate(beta, alt)
    return {
        "provenance": "PREVIEW (Kepler+J2 / SGP4 geometry, cylindrical eclipse estimate)",
        "elements": elements,
        "period_s": per,
        "beta_deg": math.degrees(beta),
        "eclipse_fraction": ecl,
        "eclipse_minutes": ecl * per / 60.0,
        "footprint_half_angle_deg": math.degrees(footprint_half_angle_rad(alt, math.radians(req.min_elevation_deg))),
        "r_eci": np.round(r, 1).tolist(),
        "ground_track": {"lat_deg": np.round(np.degrees(lat), 3).tolist(),
                         "lon_deg": np.round(np.degrees(lon), 3).tolist()},
    }


@app.get("/api/tle/{catnr}")
def fetch_tle(catnr: int):
    """Fetch a current TLE from CelesTrak on explicit user request (REAL data, needs network)."""
    url = f"https://celestrak.org/NORAD/elements/gp.php?CATNR={int(catnr)}&FORMAT=TLE"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:  # noqa: S310 (fixed https host)
            lines = [ln.strip() for ln in resp.read().decode().splitlines() if ln.strip()]
    except Exception as exc:  # pragma: no cover - network dependent
        raise HTTPException(502, f"CelesTrak unavailable: {exc}") from exc
    if len(lines) < 3:
        raise HTTPException(404, "no TLE for that catalog number")
    return {"name": lines[0], "line1": lines[1], "line2": lines[2], "source": url,
            "retrieved_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"), "provenance": "REAL"}
