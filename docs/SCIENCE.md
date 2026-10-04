# OrbitCompute — Scientific Model & Assumptions

OrbitCompute is a **systems-level teaching and exploration model**. It is *not* flight
software, mission design software, or a validated spacecraft thermal/power analysis.
Every modelled quantity below states its simplifications.

Provenance labels used everywhere:

| Label | Meaning |
|---|---|
| **REAL** | Sourced external data (e.g. CelesTrak TLE, physical constants, public site coordinates) |
| **PHYSICS** | Calculated from established physical relations |
| **MODEL** | Simplified engineering model (stated assumptions) |
| **USER** | User-configured assumption |
| **PRESET** | Illustrative default — not a real spacecraft or product spec |

## Constants (REAL)
μ⊕ = 398600.4418 km³/s², R⊕ = 6378.137 km (WGS84 a), f = 1/298.257223563, J2 = 1.08262668e−3,
R☉ = 696 000 km, AU = 149 597 870.7 km, solar constant S₀ = 1361 W/m² (TSI at 1 AU),
σ = 5.670374419e−8 W m⁻² K⁻⁴, c = 299 792.458 km/s, mean Earth OLR ≈ 237 W/m².

## 1. Orbit propagation
- **Keplerian nodes (USER/PRESET elements)**: two-body motion + **J2 secular** rates of Ω, ω, M
  (Vallado, *Fundamentals of Astrodynamics*, §9.6). No drag, no short-period J2, no third body.
  Error vs. reality grows to km-level within hours in LEO — acceptable for systems behaviour,
  not for conjunction or pass prediction to the second.
- **TLE nodes (REAL input)**: `sgp4` library (Vallado 2006 revision). Output is TEME. Accuracy
  degrades ~1–3 km/day away from TLE epoch; the reference preset runs near its epoch.
- Sun-synchronous inclination solved from J2 nodal rate = 360°/365.2422 d.

## 2. Frames & time
- Time scale: UTC; UT1−UTC (< 0.9 s) ignored. GMST from IAU-82 expression.
- ECI = TEME-like frame of date. ECEF = R3(GMST)·ECI. Nutation-in-longitude differences
  (equation of equinoxes ≤ ~1.2 s of time) and polar motion are ignored → ≲ 0.5 km ground error.
- Geodetic conversion: WGS84, iterative (converges < 1 mm in 5 iterations).

## 3. Sun & eclipse
- Sun position: Astronomical Almanac low-precision formulae (~0.01°), mean-of-date frame used
  as ECI (difference to TEME ≪ eclipse sensitivity).
- Shadow: **conical model** with spherical Earth (R = 6378.137 km) and finite solar disc.
  Illumination fraction `f` = 1 − (occulted area of solar disc / disc area) from the apparent
  angular radii of Sun and Earth seen by the spacecraft. States: SUNLIGHT (f ≥ 0.999),
  PENUMBRA, UMBRA (f ≤ 0.001). No atmospheric refraction/absorption, no oblateness.
- Beta angle & eclipse-fraction estimate (preview only):
  `f_ecl = (1/π)·acos( √(h² + 2Rh) / ((R+h)·cos β) )` for |β| < asin(R/(R+h)).

## 4. Power (MODEL)
- Array output: `P = A · η · S(r) · derate · f_illum · pointing`, with `S(r) = S₀·(AU/r)²`.
  Default orientation: sun-tracking (pointing = 1, USER can lower it). No temperature
  coefficient, no degradation over time beyond `derate`.
- Loads: compute (from compute model), platform/avionics (constant), comms (idle + active),
  thermal control (base + pump fraction of transported heat), survival heater.
- Bus: if available power (generation + allowed battery discharge) < demand, **compute is shed
  first** (power-limited state), then the remainder is unmet (platform outage).
- Battery: energy reservoir with charge/discharge power limits, efficiencies η_c, η_d,
  SOC floor/ceiling. No voltage, temperature, ageing or rate-capacity effects.
- Conservation identity checked every step:
  `E_gen_avail = E_load_served_from_gen + E_charge_in + E_curtailed` and
  `ΔE_batt = η_c·E_charge_in − E_discharge_out/η_d`.

## 5. Thermal (MODEL — two lumped nodes)
```
C_e dT_e/dt = Q_diss − G (T_e − T_r)
C_r dT_r/dt = G (T_e − T_r) + Q_env − ε σ A T_r⁴
Q_env = ε·A·F_E·q_OLR + α_s·A·k_sun·S·f_illum
```
- All electrical power dissipated aboard ends up in the equipment node (`Q_diss`).
- `G` lumps heat pipes / pumped loop conductance. `A` is **radiating** area (both faces).
- Earth IR uses the flat-plate view factor for a radiator edge-on to Earth
  (`F_E = (1/π)[atan(1/√(H²−1)) − √(H²−1)/H²]`, H = r/R⊕), user-overridable.
- Solar loading on the radiator defaults to zero (`k_sun = 0`, radiator assumed edge-on to Sun);
  user may set a fraction. **Albedo is not modelled.** No internal gradients, no MLI, no
  view-factor to the arrays, no two-phase loop dynamics.
- States from T_e: NORMAL < T_warm ≤ WARM < T_throttle ≤ THROTTLED < T_limit ≤ THERMAL LIMIT.
  Throttle factor s falls linearly from 1 at T_throttle to s_min at T_limit; at T_limit compute
  stops (s = 0). Integration: explicit sub-steps sized below half the smallest time constant.

## 6. Compute (MODEL)
- Node = N accelerators of one class. Per accelerator: idle W, max W, relative throughput
  (1.0 = reference class), memory. Host overhead factor multiplies accelerator power.
- `P_compute = overhead · [N·P_idle + Σ_alloc k·(P_max − P_idle)·s]` where s is the throttle
  factor (clock scale); **throughput and dynamic power both scale linearly with s** (a
  conservative simplification of DVFS).
- Hardware presets are **classes** (e.g. "~700 W datacenter accelerator class"), not product specs.

## 7. Workloads & scheduling (MODEL)
- Job work is in *reference accelerator-hours*. Progress rate = `k · throughput · s` per hour.
- Jobs are preemptible at step granularity (checkpoint abstraction, no overhead modelled).
- `network_dependency`: `none` | `input` (must uplink input first) | `output` (must downlink
  result before completion) | `both` | `realtime` (makes progress only while a link exists).
- Schedulers: FIFO (head-of-line), Priority (backfill), Energy-aware, Thermal-aware,
  Deadline-aware (EDF with feasibility), Network-aware. Scheduler output is **not** flight
  validation.

## 8. Communications (MODEL)
- Visibility: elevation ≥ station minimum elevation (geometric, spherical-free ECEF/WGS84).
- One active ground link per node (highest elevation). Rate = min(station rate, node terminal
  rate), constant during contact. **No RF link budget, weather or scheduling conflicts.**
- Latency = slant range / c (+ ISL hop range / c). Optional ISL: relay through another node with
  Earth-unobstructed line of sight (grazing altitude ≥ 100 km) and its own ground contact.

## What this model cannot tell you
Structural feasibility, launch mass/cost, radiation effects on hardware, attitude control,
debris risk, precise pass timing, RF spectrum availability, or real hardware performance.
