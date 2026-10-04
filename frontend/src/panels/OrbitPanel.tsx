"use client";
import { memo, useEffect, useMemo, useRef } from "react";
import { Badge } from "@/components/Badge";
import TimeChart from "@/components/charts/TimeChart";
import { AdvancedHint } from "@/components/DetailToggle";
import Gauge from "@/components/viz/Gauge";
import KpiTile, { Insight, SectionTitle } from "@/components/viz/KpiTile";
import { fmtDur, fmtPct } from "@/sim/format";
import type { PreparedNode, PreparedResult } from "@/sim/result";
import { cursorAt, lerp, lerpAngle } from "@/sim/sample";
import { landMapCanvas } from "@/scene/landTexture";
import { useSimTime } from "@/state/time";
import { useUi } from "@/state/ui";
import { useSelected } from "./hooks";

/** Equirectangular mini-map: land, day/night shading from the simulated Sun, ground track
 *  (sunlit vs eclipse), ground stations and the current sub-satellite point. */
function GroundTrackMap({ res, nd }: { res: PreparedResult; nd: PreparedNode }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const t = useSimTime(5);
  const nightRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const W = c.clientWidth, H = W / 2, dpr = window.devicePixelRatio || 1;
    c.width = W * dpr; c.height = H * dpr; c.style.height = `${H}px`;
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.drawImage(landMapCanvas(), 0, 0, W, H);
    // night shading at low resolution from subsolar point
    const cur = cursorAt(res, t);
    const sx = lerp(res.sun.x, cur), sy = lerp(res.sun.y, cur), sz = lerp(res.sun.z, cur);
    const dec = Math.asin(sz / Math.hypot(sx, sy, sz));
    const lonSun = Math.atan2(sy, sx) - lerpAngle(res.gmst, cur);
    const gw = 120, gh = 60;
    const night = nightRef.current ?? (nightRef.current = document.createElement("canvas"));
    night.width = gw; night.height = gh;
    const ng = night.getContext("2d")!;
    const img = ng.createImageData(gw, gh);
    for (let j = 0; j < gh; j++) {
      const lat = (Math.PI / 2) - ((j + 0.5) / gh) * Math.PI;
      for (let i = 0; i < gw; i++) {
        const lon = ((i + 0.5) / gw) * 2 * Math.PI - Math.PI;
        const cz = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(lon - lonSun);
        const a = Math.min(Math.max((0.06 - cz) / 0.14, 0), 1) * 0.62;
        const k = (j * gw + i) * 4;
        img.data[k] = 2; img.data[k + 1] = 4; img.data[k + 2] = 12; img.data[k + 3] = a * 255;
      }
    }
    ng.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(night, 0, 0, W, H);
    const X = (lon: number) => ((lon + 180) / 360) * W;
    const Y = (lat: number) => ((90 - lat) / 180) * H;
    // stations
    for (const st of res.raw.stations) {
      g.fillStyle = "#9fb3c8";
      g.beginPath(); g.arc(X(st.lon_deg), Y(st.lat_deg), 2, 0, Math.PI * 2); g.fill();
    }
    // ground track window: one period back, half ahead
    const period = Number(nd.raw.orbit.period_s) || 5700;
    const i0 = Math.max(0, Math.floor((t - period) / res.dt)), i1 = Math.min(res.n - 1, Math.ceil((t + period / 2) / res.dt));
    for (let i = i0; i < i1; i++) {
      const lo0 = nd.s.lon_deg[i], lo1 = nd.s.lon_deg[i + 1];
      if (Math.abs(lo1 - lo0) > 180) continue; // antimeridian
      const future = i * res.dt > t;
      const lit = nd.s.illum[i] >= 0.5;
      g.strokeStyle = lit ? (future ? "rgba(245,165,36,0.35)" : "#f5a524") : (future ? "rgba(107,114,255,0.4)" : "#8a8fff");
      g.lineWidth = future ? 1 : 1.8;
      g.beginPath(); g.moveTo(X(lo0), Y(nd.s.lat_deg[i])); g.lineTo(X(lo1), Y(nd.s.lat_deg[i + 1])); g.stroke();
    }
    // current position
    const lat = lerp(nd.s.lat_deg, cur);
    let lo = nd.s.lon_deg[cur.i];
    const lon1 = nd.s.lon_deg[Math.min(cur.i + 1, res.n - 1)];
    if (Math.abs(lon1 - lo) < 180) lo += (lon1 - lo) * cur.f;
    g.shadowColor = "#4da3ff"; g.shadowBlur = 10;
    g.fillStyle = "#ffffff";
    g.beginPath(); g.arc(X(lo), Y(lat), 3.5, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = "#4da3ff"; g.lineWidth = 1.5;
    g.beginPath(); g.arc(X(lo), Y(lat), 7, 0, Math.PI * 2); g.stroke();
  }, [res, nd, t]);
  return (
    <div>
      <canvas ref={ref} className="minimap" data-testid="ground-track-map" />
      <div className="chart-legend">
        <span><i style={{ background: "#f5a524" }} />track in sunlight</span>
        <span><i style={{ background: "#8a8fff" }} />track in eclipse</span>
        <span><i style={{ background: "#9fb3c8", height: 4, width: 4, borderRadius: 2 }} />stations</span>
        <span className="faint">night side shaded</span>
      </div>
    </div>
  );
}

/** Orbit geometry (schematic, angles to scale): inclination to the equator and β angle to the Sun. */
function OrbitGeometry({ inc, beta }: { inc: number; beta: number }) {
  const cx = 90, cy = 70, R = 34, L = 72;
  const ri = (-inc * Math.PI) / 180;
  const ox = Math.cos(ri) * L, oy = Math.sin(ri) * L;
  const rb = ri - (beta * Math.PI) / 180;
  const bx = Math.cos(rb), by = Math.sin(rb);
  return (
    <svg viewBox="0 0 356 140" width="100%" role="img" aria-label={`Inclination ${inc.toFixed(1)} degrees, beta ${beta.toFixed(1)} degrees`}>
      <defs><radialGradient id="eg" cx="0.35" cy="0.35" r="0.8"><stop offset="0" stopColor="#2a5a8f" /><stop offset="1" stopColor="#0d1f36" /></radialGradient></defs>
      <line x1={cx - L - 10} y1={cy} x2={cx + L + 10} y2={cy} stroke="#5b6573" strokeDasharray="3 3" />
      <text x={cx + L + 12} y={cy + 3} className="lbl">equator</text>
      <circle cx={cx} cy={cy} r={R} fill="url(#eg)" stroke="#4da3ff" strokeOpacity={0.4} />
      <line x1={cx - ox} y1={cy - oy} x2={cx + ox} y2={cy + oy} stroke="#4da3ff" strokeWidth={2} />
      <path d={`M${cx + 26} ${cy} A26 26 0 0 0 ${cx + Math.cos(ri) * 26} ${cy + Math.sin(ri) * 26}`} fill="none" stroke="#c9d1db" />
      <text x={cx + 30} y={cy - 6} className="val" fontSize={11}>i {inc.toFixed(1)}°</text>
      <text x={cx + ox - 8} y={cy + oy - 6} className="lbl" fill="#4da3ff">orbit plane (edge-on)</text>
      {/* Sun direction relative to the orbit plane */}
      <g transform="translate(250,70)">
        <line x1={-Math.cos(ri) * 60} y1={-Math.sin(ri) * 60} x2={Math.cos(ri) * 60} y2={Math.sin(ri) * 60} stroke="#4da3ff" strokeWidth={1.5} strokeDasharray="4 3" />
        <line x1={0} y1={0} x2={bx * 62} y2={by * 62} stroke="#ffd98a" strokeWidth={2} markerEnd="url(#sunArr)" />
        <defs><marker id="sunArr" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7z" fill="#ffd98a" /></marker></defs>
        <circle cx={bx * 70} cy={by * 70} r={6} fill="#ffd98a" />
        <text x={-60} y={52} className="val" fontSize={11}>β {beta.toFixed(1)}°</text>
        <text x={-60} y={64} className="lbl">Sun angle to orbit plane</text>
      </g>
    </svg>
  );
}

const OrbitCharts = memo(function OrbitCharts({ res, nd }: { res: PreparedResult; nd: PreparedNode }) {
  let lo = Infinity, hi = -Infinity;
  for (const v of nd.s.alt_km) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const alt = useMemo(() => [{ data: nd.s.alt_km, color: "#4da3ff", label: "altitude" }], [nd]);
  const ill = useMemo(() => [{ data: nd.s.illum, color: "#ffd98a", label: "solar disc visible", step: true, fill: true }], [nd]);
  return (
    <>
      <SectionTitle icon="orbit">Altitude (WGS84 geodetic)</SectionTitle>
      <TimeChart dt={res.dt} duration={res.duration} height={78} unit="km" series={alt} yMin={Math.floor(lo - 5)} yMax={Math.ceil(hi + 5)} />
      <SectionTitle icon="sun">Illumination fraction</SectionTitle>
      <TimeChart dt={res.dt} duration={res.duration} height={60} yMin={0} yMax={1} series={ill} />
    </>
  );
});

export default function OrbitPanel() {
  const { res, nd, s, t } = useSelected(10);
  const adv = useUi((u) => u.detail === "advanced");
  const o = nd.raw.orbit;
  const isTle = String(o.source).startsWith("TLE");
  const period = Number(o.period_s);
  const eclFrac = nd.raw.eclipse_windows.reduce((a, [x, y]) => a + (y - x), 0) / res.duration;
  const speed = Math.hypot(nd.s.v_eci_x[0], nd.s.v_eci_y[0], nd.s.v_eci_z[0]);
  const inEcl = nd.raw.eclipse_windows.find(([a, b]) => t >= a && t < b);
  const nextEcl = nd.raw.eclipse_windows.find(([a]) => a > t);
  const insight = inEcl ? `In Earth's shadow for another ${fmtDur(inEcl[1] - t)}.`
    : nextEcl ? `In sunlight; next eclipse in ${fmtDur(nextEcl[0] - t)}, about ${fmtPct(eclFrac)} of the time is spent in shadow.`
      : "Continuous sunlight in this horizon: the orbit plane never crosses Earth's shadow.";
  return (
    <div data-testid="orbit-panel">
      <div className="panel-title-row">
        <span className="mono" style={{ fontWeight: 600 }}>{nd.name}</span>
        {isTle ? <Badge kind="REAL" text={`TLE · ${o.name}`} /> : <Badge kind="PHYSICS" text="Kepler + J2" />}
      </div>
      <div className="card hero"><GroundTrackMap res={res} nd={nd} /></div>
      <div className="gauges">
        <Gauge value={(t % period) / period} display={`${(period / 60).toFixed(1)}m`} label="Period" sub={`orbit ${Math.floor(t / period) + 1} of ${Math.ceil(res.duration / period)}`} color="#4da3ff" />
        <Gauge value={Math.min(s.alt / 2000, 1)} display={`${s.alt.toFixed(0)}`} label="Altitude" sub="km" color="#7c8cff" />
        <Gauge value={1 - eclFrac} display={fmtPct(1 - eclFrac)} label="Sunlit" sub={`${nd.raw.eclipse_windows.length} eclipses`} color="#ffd98a" />
      </div>
      <Insight text={insight} />
      {!adv && <AdvancedHint what="orbital elements, geometry diagram, altitude and illumination history" />}
      {adv && (
        <>
          <SectionTitle icon="orbit">Geometry <span className="faint" style={{ textTransform: "none", letterSpacing: 0 }}>schematic, angles to scale</span></SectionTitle>
          <div className="card pad"><OrbitGeometry inc={Number(o.inclination_deg)} beta={Number(o.beta_deg_at_epoch)} /></div>
          <div className="kpis">
            <KpiTile icon="orbit" label="Speed" value={speed.toFixed(2)} unit="km/s" />
            <KpiTile icon="globe" label="Inclination" value={`${Number(o.inclination_deg).toFixed(2)}°`} />
            <KpiTile icon="sun" label="β at epoch" value={`${Number(o.beta_deg_at_epoch).toFixed(1)}°`} />
          </div>
          <dl className="kv">
            <dt>Sub-satellite point</dt><dd>{s.lat.toFixed(2)}°, {s.lon.toFixed(2)}°</dd>
            <dt>RAAN (epoch)</dt><dd>{Number(o.raan_deg).toFixed(2)}°</dd>
            <dt>Eccentricity</dt><dd>{Number(o.eccentricity).toFixed(5)}</dd>
            <dt>Arg. of perigee</dt><dd>{Number(o.arg_perigee_deg).toFixed(2)}°</dd>
            <dt>Mean anomaly (epoch)</dt><dd>{Number(o.mean_anomaly_deg).toFixed(2)}°</dd>
            <dt>Longest eclipse</dt><dd>{fmtDur(Math.max(0, ...nd.raw.eclipse_windows.map(([a, b]) => b - a)))}</dd>
          </dl>
          <OrbitCharts res={res} nd={nd} />
          <p className="note">
            Frames: propagation in an ECI (TEME-like) frame; Earth rotates by GMST (IAU-82) into ECEF; latitude/longitude are WGS84
            geodetic. Altitude oscillates mostly because Earth is oblate. Eclipse uses a conical shadow with a finite solar disc.
          </p>
        </>
      )}
    </div>
  );
}
