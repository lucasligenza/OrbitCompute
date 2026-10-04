"""Power system (MODEL): solar array output, power bus with load shedding, battery dispatch.

Units: kW, kWh, hours for energy bookkeeping. See docs/SCIENCE.md §4.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .constants import AU, SOLAR_CONSTANT
from .schema import BatteryConfig, SolarConfig


def solar_flux_w_m2(sun_dist_km: np.ndarray) -> np.ndarray:
    return SOLAR_CONSTANT * (AU / np.asarray(sun_dist_km)) ** 2


def rated_array_kw(cfg: SolarConfig) -> float:
    """Electrical output in full sun at 1 AU with configured pointing (the 'rated' figure shown in UI)."""
    return cfg.area_m2 * cfg.efficiency * SOLAR_CONSTANT * cfg.derate * cfg.pointing_factor / 1000.0


def array_power_kw(cfg: SolarConfig, illum: np.ndarray, sun_dist_km: np.ndarray) -> np.ndarray:
    """P = A * eta * S(r) * derate * pointing * f_illum   [kW]."""
    return cfg.area_m2 * cfg.efficiency * solar_flux_w_m2(sun_dist_km) * cfg.derate * cfg.pointing_factor * illum / 1000.0


@dataclass
class Battery:
    cfg: BatteryConfig
    energy_kwh: float

    @classmethod
    def from_config(cls, cfg: BatteryConfig) -> "Battery":
        return cls(cfg, cfg.capacity_kwh * min(max(cfg.initial_soc, cfg.min_soc), cfg.max_soc))

    @property
    def e_min(self) -> float:
        return self.cfg.capacity_kwh * self.cfg.min_soc

    @property
    def e_floor(self) -> float:
        """Emergency floor: essential (non-compute) loads may discharge down to here."""
        return self.cfg.capacity_kwh * min(self.cfg.emergency_soc, self.cfg.min_soc)

    @property
    def e_max(self) -> float:
        return self.cfg.capacity_kwh * self.cfg.max_soc

    @property
    def soc(self) -> float:
        return self.energy_kwh / self.cfg.capacity_kwh if self.cfg.capacity_kwh > 0 else 0.0

    def discharge_available_kw(self, dt_h: float, essential: bool = False) -> float:
        """Bus-side power deliverable for a full step without crossing the reserve (compute) or the
        emergency floor (essential loads)."""
        floor = self.e_floor if essential else self.e_min
        room = max(0.0, self.energy_kwh - floor) * self.cfg.discharge_efficiency / dt_h
        return min(self.cfg.max_discharge_kw, room)

    def charge_acceptance_kw(self, dt_h: float) -> float:
        room = max(0.0, self.e_max - self.energy_kwh) / (self.cfg.charge_efficiency * dt_h)
        return min(self.cfg.max_charge_kw, room)


@dataclass(frozen=True)
class BusResult:
    charge_kw: float  # bus-side power into battery
    discharge_kw: float  # bus-side power out of battery
    curtailed_kw: float
    unmet_kw: float
    loss_kwh: float


def settle_bus(bat: Battery, p_gen_kw: float, p_load_kw: float, dt_h: float) -> BusResult:
    """Balance generation against load for one step, updating battery energy in place.

    The caller has already limited compute to the reserve-floor budget, so discharge here may go
    down to the emergency floor (only essential loads can need it).
    Identity: p_gen + discharge + unmet == p_load + charge + curtailed.
    """
    net = p_gen_kw - p_load_kw
    if net >= 0.0:
        charge = min(net, bat.charge_acceptance_kw(dt_h))
        bat.energy_kwh += charge * bat.cfg.charge_efficiency * dt_h
        bat.energy_kwh = min(bat.energy_kwh, bat.e_max)  # guards float round-off only
        return BusResult(charge, 0.0, net - charge, 0.0, charge * (1.0 - bat.cfg.charge_efficiency) * dt_h)
    need = -net
    d = min(need, bat.discharge_available_kw(dt_h, essential=True))
    bat.energy_kwh -= d / bat.cfg.discharge_efficiency * dt_h
    bat.energy_kwh = max(bat.energy_kwh, bat.e_floor if d > 0 else bat.energy_kwh)
    loss = d * (1.0 / bat.cfg.discharge_efficiency - 1.0) * dt_h
    return BusResult(0.0, d, 0.0, need - d, loss)
