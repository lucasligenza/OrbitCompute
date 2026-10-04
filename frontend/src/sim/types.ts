// Mirrors backend/orbitcompute/schema.py and the result produced by simulate.py.

export type Provenance = "REAL" | "PHYSICS" | "MODEL" | "USER" | "PRESET" | "PREVIEW";
export type SchedulerKey = "fifo" | "priority" | "energy" | "thermal" | "deadline" | "network";
export type JobType = "inference" | "training" | "batch" | "background";
export type NetDep = "none" | "input" | "output" | "both" | "realtime";

export interface OrbitConfig {
  mode: "kepler" | "tle";
  preset?: string | null;
  altitude_km: number;
  inclination_deg: number;
  raan_deg: number;
  eccentricity: number;
  arg_perigee_deg: number;
  mean_anomaly_deg: number;
  sun_synchronous: boolean;
  ltan_h?: number | null;
  tle_name?: string | null;
  tle_line1?: string | null;
  tle_line2?: string | null;
}

export interface ComputeConfig {
  accelerator_class: string;
  accelerator_count: number;
  idle_w: number;
  max_w: number;
  relative_throughput: number;
  memory_gb: number;
  host_overhead: number;
}
export interface SolarConfig { area_m2: number; efficiency: number; derate: number; pointing_factor: number }
export interface BatteryConfig {
  capacity_kwh: number; max_charge_kw: number; max_discharge_kw: number;
  charge_efficiency: number; discharge_efficiency: number;
  min_soc: number; emergency_soc: number; max_soc: number; initial_soc: number;
}
export interface ThermalConfig {
  radiator_area_m2: number; emissivity: number; solar_absorptivity: number; sun_exposure_fraction: number;
  earth_view_factor?: number | null; equipment_heat_capacity_kj_per_k: number;
  radiator_areal_heat_capacity_kj_per_k_m2: number; conductance_kw_per_k: number;
  initial_temp_c?: number | null; warm_c: number; throttle_c: number; limit_c: number;
  min_operating_c: number; heater_max_kw: number; min_throttle: number;
}
export interface PlatformConfig { avionics_kw: number; thermal_base_kw: number; pump_fraction: number }
export interface CommsConfig {
  terminal_rate_gbps: number; idle_kw: number; active_kw: number;
  isl_enabled: boolean; isl_rate_gbps: number; relay_enabled: boolean; relay_rate_gbps: number;
}
export interface NodeConfig {
  id: string; name: string;
  orbit: OrbitConfig; compute: ComputeConfig; solar: SolarConfig; battery: BatteryConfig;
  thermal: ThermalConfig; platform: PlatformConfig; comms: CommsConfig;
}
export interface GroundStationConfig {
  id: string; name: string; lat_deg: number; lon_deg: number; alt_m: number;
  min_elevation_deg: number; downlink_gbps: number; uplink_gbps: number; provenance: string;
}
export interface RelayConfig { id: string; name: string; lon_deg: number; rate_gbps: number }
export interface JobSpec {
  job_id: string; name?: string | null; type: JobType; arrival_s: number; deadline_s?: number | null;
  priority: number; accelerators: number; work_ref_acc_h: number; input_gbit: number; output_gbit: number;
  network_dependency: NetDep;
}
export interface WorkloadConfig {
  mode: "generated" | "explicit"; seed: number; intensity: number;
  mix: { inference: number; training: number; batch: number; background: number };
  jobs: JobSpec[];
}
export interface SimConfig { epoch_utc: string; duration_s: number; step_s: number; scheduler: SchedulerKey }
export interface Scenario {
  name: string; description: string; preset_id?: string | null; provenance: Provenance;
  sim: SimConfig; nodes: NodeConfig[]; ground_stations: GroundStationConfig[]; relays: RelayConfig[];
  workload: WorkloadConfig;
}

export interface Catalog {
  scenarios: { id: string; name: string; description: string; node_count: number }[];
  orbits: Record<string, Partial<OrbitConfig> & { label: string }>;
  accelerators: Record<string, { label: string; idle_w: number; max_w: number; relative_throughput: number; memory_gb: number }>;
  ground_stations: GroundStationConfig[];
  relays: RelayConfig[];
  reference_tle: { name: string; line1: string; line2: string; epoch_utc: string; source: string; retrieved_utc: string };
}

export interface SimEvent {
  t: number; node: number; type: string; category: "orbit" | "power" | "thermal" | "network" | "compute";
  severity: "info" | "nominal" | "warning" | "critical"; label: string; detail: string;
  job?: number; station?: number;
}

export interface JobRecord {
  idx: number; job_id: string; name: string | null; type: JobType; priority: number; node: number;
  accelerators: number; work_ref_acc_h: number; input_gbit: number; output_gbit: number;
  network_dependency: NetDep; arrival_s: number; deadline_s: number | null; ready_s: number | null;
  first_start_s: number | null; compute_done_s: number | null; completion_s: number | null;
  status: string; missed: boolean; progress: number; est_runtime_s: number; est_energy_kwh: number;
  segments: [number, number, number, number, number, number][]; // t0, t1, k, p0, p1, stalled
}

export type Metrics = Record<string, number>;

export interface NodeResultRaw {
  id: string; name: string; index: number;
  orbit: Record<string, number | string>;
  derived: Record<string, number | string>;
  series: Record<string, number[]>;
  alloc: [number, number, number][][];
  eclipse_windows: [number, number][];
  contact_windows: [number, number, number, number][]; // station, t0, t1, max_el
  metrics: Metrics;
}

export interface SimResultRaw {
  engine_version: string; hash: string; created_utc: string; scenario: Scenario; scheduler_label: string;
  time: { epoch_utc: string; step_s: number; n: number; duration_s: number };
  sun: { x: number[]; y: number[]; z: number[]; dist_km: number[] };
  gmst_rad: number[];
  stations: (GroundStationConfig & { ecef_km: [number, number, number] })[];
  relays: (RelayConfig & { radius_km: number })[];
  nodes: NodeResultRaw[];
  jobs: JobRecord[];
  events: SimEvent[];
  metrics: Metrics;
  checks: Record<string, number | boolean>;
  provenance: Record<string, string>;
}

export interface OrbitPreview {
  provenance: string; elements: Record<string, number>; period_s: number; beta_deg: number;
  eclipse_fraction: number; eclipse_minutes: number; footprint_half_angle_deg: number;
  r_eci: [number, number, number][]; ground_track: { lat_deg: number[]; lon_deg: number[] };
}
