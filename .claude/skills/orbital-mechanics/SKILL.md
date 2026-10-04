---
name: orbital-mechanics
description: Use when touching orbit propagation, Keplerian/TLE elements, sun-synchronous presets, coordinate frames (ECI/TEME, ECEF, geodetic), GMST, ground tracks, or the render-frame mapping in OrbitCompute.
---

# Orbital mechanics (OrbitCompute)

## When to use
Editing `backend/orbitcompute/{timebase,frames,orbit,sun}.py`, orbit presets, the orbit preview
endpoint, or `frontend/src/sim/frames.ts` / scene placement of nodes, stations, tracks.

## Domain rules
- **Never mix frames silently.** Arrays carry frame suffixes: `r_eci`, `r_ecef`, `lat_deg`.
  ECI = TEME-like frame of date. ECEF = `R3(GMST)·ECI`. Geodetic = WGS84.
- Keplerian nodes: two-body + J2 secular only (Ω̇, ω̇, Ṁ). SGP4 for TLE input.
- Time: UTC seconds since scenario epoch (`t_s`); JD via `timebase.jd_utc`. UT1≈UTC.
- Altitude in UI is **above the WGS84 equatorial radius** for circular orbits:
  `a = R⊕ + h`. Displayed geodetic altitude varies with latitude (oblateness) — expected.
- Render mapping (scene only): `three = (x, z, −y)_eci / 1000`. Earth group rotation.y = GMST.

## Formulas
- `n = √(μ/a³)`, `T = 2π/n`, `p = a(1−e²)`
- `Ω̇ = −1.5 n J2 (R/p)² cos i`; `ω̇ = 0.75 n J2 (R/p)² (5cos²i − 1)`;
  `Ṁ = n[1 + 0.75 J2 (R/p)² √(1−e²)(3cos²i − 1)]`
- SSO: `cos i = −Ω̇_ss / (1.5 n J2 (R/p)²)`, `Ω̇_ss = 2π/(365.2422·86400)` rad/s
- SSO RAAN from LTAN: `Ω = α☉ + (LTAN − 12h)·15°/h`
- GMST (IAU-82, seconds): `67310.54841 + (876600·3600 + 8640184.812866)T + 0.093104T² − 6.2e−6T³`
- Kepler: Newton on `E − e sin E = M`, vectorised, 12 iterations max.

## Paths
`backend/orbitcompute/orbit.py`, `frames.py`, `timebase.py`, `presets.py`,
`backend/data/reference_tle.json`, `backend/tests/test_orbit.py`, `test_frames.py`,
`frontend/src/sim/frames.ts`, `frontend/src/scene/*`.

## Validation
```bash
cd backend && uv run pytest -q tests/test_orbit.py tests/test_frames.py
```

## Common failure modes
- Degrees vs radians (all engine internals radians; schema fields end in `_deg`).
- Rotating by −GMST instead of +GMST (stations drift the wrong way; ground track mirrors).
- Using geocentric latitude for station "up" vector (elevation errors ~0.2°).
- Propagating a TLE days from epoch and calling it real.
- Wrapping longitude: ground-track lines must break at ±180° to avoid globe-spanning segments.
