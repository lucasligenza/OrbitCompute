// Render-frame mapping only. Engine frames: ECI (TEME-like), ECEF = R3(GMST)·ECI, WGS84 geodetic.
// Three.js world (RENDER): (x, y, z)_three = (x, z, −y)_eci / 1000 km  (proper rotation, det = +1).
// The Earth group is rotated by +GMST about three's y axis; its children use ECEF mapped the same way.

export const KM_PER_UNIT = 1000;
export const EARTH_RADIUS_KM = 6378.137;
export const EARTH_R = EARTH_RADIUS_KM / KM_PER_UNIT;

export function eciToRender(x: number, y: number, z: number, out: [number, number, number]) {
  out[0] = x / KM_PER_UNIT;
  out[1] = z / KM_PER_UNIT;
  out[2] = -y / KM_PER_UNIT;
  return out;
}

/** ECEF (km) -> Earth-group local render coordinates. */
export const ecefToLocal = eciToRender;

/** Spherical render placement of a geodetic point (display only; not used for physics). */
export function latLonToLocal(latDeg: number, lonDeg: number, radius: number, out: [number, number, number]) {
  const la = (latDeg * Math.PI) / 180;
  const lo = (lonDeg * Math.PI) / 180;
  const x = Math.cos(la) * Math.cos(lo);
  const y = Math.cos(la) * Math.sin(lo);
  const z = Math.sin(la);
  out[0] = x * radius;
  out[1] = z * radius;
  out[2] = -y * radius;
  return out;
}

/** Ring of points on a sphere at central angle `lambda` (rad) around (lat, lon). */
export function smallCircle(latDeg: number, lonDeg: number, lambda: number, radius: number, segments = 96) {
  const la = (latDeg * Math.PI) / 180;
  const lo = (lonDeg * Math.PI) / 180;
  const pts: number[] = [];
  for (let k = 0; k <= segments; k++) {
    const az = (2 * Math.PI * k) / segments;
    const lat2 = Math.asin(Math.sin(la) * Math.cos(lambda) + Math.cos(la) * Math.sin(lambda) * Math.cos(az));
    const lon2 = lo + Math.atan2(Math.sin(az) * Math.sin(lambda) * Math.cos(la), Math.cos(lambda) - Math.sin(la) * Math.sin(lat2));
    const p: [number, number, number] = [0, 0, 0];
    latLonToLocal((lat2 * 180) / Math.PI, (lon2 * 180) / Math.PI, radius, p);
    pts.push(...p);
  }
  return new Float32Array(pts);
}

export function footprintHalfAngle(altKm: number, minElDeg: number) {
  const el = (minElDeg * Math.PI) / 180;
  return Math.acos((EARTH_RADIUS_KM * Math.cos(el)) / (EARTH_RADIUS_KM + altKm)) - el;
}
