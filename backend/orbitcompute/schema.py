"""Typed scenario schema (pydantic). Units are encoded in field names.

Provenance of inputs: every scenario carries `provenance` (PRESET when created from a preset,
USER once edited); orbit TLE input is REAL. Engine outputs are MODEL/PHYSICS.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

Provenance = Literal["REAL", "PHYSICS", "MODEL", "USER", "PRESET"]
JobType = Literal["inference", "training", "batch", "background"]
NetDep = Literal["none", "input", "output", "both", "realtime"]
SchedulerKey = Literal["fifo", "priority", "energy", "thermal", "deadline", "network"]

MAX_NODES = 12
MAX_SAMPLES = 6000
MAX_JOBS = 4000


class OrbitConfig(BaseModel):
    mode: Literal["kepler", "tle"] = "kepler"
    preset: Optional[str] = None
    altitude_km: float = Field(550.0, ge=160.0, le=36000.0, description="above WGS84 equatorial radius")
    inclination_deg: float = Field(53.0, ge=0.0, le=180.0)
    raan_deg: float = Field(0.0, ge=-360.0, le=720.0)
    eccentricity: float = Field(0.0, ge=0.0, lt=0.9)
    arg_perigee_deg: float = 0.0
    mean_anomaly_deg: float = 0.0
    sun_synchronous: bool = Field(False, description="derive inclination from J2 SSO condition")
    ltan_h: Optional[float] = Field(None, ge=0.0, lt=24.0, description="SSO local time of ascending node; sets RAAN")
    tle_name: Optional[str] = None
    tle_line1: Optional[str] = None
    tle_line2: Optional[str] = None

    @model_validator(mode="after")
    def _check(self):
        if self.mode == "tle" and not (self.tle_line1 and self.tle_line2):
            raise ValueError("TLE mode requires tle_line1 and tle_line2")
        return self


class ComputeConfig(BaseModel):
    accelerator_class: str = "dc-700"
    accelerator_count: int = Field(64, ge=0, le=4096)
    idle_w: float = Field(100.0, ge=0)
    max_w: float = Field(700.0, gt=0)
    relative_throughput: float = Field(1.0, gt=0, description="1.0 = reference accelerator class")
    memory_gb: float = Field(80.0, ge=0)
    host_overhead: float = Field(1.25, ge=1.0, le=3.0, description="multiplier for CPU/memory/network power")


class SolarConfig(BaseModel):
    area_m2: float = Field(300.0, ge=0)
    efficiency: float = Field(0.30, gt=0, le=0.5)
    derate: float = Field(0.85, gt=0, le=1.0, description="wiring, mismatch, ageing, temperature")
    pointing_factor: float = Field(1.0, ge=0, le=1.0, description="1.0 = ideal sun tracking")


class BatteryConfig(BaseModel):
    capacity_kwh: float = Field(60.0, ge=0)
    max_charge_kw: float = Field(40.0, ge=0)
    max_discharge_kw: float = Field(80.0, ge=0)
    charge_efficiency: float = Field(0.95, gt=0, le=1.0)
    discharge_efficiency: float = Field(0.95, gt=0, le=1.0)
    min_soc: float = Field(0.20, ge=0, lt=1, description="reserve: compute is shed at this SOC")
    emergency_soc: float = Field(0.05, ge=0, lt=1, description="hard floor; only essential loads below reserve")
    max_soc: float = Field(1.0, gt=0, le=1)
    initial_soc: float = Field(0.80, ge=0, le=1)


class ThermalConfig(BaseModel):
    radiator_area_m2: float = Field(150.0, ge=0, description="radiating area, both faces counted")
    emissivity: float = Field(0.90, gt=0, le=1)
    solar_absorptivity: float = Field(0.20, ge=0, le=1)
    sun_exposure_fraction: float = Field(0.0, ge=0, le=1, description="fraction of area facing the Sun")
    earth_view_factor: Optional[float] = Field(None, ge=0, le=1, description="None = edge-on plate formula")
    equipment_heat_capacity_kj_per_k: float = Field(3000.0, gt=0)
    radiator_areal_heat_capacity_kj_per_k_m2: float = Field(4.0, gt=0)
    conductance_kw_per_k: float = Field(4.0, gt=0, description="equipment->radiator transport")
    initial_temp_c: Optional[float] = Field(None, description="None = steady state at nominal half load")
    warm_c: float = 60.0
    throttle_c: float = 75.0
    limit_c: float = 90.0
    min_operating_c: float = 0.0
    heater_max_kw: float = Field(5.0, ge=0)
    min_throttle: float = Field(0.25, ge=0, le=1)


class PlatformConfig(BaseModel):
    avionics_kw: float = Field(4.0, ge=0, description="avionics, ADCS, housekeeping")
    thermal_base_kw: float = Field(1.0, ge=0)
    pump_fraction: float = Field(0.03, ge=0, le=0.5, description="thermal-control power per kW compute")


class CommsConfig(BaseModel):
    terminal_rate_gbps: float = Field(10.0, gt=0)
    idle_kw: float = Field(0.3, ge=0)
    active_kw: float = Field(1.5, ge=0)
    isl_enabled: bool = False
    isl_rate_gbps: float = Field(5.0, gt=0)
    relay_enabled: bool = Field(False, description="use illustrative GEO data-relay satellites")
    relay_rate_gbps: float = Field(1.0, gt=0, description="node relay-terminal rate")


class NodeConfig(BaseModel):
    id: str
    name: str
    orbit: OrbitConfig = OrbitConfig()
    compute: ComputeConfig = ComputeConfig()
    solar: SolarConfig = SolarConfig()
    battery: BatteryConfig = BatteryConfig()
    thermal: ThermalConfig = ThermalConfig()
    platform: PlatformConfig = PlatformConfig()
    comms: CommsConfig = CommsConfig()


class GroundStationConfig(BaseModel):
    id: str
    name: str
    lat_deg: float = Field(ge=-90, le=90)
    lon_deg: float = Field(ge=-180, le=180)
    alt_m: float = 0.0
    min_elevation_deg: float = Field(10.0, ge=0, le=60)
    downlink_gbps: float = Field(2.0, gt=0)
    uplink_gbps: float = Field(0.5, gt=0)
    provenance: str = "Coordinates REAL (approximate public site location); link parameters PRESET"


class RelayConfig(BaseModel):
    """Illustrative geostationary data-relay satellite (PRESET). Fixed longitude, equatorial."""

    id: str
    name: str
    lon_deg: float = Field(ge=-180, le=180)
    rate_gbps: float = Field(1.2, gt=0)


class JobSpec(BaseModel):
    job_id: str
    name: Optional[str] = None
    type: JobType
    arrival_s: float = Field(ge=0)
    deadline_s: Optional[float] = None
    priority: int = Field(5, ge=0, le=10)
    accelerators: int = Field(1, ge=1)
    work_ref_acc_h: float = Field(gt=0, description="reference accelerator-hours")
    input_gbit: float = Field(0.0, ge=0)
    output_gbit: float = Field(0.0, ge=0)
    network_dependency: NetDep = "none"


class WorkloadMix(BaseModel):
    inference: float = 0.30
    training: float = 0.35
    batch: float = 0.25
    background: float = 0.10


class WorkloadConfig(BaseModel):
    mode: Literal["generated", "explicit"] = "generated"
    seed: int = 42
    intensity: float = Field(0.8, ge=0.0, le=3.0, description="offered load / total nominal capacity")
    mix: WorkloadMix = WorkloadMix()
    jobs: list[JobSpec] = Field(default_factory=list)


class SimConfig(BaseModel):
    epoch_utc: str = "2026-10-04T00:00:00Z"
    duration_s: float = Field(12 * 3600, gt=0, le=7 * 86400)
    step_s: float = Field(30.0, ge=5.0, le=300.0)
    scheduler: SchedulerKey = "priority"


class Scenario(BaseModel):
    name: str = "Untitled scenario"
    description: str = ""
    preset_id: Optional[str] = None
    provenance: Provenance = "USER"
    sim: SimConfig = SimConfig()
    nodes: list[NodeConfig]
    ground_stations: list[GroundStationConfig] = Field(default_factory=list)
    relays: list[RelayConfig] = Field(default_factory=list)
    workload: WorkloadConfig = WorkloadConfig()

    @model_validator(mode="after")
    def _bounds(self):
        if not 1 <= len(self.nodes) <= MAX_NODES:
            raise ValueError(f"scenario must have 1..{MAX_NODES} nodes")
        if self.sim.duration_s / self.sim.step_s > MAX_SAMPLES:
            raise ValueError(f"duration/step exceeds {MAX_SAMPLES} samples; increase step_s")
        ids = [n.id for n in self.nodes]
        if len(set(ids)) != len(ids):
            raise ValueError("node ids must be unique")
        return self
