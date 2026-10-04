import json
from pathlib import Path

import numpy as np
import pytest

from orbitcompute.constants import MU_EARTH, R_EARTH
from orbitcompute.frames import ecef_to_geodetic, eci_to_ecef
from orbitcompute.orbit import (
    KeplerElements,
    j2_rates,
    period_s,
    propagate_kepler,
    propagate_tle,
    sso_inclination_rad,
    tle_epoch_jd,
    tle_mean_elements,
)
from orbitcompute.timebase import gmst_rad

TLE = json.loads((Path(__file__).parents[1] / "data" / "reference_tle.json").read_text())


def test_period_matches_kepler_third_law():
    a = R_EARTH + 550.0
    assert period_s(a) == pytest.approx(2 * np.pi * np.sqrt(a**3 / MU_EARTH), rel=1e-12)
    assert 5700 < period_s(a) < 5760  # ~95.6 min


def test_two_body_returns_to_start_after_one_period():
    el = KeplerElements(R_EARTH + 700, 0.01, np.radians(45), 0.3, 0.7, 1.1)
    t = np.array([0.0, period_s(el.a_km)])
    r, _ = propagate_kepler(el, t, use_j2=False)
    assert np.linalg.norm(r[0] - r[1]) < 1e-6


def test_radius_bounded_by_apsides_and_energy_conserved():
    el = KeplerElements(R_EARTH + 1000, 0.05, np.radians(60), 1.0, 2.0, 0.0)
    t = np.linspace(0, 3 * period_s(el.a_km), 2000)
    r, v = propagate_kepler(el, t, use_j2=False)
    rn = np.linalg.norm(r, axis=1)
    assert rn.min() >= el.a_km * (1 - el.e) - 1e-6
    assert rn.max() <= el.a_km * (1 + el.e) + 1e-6
    energy = 0.5 * np.sum(v * v, axis=1) - MU_EARTH / rn
    assert np.allclose(energy, -MU_EARTH / (2 * el.a_km), rtol=1e-9)


def test_equatorial_orbit_has_zero_latitude():
    el = KeplerElements(R_EARTH + 550, 0.0, 0.0, 0.0, 0.0, 0.0)
    t = np.linspace(0, 6000, 200)
    r, _ = propagate_kepler(el, t)
    lat, _, _ = ecef_to_geodetic(eci_to_ecef(r, np.zeros(len(t))))
    assert np.max(np.abs(lat)) < 1e-9


def test_inclination_bounds_latitude():
    el = KeplerElements(R_EARTH + 550, 0.0, np.radians(53), 0.0, 0.0, 0.0)
    t = np.linspace(0, 6000, 2000)
    r, _ = propagate_kepler(el, t)
    lat, _, _ = ecef_to_geodetic(r)
    assert np.degrees(lat).max() == pytest.approx(53, abs=0.3)  # geodetic slightly > geocentric


def test_sun_synchronous_inclination_and_rate():
    a = R_EARTH + 550
    i = sso_inclination_rad(a)
    assert np.degrees(i) == pytest.approx(97.6, abs=0.1)
    raan_dot, _, _ = j2_rates(a, 0.0, i)
    assert np.degrees(raan_dot) * 86400 == pytest.approx(0.9856, abs=1e-3)  # deg/day


def test_j2_regresses_node_for_prograde():
    raan_dot, _, _ = j2_rates(R_EARTH + 550, 0.0, np.radians(53))
    assert -5.5 < np.degrees(raan_dot) * 86400 < -4.0  # ~ -4.7 deg/day


def test_sgp4_reference_tle_near_epoch():
    jd = tle_epoch_jd(TLE["line1"], TLE["line2"])
    t = np.linspace(0, 6 * 3600, 400)
    jd_day = np.full_like(t, np.floor(jd))
    jd_fr = (jd - np.floor(jd)) + t / 86400
    r, v = propagate_tle(TLE["line1"], TLE["line2"], jd_day, jd_fr)
    lat, _, h = ecef_to_geodetic(eci_to_ecef(r, gmst_rad(jd_day, jd_fr)))
    assert 370 < h.min() and h.max() < 450
    assert np.degrees(np.abs(lat)).max() == pytest.approx(51.6, abs=0.5)
    speed = np.linalg.norm(v, axis=1)
    assert np.all((7.5 < speed) & (speed < 7.8))
    el = tle_mean_elements(TLE["line1"], TLE["line2"])
    assert el["inclination_deg"] == pytest.approx(51.6315, abs=1e-4)
