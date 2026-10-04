"""Sun position (PHYSICS, low precision ~0.01 deg).

Astronomical Almanac low-precision solar coordinates (also Vallado Alg. 29). Result is in the
mean-of-date equatorial frame; we use it as ECI (difference to TEME is nutation, << shadow
sensitivity).
"""

from __future__ import annotations

import numpy as np

from .constants import AU
from .timebase import centuries_tt_approx


def sun_position_eci(jd_day: np.ndarray, jd_frac: np.ndarray) -> np.ndarray:
    """Geocentric Sun vector (N, 3) in km."""
    t = centuries_tt_approx(np.asarray(jd_day), np.asarray(jd_frac))
    lam_m = np.radians(np.mod(280.460 + 36000.771 * t, 360.0))
    m = np.radians(np.mod(357.5291092 + 35999.05034 * t, 360.0))
    lam = lam_m + np.radians(1.914666471 * np.sin(m) + 0.019994643 * np.sin(2 * m))
    r_au = 1.000140612 - 0.016708617 * np.cos(m) - 0.000139589 * np.cos(2 * m)
    eps = np.radians(23.439291 - 0.0130042 * t)
    r = r_au * AU
    return np.stack([r * np.cos(lam), r * np.cos(eps) * np.sin(lam), r * np.sin(eps) * np.sin(lam)], axis=-1)


def sun_right_ascension(r_sun: np.ndarray) -> np.ndarray:
    return np.arctan2(r_sun[..., 1], r_sun[..., 0])
