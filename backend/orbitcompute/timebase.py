"""Time handling. Scale: UTC; UT1-UTC (< 0.9 s) is ignored (documented in docs/SCIENCE.md)."""

from __future__ import annotations

from datetime import datetime, timezone

import numpy as np

JD_J2000 = 2451545.0


def parse_epoch(epoch: str) -> datetime:
    """Parse an ISO-8601 UTC timestamp ('Z' or offset) into an aware UTC datetime."""
    s = epoch.strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def jd_from_datetime(dt: datetime) -> tuple[float, float]:
    """Return (jd_day, jd_fraction) split for precision (Vallado Alg. 14 style)."""
    dt = dt.astimezone(timezone.utc)
    y, m = dt.year, dt.month
    d = dt.day
    jd_day = (
        367 * y
        - int(7 * (y + int((m + 9) / 12)) / 4)
        + int(275 * m / 9)
        + d
        + 1721013.5
    )
    frac = (dt.hour * 3600 + dt.minute * 60 + dt.second + dt.microsecond * 1e-6) / 86400.0
    return float(jd_day), float(frac)


def jd_array(epoch: datetime, t_s: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Julian date split arrays for seconds-since-epoch samples."""
    jd0, fr0 = jd_from_datetime(epoch)
    fr = fr0 + np.asarray(t_s, dtype=float) / 86400.0
    whole = np.floor(fr)
    return jd0 + whole, fr - whole


def gmst_rad(jd_day: np.ndarray, jd_frac: np.ndarray) -> np.ndarray:
    """Greenwich mean sidereal time, IAU-82 (Vallado eq. 3-47), radians in [0, 2pi)."""
    t = ((jd_day - JD_J2000) + jd_frac) / 36525.0
    gmst_s = (
        67310.54841
        + (876600.0 * 3600.0 + 8640184.812866) * t
        + 0.093104 * t**2
        - 6.2e-6 * t**3
    )
    return np.mod(np.mod(gmst_s, 86400.0) / 240.0 * np.pi / 180.0, 2.0 * np.pi)


def centuries_tt_approx(jd_day: np.ndarray, jd_frac: np.ndarray) -> np.ndarray:
    """Julian centuries from J2000 (UTC used for TT/UT1; error irrelevant at this fidelity)."""
    return ((jd_day - JD_J2000) + jd_frac) / 36525.0
