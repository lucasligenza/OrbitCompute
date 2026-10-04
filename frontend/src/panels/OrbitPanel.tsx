"use client";
import { memo } from "react";
import { Badge } from "@/components/Badge";
import TimeChart from "@/components/charts/TimeChart";
import { fmtDur, fmtPct } from "@/sim/format";
import type { PreparedNode, PreparedResult } from "@/sim/result";
import { useSelected } from "./hooks";

const OrbitCharts = memo(function OrbitCharts({ res, nd }: { res: PreparedResult; nd: PreparedNode }) {
  let lo = Infinity, hi = -Infinity;
  for (const v of nd.s.alt_km) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return (
    <>
      <div className="group-h">Altitude (WGS84 geodetic)</div>
      <TimeChart dt={res.dt} duration={res.duration} height={80} unit="km"
        series={[{ data: nd.s.alt_km, color: "#4da3ff", label: "altitude" }]} yMin={Math.floor(lo - 5)} yMax={Math.ceil(hi + 5)} />
      <div className="group-h">Illumination fraction</div>
      <TimeChart dt={res.dt} duration={res.duration} height={60} yMin={0} yMax={1}
        series={[{ data: nd.s.illum, color: "#ffd98a", label: "solar disc visible", step: true }]} />
    </>
  );
});

export default function OrbitPanel() {
  const { res, nd, s } = useSelected(10);
  const o = nd.raw.orbit;
  const isTle = String(o.source).startsWith("TLE");
  const period = Number(o.period_s);
  const eclFrac = nd.raw.eclipse_windows.reduce((a, [x, y]) => a + (y - x), 0) / res.duration;
  const speed = Math.hypot(nd.s.v_eci_x[0], nd.s.v_eci_y[0], nd.s.v_eci_z[0]);
  return (
    <div data-testid="orbit-panel">
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
        <span className="mono" style={{ fontWeight: 600 }}>{nd.name}</span>
        {isTle ? <Badge kind="REAL" text={`TLE · ${o.name}`} /> : <Badge kind="PHYSICS" text="Kepler + J2" />}
      </div>
      <div className="stats">
        <div className="stat"><div className="k">Period</div><div className="n">{(period / 60).toFixed(1)} min</div></div>
        <div className="stat"><div className="k">Altitude</div><div className="n">{s.alt.toFixed(0)} km</div></div>
        <div className="stat"><div className="k">Speed</div><div className="n">{speed.toFixed(2)} km/s</div></div>
        <div className="stat"><div className="k">Inclination</div><div className="n">{Number(o.inclination_deg).toFixed(2)}°</div></div>
        <div className="stat"><div className="k">β angle</div><div className="n">{Number(o.beta_deg_at_epoch).toFixed(1)}°</div></div>
        <div className="stat"><div className="k">In eclipse</div><div className="n">{fmtPct(eclFrac)}</div></div>
      </div>
      <dl className="kv">
        <dt>Sub-satellite point</dt><dd>{s.lat.toFixed(2)}°, {s.lon.toFixed(2)}°</dd>
        <dt>RAAN (epoch)</dt><dd>{Number(o.raan_deg).toFixed(2)}°</dd>
        <dt>Eccentricity</dt><dd>{Number(o.eccentricity).toFixed(5)}</dd>
        <dt>Arg. of perigee</dt><dd>{Number(o.arg_perigee_deg).toFixed(2)}°</dd>
        <dt>Mean anomaly (epoch)</dt><dd>{Number(o.mean_anomaly_deg).toFixed(2)}°</dd>
        <dt>Orbits in horizon</dt><dd>{(res.duration / period).toFixed(1)}</dd>
        <dt>Eclipses in horizon</dt><dd>{nd.raw.eclipse_windows.length}</dd>
        <dt>Longest eclipse</dt><dd>{fmtDur(Math.max(0, ...nd.raw.eclipse_windows.map(([a, b]) => b - a)))}</dd>
      </dl>
      <OrbitCharts res={res} nd={nd} />
      <p className="note">
        Frames: propagation in an ECI (TEME-like) frame; Earth rotates by GMST (IAU-82) into ECEF; latitude/longitude are WGS84
        geodetic. Altitude oscillates mostly because Earth is oblate. Eclipse uses a conical shadow with a finite solar disc.
      </p>
    </div>
  );
}
