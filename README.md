# OrbitCompute — AI Data Centers in Orbit

An interactive engineering simulation exploring one question:

> *What would it actually take to operate large-scale AI compute infrastructure in orbit?*

Build a hypothetical orbital compute node or constellation, then watch it operate around Earth:
orbital motion, sunlight and eclipse, solar power and batteries, AI workloads and schedulers,
radiator heat rejection and throttling, and ground-station communication windows — all from a
deterministic physics-based engine.

**Not** a satellite tracker, not flight software, not a spacecraft design tool. See
[`docs/SCIENCE.md`](docs/SCIENCE.md) for exactly what is and isn't modelled.

## Quick start
```bash
# backend (Python 3.12, uv)
cd backend && uv sync && uv run uvicorn orbitcompute.api:app --port 8000
# frontend (Node 20+)
cd frontend && npm install && npm run dev
# open http://localhost:3000
```

## Layout
- `backend/` — FastAPI + NumPy simulation engine, SQLite persistence, pytest suite
- `frontend/` — Next.js + React Three Fiber visualization, Vitest + Playwright
- `docs/` — architecture, scientific model, validation rules, data sources, roadmap
- `.claude/skills/` — project-specific skills for AI-assisted development
