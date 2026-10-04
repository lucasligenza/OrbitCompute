"""Coordinate frame conversions.

ECI      : TEME-like inertial frame of date (SGP4 output frame). Keplerian elements live here.
ECEF     : r_ecef = R3(GMST) @ r_eci  (no polar motion, UT1 ~ UTC).
GEODETIC : WGS84 latitude / longitude [rad internally] / height [km].

All functions are vectorised over a leading sample axis: positions are (N, 3) arrays in km.
"""

from __future__ import annotations

import numpy as np

from .constants import E2_EARTH, R_EARTH


def eci_to_ecef(r_eci: np.ndarray, gmst: np.ndarray) -> np.ndarray:
    """Rotate ECI -> ECEF by +GMST about z (R3(theta))."""
    c, s = np.cos(gmst), np.sin(gmst)
    x, y, z = r_eci[..., 0], r_eci[..., 1], r_eci[..., 2]
    return np.stack([c * x + s * y, -s * x + c * y, z], axis=-1)


def ecef_to_eci(r_ecef: np.ndarray, gmst: np.ndarray) -> np.ndarray:
    """Inverse of eci_to_ecef (R3(-theta))."""
    c, s = np.cos(gmst), np.sin(gmst)
    x, y, z = r_ecef[..., 0], r_ecef[..., 1], r_ecef[..., 2]
    return np.stack([c * x - s * y, s * x + c * y, z], axis=-1)


def geodetic_to_ecef(lat: np.ndarray, lon: np.ndarray, h_km: np.ndarray) -> np.ndarray:
    """WGS84 geodetic (rad, rad, km) -> ECEF km."""
    lat = np.asarray(lat, dtype=float)
    lon = np.asarray(lon, dtype=float)
    h_km = np.asarray(h_km, dtype=float)
    sl = np.sin(lat)
    n = R_EARTH / np.sqrt(1.0 - E2_EARTH * sl**2)
    x = (n + h_km) * np.cos(lat) * np.cos(lon)
    y = (n + h_km) * np.cos(lat) * np.sin(lon)
    z = (n * (1.0 - E2_EARTH) + h_km) * sl
    return np.stack([x, y, z], axis=-1)


def ecef_to_geodetic(r_ecef: np.ndarray, iterations: int = 6) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """ECEF km -> WGS84 (lat rad, lon rad, h km). Fixed-point iteration (Vallado Alg. 12)."""
    x, y, z = r_ecef[..., 0], r_ecef[..., 1], r_ecef[..., 2]
    lon = np.arctan2(y, x)
    p = np.hypot(x, y)
    lat = np.arctan2(z, p * (1.0 - E2_EARTH))
    n = R_EARTH
    for _ in range(iterations):
        sl = np.sin(lat)
        n = R_EARTH / np.sqrt(1.0 - E2_EARTH * sl**2)
        lat = np.arctan2(z + n * E2_EARTH * sl, p)
    sl = np.sin(lat)
    cl = np.cos(lat)
    n = R_EARTH / np.sqrt(1.0 - E2_EARTH * sl**2)
    # Height: robust form valid at all latitudes.
    h = np.where(np.abs(cl) > 1e-8, p / np.where(np.abs(cl) > 1e-8, cl, 1.0) - n, np.abs(z) - n * (1 - E2_EARTH))
    return lat, lon, h


def up_vector_ecef(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """Geodetic local vertical unit vector in ECEF."""
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], axis=-1)
