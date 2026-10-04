# OrbitCompute — Architecture

OrbitCompute is an interactive engineering simulation of AI compute infrastructure in orbit.
The system is split into a **deterministic simulation engine** (Python) and a **replay-only
visualization client** (Next.js + React Three Fiber).

```
┌──────────────────────── frontend (Next.js, client-only app) ───────────────────────┐
│ UI state (zustand)   ─ mode, selection, panels, editor drafts                       │
│ Time store (vanilla) ─ t, playing, speed  (updated per animation frame, no React)   │
│ Result store         ─ immutable SimResult → typed arrays                           │
│                                                                                     │
│ sampleAt(result, t)  → interpolated SimSample  (pure function, no mutation)         │
│      │                                                                              │
│      ├── 3D scene (R3F): Earth, terminator, nodes, orbits, tracks, links, shadow    │
│      ├── Panels: What-is-happening, power flow, thermal, compute rack, network      │
│      └── Timeline, charts, comparison, tutorial                                     │
└───────────────────────────────────┬─────────────────────────────────────────────────┘
                                    │ HTTP JSON (gzip)  /api/*  → proxied to :8000
┌───────────────────────────────────┴─────────────────────────────────────────────────┐
│ backend (FastAPI)                                                                    │
│  api.py      routes: presets, scenarios, simulate, results, orbit preview, compare   │
│  store.py    SQLite: scenarios (editable) + results (immutable, content-addressed)   │
│  simulate.py orchestrates the engine                                                 │
│     timebase → orbit/sgp4 → frames → sun → eclipse → ground (vectorised geometry)    │
│     step loop over all nodes: dispatch → scheduler → power → battery → thermal → net │
│     events.py   post-hoc event extraction with interpolated crossing times           │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## Principles

1. **Single source of truth.** All physical/system state comes from the engine. The client
   never integrates physics; it interpolates between engine samples. Scrubbing backward is a
   lookup, so position, battery, jobs, thermal and network state are always consistent.
2. **Determinism.** Same scenario JSON + same `ENGINE_VERSION` ⇒ bit-identical result. Random
   workloads use a seeded `numpy.random.default_rng(seed)`. Results are keyed by
   `sha256(canonical_json(scenario) + ENGINE_VERSION)` and never mutated.
3. **Provenance on every value.** Inputs carry a provenance tag: `real` (sourced data),
   `user` (configured), `preset` (illustrative default), outputs are `modeled`. The UI shows it.
4. **Bounded size.** ≤ 12 nodes, ≤ 6 000 samples per node, ≤ 4 000 jobs per run.

## Coordinate frames (never mixed silently)

| Name | Definition | Used for |
|---|---|---|
| `ECI` | TEME-like inertial frame of date (true equator, mean equinox). SGP4 output frame; user Keplerian elements are defined in it. | propagation, sun vector, eclipse, 3D render frame |
| `ECEF` | Earth-fixed, `r_ecef = R3(GMST) · r_eci` (IAU-82 GMST, UT1≈UTC, no polar motion) | ground stations, visibility, ground track |
| `GEODETIC` | WGS84 latitude/longitude/height | display, station input |
| `RENDER` | Three.js world: `(x, y, z)_three = (x, z, −y)_eci / 1000 km` | scene only |

Conversions live in `backend/orbitcompute/frames.py` and `frontend/src/sim/frames.ts`
(render mapping only). Each array in the result is named with its frame suffix
(`r_eci`, `lat_deg`, …).

## Simulation step (per Δt, all nodes in lockstep)

1. Geometry (precomputed, vectorised): `r_eci, v_eci, lat, lon, alt, illum, station elevation`.
2. **Dispatch** newly arrived jobs to a node (constellations: least normalised backlog).
3. **Network**: choose best visible station (or ISL relay); move uplink/downlink bytes.
4. **Thermal throttle** factor from start-of-step equipment temperature.
5. **Scheduler** policy chooses accelerator allocations given power budget, thermal state,
   network state, deadlines.
6. **Power bus**: generation, loads, load-shedding of compute if bus cannot supply, battery
   dispatch, curtailment, unmet energy.
7. **Thermal**: two-node lumped model integrated with stable sub-steps.
8. Job progress, completion, deadline bookkeeping.
9. Record sample.

After the loop, `events.py` extracts timeline events from the recorded series.

## Frontend state separation

- **Simulation state**: `SimResult` (immutable, typed arrays) in `resultStore`.
- **Render state**: derived per-frame inside `useFrame` from `timeStore.getState().t` — no
  React re-render per frame.
- **UI state**: mode, selected node/job, open panels, editor drafts (`uiStore`, `scenarioStore`).
  Panels subscribe to time through `useSimTime(hz)` which throttles to ~10 Hz.

## Persistence

SQLite file `backend/.data/orbitcompute.sqlite3` (git-ignored):
- `scenarios(id, name, json, created_at, updated_at)` — user-editable.
- `results(hash, scenario_json, engine_version, result_json_gz, created_at)` — immutable.
