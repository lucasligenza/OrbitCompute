import numpy as np
import pytest

from orbitcompute.constants import R_EARTH
from orbitcompute.frames import geodetic_to_ecef
from orbitcompute.ground import footprint_half_angle_rad, line_of_sight, look_angles
from orbitcompute.presets import scenario_preset
from orbitcompute.simulate import run


def test_zenith_and_horizon_elevation():
    st = (40.0, -75.0, 0.0)
    above = geodetic_to_ecef(np.radians(40.0), np.radians(-75.0), 550.0)[None, :]
    el, rng = look_angles(above, *st)
    assert np.degrees(el[0]) == pytest.approx(90.0, abs=1e-4)  # asin ill-conditioned at 90 deg
    assert rng[0] == pytest.approx(550.0, abs=1e-6)
    far = geodetic_to_ecef(np.radians(-40.0), np.radians(105.0), 550.0)[None, :]  # antipode
    assert np.degrees(look_angles(far, *st)[0][0]) < -80


def test_footprint_half_angle():
    lam = np.degrees(footprint_half_angle_rad(550.0, np.radians(10.0)))
    # acos(R cos10 / (R+h)) - 10 deg = 24.96 - 10 = 14.96 deg at 550 km
    assert lam == pytest.approx(14.96, abs=0.05)
    assert footprint_half_angle_rad(550.0, 0.0) > footprint_half_angle_rad(550.0, np.radians(10.0))


def test_line_of_sight_blocked_by_earth():
    r = R_EARTH + 550
    a = np.array([[r, 0, 0], [r, 0, 0]])
    b = np.array([[-r, 0, 0], [r * np.cos(0.3), r * np.sin(0.3), 0]])
    assert list(line_of_sight(a, b)) == [False, True]


def test_simulated_visibility_matches_mask_and_events():
    res = run(scenario_preset("leo-inference"))
    nd = res["nodes"][0]
    st_series = np.asarray(nd["series"]["link_station"])
    ltype = np.asarray(nd["series"]["link_type"])
    assert set(np.unique(ltype)) <= {0, 1, 2, 3}
    assert np.all((st_series >= 0) == (ltype == 1))
    # every contact window has an AOS and LOS event pairing (except those cut by the horizon)
    aos = [e for e in res["events"] if e["type"] == "aos"]
    los = [e for e in res["events"] if e["type"] == "los"]
    assert len(aos) > 5 and abs(len(aos) - len(los)) <= len(res["stations"])
    # max elevation of each contact >= mask
    masks = [s["min_elevation_deg"] for s in res["stations"]]
    assert all(w[3] >= masks[w[0]] - 1e-9 for w in nd["contact_windows"])


def test_relays_give_continuous_coverage_for_mid_inclination():
    res = run(scenario_preset("leo-inference"))
    assert res["nodes"][0]["metrics"]["network_availability"] > 0.95
    sc = scenario_preset("leo-inference")
    sc.nodes[0].comms.relay_enabled = False
    m = run(sc)["nodes"][0]["metrics"]
    assert m["network_availability"] < 0.3  # ground contact alone is intermittent
