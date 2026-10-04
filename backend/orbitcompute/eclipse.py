"""Earth shadow geometry (PHYSICS).

Conical shadow model with a spherical Earth and finite solar disc. The illuminated fraction is
1 - (area of the solar disc occulted by Earth's disc) / (solar disc area), evaluated with the
apparent angular radii seen from the spacecraft (cf. Montenbruck & Gill, Satellite Orbits, §3.4).
No atmospheric refraction or oblateness.
"""

from __future__ import annotations

import numpy as np

from .constants import R_EARTH, R_SUN

SUNLIGHT, PENUMBRA, UMBRA = 0, 1, 2
STATE_NAMES = {SUNLIGHT: "SUNLIGHT", PENUMBRA: "PENUMBRA", UMBRA: "UMBRA"}


def _circle_overlap(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> np.ndarray:
    """Overlap area of circles with radii a, b whose centres are separated by c (partial case)."""
    x = (c**2 + a**2 - b**2) / (2.0 * c)
    y = np.sqrt(np.clip(a**2 - x**2, 0.0, None))
    return a**2 * np.arccos(np.clip(x / a, -1.0, 1.0)) + b**2 * np.arccos(np.clip((c - x) / b, -1.0, 1.0)) - c * y


def illumination_fraction(r_sat: np.ndarray, r_sun: np.ndarray) -> np.ndarray:
    """Fraction of the solar disc visible from the spacecraft, in [0, 1]. Inputs (N, 3) km ECI."""
    r_sat = np.asarray(r_sat, dtype=float)
    d_sun = r_sun - r_sat
    dist_sun = np.linalg.norm(d_sun, axis=-1)
    dist_earth = np.linalg.norm(r_sat, axis=-1)
    a = np.arcsin(np.clip(R_SUN / dist_sun, 0.0, 1.0))  # apparent solar radius
    b = np.arcsin(np.clip(R_EARTH / dist_earth, 0.0, 1.0))  # apparent Earth radius
    cos_c = np.sum(-r_sat * d_sun, axis=-1) / (dist_earth * dist_sun)
    c = np.arccos(np.clip(cos_c, -1.0, 1.0))  # separation of the two disc centres

    f = np.ones_like(c)
    full = c <= (b - a)  # solar disc entirely behind Earth (umbra)
    f[full] = 0.0
    annular = (c <= (a - b)) & ~full  # Earth disc inside solar disc (not reachable in LEO)
    f[annular] = 1.0 - (b[annular] ** 2) / (a[annular] ** 2)
    partial = (c < a + b) & ~full & ~annular
    if np.any(partial):
        ov = _circle_overlap(a[partial], b[partial], c[partial])
        f[partial] = 1.0 - ov / (np.pi * a[partial] ** 2)
    return np.clip(f, 0.0, 1.0)


def shadow_state(f: np.ndarray) -> np.ndarray:
    s = np.full(f.shape, PENUMBRA, dtype=np.int8)
    s[f >= 0.999] = SUNLIGHT
    s[f <= 0.001] = UMBRA
    return s


def beta_angle_rad(r_sun: np.ndarray, h_vec: np.ndarray) -> np.ndarray:
    """Solar beta angle: angle between Sun vector and the orbit plane."""
    hn = h_vec / np.linalg.norm(h_vec, axis=-1, keepdims=True)
    sn = r_sun / np.linalg.norm(r_sun, axis=-1, keepdims=True)
    return np.arcsin(np.clip(np.sum(hn * sn, axis=-1), -1.0, 1.0))


def eclipse_fraction_estimate(beta_rad: float, altitude_km: float) -> float:
    """Cylindrical-shadow eclipse fraction of a circular orbit (preview estimate)."""
    r = R_EARTH + altitude_km
    beta_star = np.arcsin(R_EARTH / r)
    if abs(beta_rad) >= beta_star:
        return 0.0
    arg = np.sqrt(altitude_km**2 + 2.0 * R_EARTH * altitude_km) / (r * np.cos(beta_rad))
    return float(np.arccos(np.clip(arg, -1.0, 1.0)) / np.pi)
