from datetime import datetime, timezone

import numpy as np
import pytest

from orbitcompute.constants import AU, R_EARTH
from orbitcompute.eclipse import (
    PENUMBRA,
    SUNLIGHT,
    UMBRA,
    beta_angle_rad,
    eclipse_fraction_estimate,
    illumination_fraction,
    shadow_state,
)
from orbitcompute.orbit import KeplerElements, period_s, propagate_kepler
from orbitcompute.sun import sun_position_eci
from orbitcompute.timebase import jd_from_datetime


def _sun(dt):
    jd, fr = jd_from_datetime(dt)
    return sun_position_eci(np.array([jd]), np.array([fr]))[0]


def test_sun_distance_and_solstice_declination():
    s = _sun(datetime(2026, 6, 21, 8, 24, tzinfo=timezone.utc))
    dec = np.degrees(np.arcsin(s[2] / np.linalg.norm(s)))
    assert dec == pytest.approx(23.44, abs=0.05)
    assert np.linalg.norm(s) / AU == pytest.approx(1.0163, abs=0.002)
    s = _sun(datetime(2026, 12, 21, 20, 50, tzinfo=timezone.utc))
    assert np.degrees(np.arcsin(s[2] / np.linalg.norm(s))) == pytest.approx(-23.44, abs=0.05)


def test_subsolar_side_sunlit_antisolar_umbra():
    sun = np.array([[AU, 0, 0]] * 2)
    sat = np.array([[R_EARTH + 500, 0, 0], [-(R_EARTH + 500), 0, 0]])
    f = illumination_fraction(sat, sun)
    assert f[0] == 1.0 and f[1] == 0.0
    assert list(shadow_state(f)) == [SUNLIGHT, UMBRA]


def test_penumbra_monotonic_transition():
    sun = np.array([AU, 0, 0])
    r = R_EARTH + 550
    # Sweep along a circle in the x-y plane through the shadow boundary on the night side.
    ang = np.radians(np.linspace(100, 125, 4000))
    sat = np.stack([r * np.cos(ang), r * np.sin(ang), np.zeros_like(ang)], axis=1)
    f = illumination_fraction(sat, np.tile(sun, (len(ang), 1)))
    # angle 100 deg is sunlit, 125 deg is in umbra -> f non-increasing along the sweep
    assert f[0] == 1.0 and f[-1] == 0.0
    assert np.all(np.diff(f) <= 1e-12)
    st = shadow_state(f)
    assert (st == PENUMBRA).sum() > 0
    # penumbra ~ solar angular diameter (0.53 deg) of arc -> ~8 s of travel in LEO
    pen_arc = (st == PENUMBRA).sum() * (25 / 4000)
    assert 0.4 < pen_arc < 0.7


def test_beta_zero_eclipse_fraction_matches_formula():
    epoch = datetime(2026, 3, 20, 14, 46, tzinfo=timezone.utc)  # near equinox
    sun = _sun(epoch)
    raan = np.arctan2(sun[1], sun[0])  # orbit plane contains Sun direction (beta ~ 0 for i=0... )
    el = KeplerElements(R_EARTH + 550, 0.0, np.radians(0.0), raan, 0.0, 0.0)
    t = np.linspace(0, period_s(el.a_km), 20000, endpoint=False)
    r, v = propagate_kepler(el, t, use_j2=False)
    f = illumination_fraction(r, np.tile(sun, (len(t), 1)))
    beta = beta_angle_rad(sun[None, :], np.cross(r[:1], v[:1]))[0]
    est = eclipse_fraction_estimate(beta, 550)
    sim = np.mean(f < 0.5)
    assert abs(sim - est) < 0.01
    assert 0.35 < sim < 0.40


def test_high_beta_no_eclipse():
    assert eclipse_fraction_estimate(np.radians(75), 550) == 0.0
