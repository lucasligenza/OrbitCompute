---
name: orbitcompute-ui
description: Use when building or changing OrbitCompute frontend UI — the R3F 3D scene, visualization modes, time controls, panels (what-is-happening, power flow, thermal, compute rack, network), editors, comparison, tutorial, or design tokens.
---

# OrbitCompute UI

## When to use
Anything under `frontend/src/`.

## Architecture rules
- **Replay only.** UI never integrates physics. Read state via `sampleAt(result, t)` from
  `src/sim/sample.ts`. Scrubbing must be a pure lookup.
- Three state kinds: simulation (`resultStore`, immutable), render (computed inside `useFrame`
  from `timeStore.getState()`), UI (`uiStore`, `scenarioStore`).
- Never put `t` in React state that re-renders the Canvas. Panels use `useSimTime(10)`.
- Scene units: 1 unit = 1000 km. Mapping `three = (x, z, −y)_eci` in `src/sim/frames.ts`.
- ≤ 12 nodes; use shared geometries/materials; dispose textures you create.
- Modes change **encoding only**: `orbit | power | thermal | compute | network | system`.

## Design language
- Background graphite `#07090c`; Earth is the focal point.
- Accent electric blue `--accent: #4da3ff` (restrained). Text `#e6e9ee` / muted `#8b95a3`.
- Status: nominal `#3ecf8e`, warning `#f5a524`, failure `#ef4444`, eclipse/indigo `#6b72ff`.
- Status is **never color-only**: always text label or icon shape too.
- Monospace (`--font-mono`) only for telemetry, UTC, IDs, numbers, orbital elements.
- No neon, minimal glow, thin 1px lines, compact panels that collapse. No giant cards.
- Every panel declaring numbers shows provenance (`REAL / PHYSICS / MODEL / USER / PRESET`).

## Paths
`frontend/src/scene/*`, `src/panels/*`, `src/editor/*`, `src/compare/*`, `src/tutorial/*`,
`src/state/*`, `src/sim/*`, `src/app/globals.css`.

## Validation
```bash
cd frontend && npm run typecheck && npm run lint && npm run test && npm run build
```
Then use the visual-validation skill.

## Common failure modes
- SSR touching `window`/WebGL — the app shell is `dynamic(..., { ssr: false })`.
- Per-frame `setState` → whole-app re-render jank.
- Ground-track lines crossing the globe at the antimeridian.
- Creating new `THREE.Vector3` per frame per object — reuse scratch vectors.
- Forgetting `data-tutorial` anchors when moving UI (tutorial breaks).
