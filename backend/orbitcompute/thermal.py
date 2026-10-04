"""Two-node lumped thermal model (MODEL — not a spacecraft thermal analysis).

    C_e dT_e/dt = Q_diss - G (T_e - T_r)
    C_r dT_r/dt = G (T_e - T_r) + Q_env - eps*sigma*A*T_r^4

Q_env = eps*A*F_E*q_OLR (Earth IR) + alpha*A*k_sun*S*f_illum (direct solar on radiator).
Albedo is NOT modelled. See docs/SCIENCE.md §5.
"""

from __future__ import annotations

import math

import numpy as np

from .constants import EARTH_OLR, R_EARTH, SIGMA_SB, ZERO_C_K
from .schema import ThermalConfig

NORMAL, WARM, THROTTLED, LIMIT = 0, 1, 2, 3
STATE_NAMES = {NORMAL: "NORMAL", WARM: "WARM", THROTTLED: "THROTTLED", LIMIT: "THERMAL LIMIT"}


def earth_view_factor_edge_on(r_km: np.ndarray) -> np.ndarray:
    """View factor from a flat plate whose normal is perpendicular to nadir, to a spherical Earth.

    F = (1/pi) [ atan(1/sqrt(H^2-1)) - sqrt(H^2-1)/H^2 ],  H = r / R_E.
    Limits: F -> 1/2 at H -> 1 (vertical plate on a plane), F ~ 2/(3 pi H^3) for H >> 1.
    """
    h = np.asarray(r_km, dtype=float) / R_EARTH
    x = np.sqrt(np.clip(h**2 - 1.0, 1e-12, None))
    return (np.arctan(1.0 / x) - x / h**2) / np.pi


class ThermalModel:
    def __init__(self, cfg: ThermalConfig):
        self.cfg = cfg
        self.area = cfg.radiator_area_m2
        self.eps_sigma_a = cfg.emissivity * SIGMA_SB * self.area  # W/K^4
        self.c_e = cfg.equipment_heat_capacity_kj_per_k * 1000.0  # J/K
        self.c_r = max(cfg.radiator_areal_heat_capacity_kj_per_k_m2 * 1000.0 * self.area, 1000.0)  # J/K
        self.g = cfg.conductance_kw_per_k * 1000.0  # W/K
        self.t_warm = cfg.warm_c + ZERO_C_K
        self.t_throttle = cfg.throttle_c + ZERO_C_K
        self.t_limit = cfg.limit_c + ZERO_C_K
        self.t_min = cfg.min_operating_c + ZERO_C_K
        # Stability: explicit sub-step below half the smallest time constant (linearised at 450 K).
        k_rad = 4.0 * self.eps_sigma_a * 450.0**3
        self.tau_min = min(self.c_e / self.g, self.c_r / (self.g + k_rad))

    def substeps(self, dt: float) -> int:
        return max(1, math.ceil(dt / (0.4 * self.tau_min)))

    def q_env_w(self, r_km: np.ndarray, illum: np.ndarray, solar_flux: np.ndarray) -> np.ndarray:
        f_e = (
            earth_view_factor_edge_on(r_km)
            if self.cfg.earth_view_factor is None
            else np.full(np.shape(r_km), self.cfg.earth_view_factor)
        )
        q_ir = self.cfg.emissivity * self.area * f_e * EARTH_OLR
        q_sun = self.cfg.solar_absorptivity * self.area * self.cfg.sun_exposure_fraction * solar_flux * illum
        return q_ir + q_sun

    def throttle(self, t_e: float) -> float:
        if t_e < self.t_throttle:
            return 1.0
        if t_e >= self.t_limit:
            return 0.0
        frac = (t_e - self.t_throttle) / (self.t_limit - self.t_throttle)
        return 1.0 - frac * (1.0 - self.cfg.min_throttle)

    def state(self, t_e: float) -> int:
        if t_e >= self.t_limit:
            return LIMIT
        if t_e >= self.t_throttle:
            return THROTTLED
        if t_e >= self.t_warm:
            return WARM
        return NORMAL

    def heater_kw(self, t_e: float) -> float:
        """Proportional survival heater: full power 2 K below the minimum, off 2 K above."""
        if self.cfg.heater_max_kw <= 0:
            return 0.0
        frac = (self.t_min + 2.0 - t_e) / 4.0
        return float(min(max(frac, 0.0), 1.0) * self.cfg.heater_max_kw)

    def rejection_w(self, t_r: float) -> float:
        return self.eps_sigma_a * t_r**4

    def step(self, t_e: float, t_r: float, q_diss_w: float, q_env_w: float, dt: float) -> tuple[float, float, float]:
        """Advance dt seconds. Returns (T_e, T_r, mean radiated power W)."""
        n = self.substeps(dt)
        h = dt / n
        q_rad_sum = 0.0
        for _ in range(n):
            q_rad = self.eps_sigma_a * t_r**4
            q_link = self.g * (t_e - t_r)
            t_e += h * (q_diss_w - q_link) / self.c_e
            t_r += h * (q_link + q_env_w - q_rad) / self.c_r
            q_rad_sum += q_rad
        return t_e, t_r, q_rad_sum / n

    def steady_state(self, q_diss_w: float, q_env_w: float) -> tuple[float, float]:
        t_r = ((q_diss_w + q_env_w) / self.eps_sigma_a) ** 0.25
        return t_r + q_diss_w / self.g, t_r
