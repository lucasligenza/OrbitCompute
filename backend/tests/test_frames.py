from datetime import datetime, timezone

import numpy as np
import pytest

from orbitcompute.frames import ecef_to_eci, ecef_to_geodetic, eci_to_ecef, geodetic_to_ecef
from orbitcompute.timebase import gmst_rad, jd_from_datetime


def test_jd_of_j2000():
    jd, fr = jd_from_datetime(datetime(2000, 1, 1, 12, tzinfo=timezone.utc))
    assert jd + fr == pytest.approx(2451545.0, abs=1e-9)


def test_gmst_vallado_example_3_5():
    # Vallado Ex. 3-5: 1992-08-20 12:14 UT1 -> GMST = 152.578787886 deg
    jd, fr = jd_from_datetime(datetime(1992, 8, 20, 12, 14, tzinfo=timezone.utc))
    g = np.degrees(gmst_rad(np.array([jd]), np.array([fr])))[0]
    assert g == pytest.approx(152.578787886, abs=1e-6)


def test_eci_ecef_round_trip():
    rng = np.random.default_rng(1)
    r = rng.normal(size=(100, 3)) * 7000
    g = rng.uniform(0, 2 * np.pi, 100)
    assert np.allclose(ecef_to_eci(eci_to_ecef(r, g), g), r, atol=1e-9)


def test_eci_to_ecef_rotation_sense():
    # A point on the ECI x-axis appears at longitude -GMST in ECEF.
    g = np.array([np.radians(30.0)])
    p = eci_to_ecef(np.array([[7000.0, 0, 0]]), g)
    _, lon, _ = ecef_to_geodetic(p)
    assert np.degrees(lon[0]) == pytest.approx(-30.0, abs=1e-9)


@pytest.mark.parametrize("lat,lon,h", [(0, 0, 0), (45, 90, 1.2), (-89.9, -179, 0.5), (78.23, 15.4, 0.45)])
def test_geodetic_round_trip(lat, lon, h):
    p = geodetic_to_ecef(np.radians(lat), np.radians(lon), h)
    la, lo, hh = ecef_to_geodetic(p[None, :])
    assert np.degrees(la[0]) == pytest.approx(lat, abs=1e-8)
    assert np.degrees(lo[0]) == pytest.approx(lon, abs=1e-8)
    assert hh[0] == pytest.approx(h, abs=1e-6)
