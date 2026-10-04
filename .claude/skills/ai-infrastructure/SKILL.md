---
name: ai-infrastructure
description: Use when changing accelerator/compute models, hardware presets, job types and workload generation, job dispatch across nodes, or any of the six scheduling strategies in OrbitCompute.
---

# AI infrastructure (OrbitCompute)

## When to use
Editing `backend/orbitcompute/{compute,scheduler,workloads}.py`, hardware presets, job schema,
compute rack view, job inspector, scheduler comparison metrics.

## Domain rules
- Accelerator presets are **classes** ("~700 W datacenter accelerator class"), labelled PRESET.
  Never put a product name next to a number unless sourced in `docs/DATA_SOURCES.md`.
- Job work unit: **reference accelerator-hours** (throughput 1.0 class at s = 1).
  Rate = `k_alloc · throughput · s`.
- Jobs are preemptible per step. `realtime` jobs progress only while a link exists.
- Allocations must satisfy `Σ k ≤ N` and job width `k ≤ job.accelerators` (width is fixed:
  a job runs at full width or not at all, except training which may run at ≥ 50% width).
- Schedulers are pure functions of (time, node state, queue) → allocations. No RNG inside.
- Workload generator uses `np.random.default_rng(seed)`; same seed ⇒ same jobs.

## Schedulers
| Key | Policy |
|---|---|
| `fifo` | arrival order, head-of-line blocking, ignores power/thermal/network |
| `priority` | priority desc, arrival; backfill |
| `energy` | power-budgeted; low-priority work only with solar surplus or SOC > high mark |
| `thermal` | proportional heat-budget controller targeting T_throttle − margin |
| `deadline` | EDF; infeasible jobs demoted |
| `network` | skip realtime jobs without link; defer big-output jobs when downlink backlog high |

## Metrics
completed, deadline misses, mean queue time, energy consumed, curtailed solar, utilization,
thermal throttling time, power-limited time.

## Paths
`backend/orbitcompute/compute.py`, `scheduler.py`, `workloads.py`, `simulate.py`,
`backend/tests/test_scheduler.py`, `frontend/src/panels/ComputeRack.tsx`, `JobInspector.tsx`.

## Validation
```bash
cd backend && uv run pytest -q tests/test_scheduler.py
```

## Common failure modes
- Non-determinism from dict/set iteration order — always sort by (key, job_id).
- Counting allocated-but-stalled realtime jobs as productive utilization.
- Deadline miss double-counted (once at deadline, once at end).
- Energy estimate fields treated as ground truth; they are *estimates* at nominal conditions.
