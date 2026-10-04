---
name: space-networking
description: Use when changing ground stations, visibility/elevation masks, contact windows, link rates, uplink/downlink data queues, latency, or inter-satellite links (ISL) in OrbitCompute.
---

# Space networking (OrbitCompute)

## When to use
Editing `backend/orbitcompute/{ground,network}.py`, station presets, network mode visuals,
contact window timeline, or data transfer metrics.

## Domain rules
- Visibility is geometric: elevation of the spacecraft above the station's **geodetic**
  horizon ≥ `min_elevation_deg`. No terrain, weather, or RF link budget.
- One ground link per node at a time: highest elevation visible station.
- Link rate = `min(station.rate, node.terminal_rate)` — constant through the pass (MODEL).
  Never display as an RF-derived number.
- Latency = slant range / c (+ ISL hop / c). Processing delay not modelled.
- ISL (optional): node without ground contact relays through another node that has contact and
  Earth-unobstructed line of sight (minimum ray altitude ≥ 100 km). Rate = min(ISL rate, relay link rate).
- Station coordinates: REAL (approximate public locations). Rates/masks: PRESET (illustrative).

## Formulas
- Station ECEF from geodetic (WGS84): `N = a/√(1−e²sin²φ)`,
  `r = [(N+h)cosφcosλ, (N+h)cosφsinλ, (N(1−e²)+h)sinφ]`
- Up vector: `[cosφcosλ, cosφsinλ, sinφ]` (geodetic φ)
- Elevation: `asin(ρ̂·up)`, ρ = r_sat_ecef − r_station
- Footprint half-angle at mask el: `λ = acos(R cos el /(R+h)) − el`
- LOS between sats: closest point of segment to Earth centre `> R⊕ + 100 km`.

## Paths
`backend/orbitcompute/ground.py`, `network.py`, `presets.py`, `backend/tests/test_ground.py`,
`frontend/src/scene/GroundStations.tsx`, `Links.tsx`, `frontend/src/panels/NetworkPanel.tsx`.

## Validation
```bash
cd backend && uv run pytest -q tests/test_ground.py
```

## Common failure modes
- Using ECI satellite position against ECEF station position.
- AOS/LOS events flapping at the mask edge — events use sign changes of (el − mask).
- Byte vs bit units: engine stores **Gbit** sizes and **Gbit/s** rates.
- Counting ISL-relayed availability as direct ground availability.
