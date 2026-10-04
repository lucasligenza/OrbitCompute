# OrbitCompute — Roadmap

Each milestone is a commit that leaves `pytest` and the frontend build green.

| # | Commit | Scope | Done when |
|---|---|---|---|
| 0 | `docs: define OrbitCompute architecture and scientific assumptions` | docs, skills, CLAUDE.md | committed |
| 1 | `feat: implement orbital propagation and Earth visualization` | timebase, frames, Kepler+J2, SGP4, Earth scene | period/frames tests pass, globe renders |
| 2 | `feat: add sunlight and eclipse simulation` | sun vector, conical shadow, terminator shader | eclipse tests, terminator moves |
| 3 | `feat: implement spacecraft power system` | arrays, bus, battery | energy-conservation tests |
| 4 | `feat: add AI workload simulation` | compute model, jobs, 6 schedulers | determinism tests |
| 5 | `feat: implement thermal model` | 2-node thermal, throttling | steady-state + bounds tests |
| 6 | `feat: add communications windows` | stations, visibility, data queues, ISL | visibility tests |
| 7 | `feat: build integrated mission timeline` | events, time controls, explain panel | scrubbing tests |
| 8 | `feat: add deep power thermal compute visualizations` | modes, power flow, thermal schematic, rack | visual checks |
| 9 | `feat: add constellation scenarios` | multi-node, dispatcher, presets | ≤12 nodes run |
| 10 | `feat: add scenario comparison` | compare API + view | metrics diff |
| 11 | `style: polish orbital mission-control experience` | design pass, tutorial | visual review |
| 12 | `test: validate OrbitCompute system behavior` | Playwright e2e, numeric suite | all green |

## Later (not v1)
OR-Tools optimisation scheduler · Earth albedo · RF link budgets · drag/decay · per-station
contention · multi-accelerator-class nodes · result streaming for long horizons.
