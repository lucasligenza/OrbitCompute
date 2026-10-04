---
name: space-power-thermal
description: Use when changing eclipse/illumination, solar array generation, battery dispatch, power bus/load shedding, the two-node thermal model, radiators, heaters, or throttling in OrbitCompute.
---

# Space power & thermal (OrbitCompute)

## When to use
Editing `backend/orbitcompute/{eclipse,power,thermal}.py`, power/thermal config schema,
power-flow or thermal visualizations, or any number shown in kW / kWh / °C.

## Domain rules
- Eclipse comes from **geometry only** (conical shadow, fractional illumination). Never timers.
- Bus priority: generation → loads → battery charge → curtailment. Deficit: battery discharge
  (above SOC floor, under power limit) → shed compute → unmet (platform outage).
- Battery: `E += η_c·P_ch·Δt`, `E −= P_dis·Δt/η_d`; clamp to [E_min, E_max] by limiting power,
  never by clipping energy after the fact.
- Thermal: two lumped nodes (equipment, radiator) + conductance G. All dissipated electrical
  power → equipment node. Radiator rejects `εσA T⁴`, absorbs Earth IR via view factor.
  **Albedo not modelled. Say so in UI.** Always label "Simplified 2-node thermal model".
- Throttle: s = 1 below T_throttle, linear to s_min at T_limit, 0 at/above T_limit.
  Throttling reduces both throughput and dynamic power (linear in s).

## Formulas
- `S(r) = 1361·(AU/r)²` W/m²; `P_array = A·η·S·derate·pointing·f_illum`
- Conical shadow: apparent radii `θ☉ = asin(R☉/|r☉−r|)`, `θ⊕ = asin(R⊕/|r|)`, separation θ;
  overlap area of two circles → `f = 1 − overlap/(πθ☉²)`.
- Earth-IR view factor (edge-on plate): `F = (1/π)[atan(1/√(H²−1)) − √(H²−1)/H²]`, H = r/R⊕.
- Steady state (no G drop): `εσA T_r⁴ = Q_diss + Q_env`.
- Stable explicit sub-step: `dt_sub ≤ 0.5·min(C_e/G, C_r/(G + 4εσA T_r³))`.

## Paths
`backend/orbitcompute/eclipse.py`, `power.py`, `thermal.py`, `simulate.py`,
`backend/tests/test_eclipse.py`, `test_power.py`, `test_thermal.py`,
`frontend/src/panels/PowerFlow.tsx`, `ThermalPanel.tsx`, `SpacecraftSchematic.tsx`.

## Validation
```bash
cd backend && uv run pytest -q tests/test_eclipse.py tests/test_power.py tests/test_thermal.py
```

## Common failure modes
- Energy identity broken by curtailment computed before charge limit.
- Battery charging in eclipse from a stale generation value.
- Units: W vs kW (engine stores **kW** for power, **kWh** for energy, **K** internally, °C in UI).
- Radiator area semantics: radiating area counts both faces.
- Thermal explicit integration blowing up for small C — always sub-step.
- Claiming spacecraft-level thermal validity from a 2-node model.
