---
name: scientific-validation
description: Use before claiming any OrbitCompute physics/engineering change is correct, when adding presets or data, when writing UI text about results, or when reviewing honesty/provenance of displayed values.
---

# Scientific validation (OrbitCompute)

## When to use
After any change to the engine, presets, data files, or user-facing explanatory text.

## Rules
1. Run the invariant suite (see `docs/VALIDATION.md`) — never claim correctness without it.
2. Every new formula: cite source in a docstring and add an analytic or limiting-case test.
3. Provenance: REAL (sourced), PHYSICS (calculated), MODEL (simplified), USER, PRESET.
   Synthetic values are never REAL. Real data records source + retrieval date + epoch.
4. Presets are examples, not spacecraft proposals. Hardware presets are classes.
5. Thermal results: "Simplified 2-node thermal model — not a spacecraft thermal analysis".
6. Scheduler results: "Simulation — not flight validation".
7. If a result looks surprising, check limiting cases before "fixing" the visualization.

## Limiting-case checks
- e = 0 ⇒ constant radius; i = 0 ⇒ latitude ≡ 0.
- β > β* ⇒ no eclipse; SSO dawn-dusk at 550 km ⇒ little/no eclipse outside solstice season.
- Zero compute ⇒ battery only drained by platform loads.
- Infinite radiator ⇒ temperature → environment sink; zero radiator ⇒ monotonic heating.
- Same seed ⇒ identical job list and result hash.

## Validation
```bash
cd backend && uv run pytest -q
```

## Common failure modes
- Tests that only assert "runs without error".
- Tolerances loosened to make a test pass instead of finding the bug.
- UI copy promising precision the model lacks ("exact pass time", "real throughput").
