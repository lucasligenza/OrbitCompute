# OrbitCompute

Interactive engineering simulation: what would it take to run AI compute infrastructure in orbit?
Python deterministic engine (`backend/`) + Next.js/React Three Fiber replay client (`frontend/`).

## Ground rules
- Engine is the single source of truth; the frontend only interpolates results (`sampleAt`).
- Deterministic: same scenario + `ENGINE_VERSION` ⇒ same result. Bump `ENGINE_VERSION`
  in `backend/orbitcompute/__init__.py` whenever engine output changes.
- Label provenance: REAL / PHYSICS / MODEL / USER / PRESET. Never present synthetic as real.
- Frames are explicit (`_eci`, `_ecef`, `_deg`). Units: km, s, kW, kWh, K (°C only in UI), Gbit.

## Commands
```bash
cd backend && uv sync && uv run pytest -q
cd backend && uv run uvicorn orbitcompute.api:app --reload --port 8000
cd frontend && npm install && npm run dev        # http://localhost:3000 (proxies /api → :8000)
cd frontend && npm run typecheck && npm run lint && npm run test && npm run e2e
```

## Skills (`.claude/skills/`)
| Skill | Use for |
|---|---|
| `orbital-mechanics` | propagation, frames, presets, ground tracks |
| `space-power-thermal` | eclipse, arrays, battery, thermal, throttling |
| `ai-infrastructure` | compute model, jobs, schedulers, dispatch |
| `space-networking` | stations, visibility, links, ISL, data queues |
| `orbitcompute-ui` | scene, modes, panels, design tokens |
| `scientific-validation` | before claiming any engine/preset/copy change is correct |
| `visual-validation` | before committing UI changes |

## Docs
`docs/ARCHITECTURE.md` · `docs/SCIENCE.md` (model boundaries) · `docs/VALIDATION.md` ·
`docs/ROADMAP.md` · `docs/DATA_SOURCES.md`

## Git
One commit per stable milestone (see roadmap). Never force push.
