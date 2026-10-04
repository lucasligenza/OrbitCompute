"""Orbit propagation.

- Keplerian elements: two-body + J2 secular drift of RAAN, argument of perigee and mean anomaly
  (Vallado, Fundamentals of Astrodynamics and Applications, 4th ed., §9.6). Frame: ECI.
- TLE: SGP4 via the `sgp4` package (Vallado et al. 2006). Output frame: TEME (= our ECI).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from sgp4.api import Satrec

from .constants import J2, MU_EARTH, R_EARTH, SSO_NODAL_RATE


@dataclass(frozen=True)
class KeplerElements:
    a_km: float
    e: float
    i_rad: float
    raan_rad: float
    argp_rad: float
    m0_rad: float


def mean_motion(a_km: float) -> float:
    return float(np.sqrt(MU_EARTH / a_km**3))


def period_s(a_km: float) -> float:
    return 2.0 * np.pi / mean_motion(a_km)


def j2_rates(a_km: float, e: float, i_rad: float) -> tuple[float, float, float]:
    """Secular J2 rates (rad/s): dRAAN/dt, dArgp/dt, dM/dt (incl. mean motion)."""
    n = mean_motion(a_km)
    p = a_km * (1.0 - e**2)
    k = J2 * (R_EARTH / p) ** 2
    ci = np.cos(i_rad)
    raan_dot = -1.5 * n * k * ci
    argp_dot = 0.75 * n * k * (5.0 * ci**2 - 1.0)
    m_dot = n * (1.0 + 0.75 * k * np.sqrt(1.0 - e**2) * (3.0 * ci**2 - 1.0))
    return float(raan_dot), float(argp_dot), float(m_dot)


def sso_inclination_rad(a_km: float, e: float = 0.0) -> float:
    """Inclination giving a J2 nodal precession equal to the mean solar motion."""
    n = mean_motion(a_km)
    p = a_km * (1.0 - e**2)
    cos_i = -SSO_NODAL_RATE / (1.5 * n * J2 * (R_EARTH / p) ** 2)
    if abs(cos_i) > 1.0:
        raise ValueError("No sun-synchronous inclination exists for this semimajor axis")
    return float(np.arccos(cos_i))


def solve_kepler(m: np.ndarray, e: float, iterations: int = 12) -> np.ndarray:
    """Eccentric anomaly from mean anomaly (Newton-Raphson, vectorised)."""
    m = np.mod(m, 2.0 * np.pi)
    ecc = m if e < 0.8 else np.full_like(m, np.pi)
    ecc = np.array(ecc, dtype=float)
    for _ in range(iterations):
        f = ecc - e * np.sin(ecc) - m
        ecc = ecc - f / (1.0 - e * np.cos(ecc))
    return ecc


def propagate_kepler(el: KeplerElements, t_s: np.ndarray, use_j2: bool = True) -> tuple[np.ndarray, np.ndarray]:
    """Return (r_eci [N,3] km, v_eci [N,3] km/s) at seconds since element epoch."""
    t = np.asarray(t_s, dtype=float)
    if use_j2:
        raan_dot, argp_dot, m_dot = j2_rates(el.a_km, el.e, el.i_rad)
    else:
        raan_dot, argp_dot, m_dot = 0.0, 0.0, mean_motion(el.a_km)
    raan = el.raan_rad + raan_dot * t
    argp = el.argp_rad + argp_dot * t
    m = el.m0_rad + m_dot * t

    e = el.e
    ecc = solve_kepler(m, e)
    cos_e, sin_e = np.cos(ecc), np.sin(ecc)
    a = el.a_km
    b = a * np.sqrt(1.0 - e**2)
    # Perifocal position / velocity.
    xp = a * (cos_e - e)
    yp = b * sin_e
    n = mean_motion(a)
    edot = n / (1.0 - e * cos_e)
    vxp = -a * sin_e * edot
    vyp = b * cos_e * edot

    ci, si = np.cos(el.i_rad), np.sin(el.i_rad)
    co, so = np.cos(raan), np.sin(raan)
    cw, sw = np.cos(argp), np.sin(argp)
    # Rotation perifocal -> ECI: R3(-raan) R1(-i) R3(-argp)
    r11 = co * cw - so * sw * ci
    r12 = -co * sw - so * cw * ci
    r21 = so * cw + co * sw * ci
    r22 = -so * sw + co * cw * ci
    r31 = sw * si
    r32 = cw * si
    r = np.stack([r11 * xp + r12 * yp, r21 * xp + r22 * yp, r31 * xp + r32 * yp], axis=-1)
    v = np.stack([r11 * vxp + r12 * vyp, r21 * vxp + r22 * vyp, r31 * vxp + r32 * vyp], axis=-1)
    return r, v


def tle_satrec(line1: str, line2: str) -> Satrec:
    return Satrec.twoline2rv(line1.strip(), line2.strip())


def tle_epoch_jd(line1: str, line2: str) -> float:
    sat = tle_satrec(line1, line2)
    return float(sat.jdsatepoch + sat.jdsatepochF)


def propagate_tle(line1: str, line2: str, jd_day: np.ndarray, jd_frac: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """SGP4 propagation; returns TEME (ECI) position km and velocity km/s."""
    sat = tle_satrec(line1, line2)
    err, r, v = sat.sgp4_array(np.asarray(jd_day, dtype=float), np.asarray(jd_frac, dtype=float))
    if np.any(err != 0):
        bad = int(np.flatnonzero(err)[0])
        raise ValueError(f"SGP4 propagation error code {int(err[bad])} at sample {bad}")
    return np.asarray(r), np.asarray(v)


def tle_mean_elements(line1: str, line2: str) -> dict:
    """Mean elements from a TLE for display (provenance REAL)."""
    sat = tle_satrec(line1, line2)
    n_rad_s = sat.no_kozai / 60.0
    a = (MU_EARTH / n_rad_s**2) ** (1.0 / 3.0)
    return {
        "a_km": a,
        "altitude_km": a - R_EARTH,
        "eccentricity": sat.ecco,
        "inclination_deg": np.degrees(sat.inclo),
        "raan_deg": np.degrees(sat.nodeo),
        "arg_perigee_deg": np.degrees(sat.argpo),
        "mean_anomaly_deg": np.degrees(sat.mo),
        "period_s": 2 * np.pi / n_rad_s,
    }
