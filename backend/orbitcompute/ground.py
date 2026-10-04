"""Ground station geometry (PHYSICS): ECEF location, elevation, slant range, footprints."""

from __future__ import annotations

import numpy as np

from .constants import R_EARTH
from .frames import geodetic_to_ecef, up_vector_ecef


def station_ecef(lat_deg: float, lon_deg: float, alt_m: float) -> np.ndarray:
    return geodetic_to_ecef(np.radians(lat_deg), np.radians(lon_deg), alt_m / 1000.0)


def look_angles(r_sat_ecef: np.ndarray, lat_deg: float, lon_deg: float, alt_m: float) -> tuple[np.ndarray, np.ndarray]:
    """Elevation (rad) and slant range (km) of samples r_sat_ecef (N, 3) from a station."""
    rs = station_ecef(lat_deg, lon_deg, alt_m)
    up = up_vector_ecef(np.radians(lat_deg), np.radians(lon_deg))
    rho = r_sat_ecef - rs
    rng = np.linalg.norm(rho, axis=-1)
    el = np.arcsin(np.clip(rho @ up / rng, -1.0, 1.0))
    return el, rng


def footprint_half_angle_rad(altitude_km: float, min_el_rad: float) -> float:
    """Earth central angle of the visibility circle for a spacecraft at given altitude."""
    r = R_EARTH + altitude_km
    return float(np.arccos(R_EARTH * np.cos(min_el_rad) / r) - min_el_rad)


def line_of_sight(r1: np.ndarray, r2: np.ndarray, min_alt_km: float = 100.0) -> np.ndarray:
    """True where the segment r1-r2 stays above R_EARTH + min_alt_km (vectorised over samples)."""
    d = r2 - r1
    dd = np.sum(d * d, axis=-1)
    tau = np.clip(-np.sum(r1 * d, axis=-1) / np.where(dd > 0, dd, 1.0), 0.0, 1.0)
    closest = r1 + tau[..., None] * d
    return np.linalg.norm(closest, axis=-1) > (R_EARTH + min_alt_km)
