---
name: visual-validation
description: Use after changing OrbitCompute frontend visuals or interaction — verifies the 3D scene, modes, playback, scrubbing, panels and layout in a real browser with screenshots and Playwright.
---

# Visual validation (OrbitCompute)

## When to use
After any change under `frontend/src/` that affects rendering or interaction, before committing.

## Procedure
1. Start servers: backend `cd backend && uv run uvicorn orbitcompute.api:app --port 8000`,
   frontend `cd frontend && npm run dev` (port 3000). Or `.claude/launch.json` configs.
2. Open http://localhost:3000 in the browser pane. Check console has no errors.
3. Screenshot checklist:
   - Earth centered, land visible, terminator present and consistent with Sun direction.
   - Node visible with label; orbit path; ground track does not cross the globe interior.
   - Press Play → node moves; at 100× it enters eclipse (node glyph dims, power drops).
   - Scrub backward → panels show identical values to the forward pass at the same t.
   - Each mode (ORBIT/POWER/THERMAL/COMPUTE/NETWORK/SYSTEM) changes encoding + legend.
   - Click a timeline event → time jumps to it.
   - Mobile-ish width (1024px) still usable; no overlapping panels.
4. Run `cd frontend && npm run e2e`.

## Rules
- Color is never the only status cue — verify labels exist.
- Text ≥ 11px; monospace only for telemetry.
- No layout shift when values change (tabular numerals, fixed widths).

## Common failure modes
- WebGL context lost in headless runs — Playwright uses `--use-gl=swiftshader`/angle.
- Screens look fine at 1x but jitter at 1000× (interpolation index off-by-one).
- Legend not updated on mode switch.
