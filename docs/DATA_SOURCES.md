# OrbitCompute — Data Sources

| Data | Source | Provenance | Notes |
|---|---|---|---|
| ISS (ZARYA) TLE, NORAD 25544 | CelesTrak GP API `https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE` | REAL | Snapshot retrieved 2026-10-04, epoch 2026-10-03T19:41:35Z. Stored in `backend/data/reference_tle.json`. Used only as a reference orbit; OrbitCompute nodes are hypothetical. |
| Live TLE refresh | same API (optional `/api/tle/{catnr}` endpoint) | REAL | Network access optional; falls back to snapshot. |
| Land outlines | Natural Earth via `world-atlas` npm (land-110m/50m TopoJSON) | REAL (public domain) | Rendered into a canvas texture at runtime. |
| Ground station sites | Public descriptions of well-known sites (NASA Wallops, KSAT Svalbard, KSAT TrollSat, UAF/ASF Fairbanks, SANSA Hartebeesthoek, ESA New Norcia, JAXA Okinawa, Punta Arenas) | Coordinates: REAL (approximate, ±0.1°). Link rates/masks: PRESET (illustrative) | OrbitCompute does not represent any real contract or capacity at these sites. |
| Physical constants | WGS84, IAU, CODATA, TSI 1361 W/m² (Kopp & Lean 2011) | REAL | See `docs/SCIENCE.md`. |
| Accelerator classes | Order-of-magnitude public TDP ranges of AI accelerators | PRESET | Generic classes, not product specs. |
