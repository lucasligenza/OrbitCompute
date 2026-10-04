# OrbitCompute — Validation Rules

## Commands
```bash
cd backend && uv run pytest -q                 # numerical + API tests
cd frontend && npm run typecheck && npm run lint
cd frontend && npm run test                    # unit (vitest)
cd frontend && npm run e2e                     # Playwright on installed Edge (starts both servers)
# PW_CHANNEL=chrome npm run e2e               # alternative browser channel
```

## Numerical invariants (must always hold)
| Area | Check | Tolerance |
|---|---|---|
| Orbit | Keplerian period = 2π√(a³/μ) | < 1e−9 rel |
| Orbit | |r| stays in [a(1−e), a(1+e)] | 1e−6 km |
| Orbit | SGP4 ISS near epoch: altitude 380–440 km, inclination ≈ 51.6° | — |
| Frames | ECI→ECEF→ECI round trip | < 1e−9 km |
| Frames | geodetic→ECEF→geodetic | < 1e−6 deg, 1 mm |
| Sun | declination at solstice ≈ ±23.44°, |r| ≈ 0.983–1.017 AU | 0.05° |
| Eclipse | anti-sun point in LEO is umbra; sub-solar side is sunlit; f monotonic through penumbra | — |
| Eclipse | simulated eclipse fraction matches beta-angle formula | < 3% of period |
| Power | per-step energy identity residual | < 1e−6 kWh |
| Battery | E_min ≤ E ≤ E_max at all samples | exact |
| Thermal | constant load converges to analytic radiative steady state | < 0.5 K |
| Thermal | temperatures finite and within physical bounds (3 K … 600 K) | exact |
| Scheduler | identical scenario ⇒ identical result hash | exact |
| Scheduler | allocated accelerators ≤ N every step | exact |
| Comms | visible ⇔ elevation ≥ mask; zenith pass detected | — |
| Timeline | sampleAt(t) after scrubbing backward equals fresh sampleAt(t) (vitest + Playwright) | exact |
| UI | 3D scene renders frames; no console errors on load | exact |
| UI | detail/explain panels, scene controls and legend never overlap at 1440, 1180, 1024 px; top bar never overflows | exact |
| UI | mission feed is sorted, starts/ends with mission items, link changes derived from recorded link state | exact |

## Honesty rules (review checklist)
- No preset is described as a real spacecraft or real product.
- Every UI value has a provenance badge or lives in a section that declares one.
- Thermal panel always shows "Simplified 2-node model".
- Scheduler comparison always shows "Simulation — not flight validation".
- Real data shows source + epoch/date.
