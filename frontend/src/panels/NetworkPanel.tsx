"use client";
import { memo, useMemo } from "react";
import { Badge } from "@/components/Badge";
import TimeChart from "@/components/charts/TimeChart";
import { AdvancedHint } from "@/components/DetailToggle";
import Gauge from "@/components/viz/Gauge";
import { Icon, type IconName } from "@/components/viz/Icon";
import KpiTile, { Insight, SectionTitle } from "@/components/viz/KpiTile";
import { fmtDur, fmtGbit, fmtGbps, fmtPct } from "@/sim/format";
import { lookAngles } from "@/sim/frames";
import type { PreparedNode, PreparedResult } from "@/sim/result";
import { cursorAt, positionEci, lerpAngle, type NodeSample } from "@/sim/sample";
import { timeStore } from "@/state/time";
import { useUi } from "@/state/ui";
import { useSelected } from "./hooks";

const LINK_COLOR: Record<string, string> = { DIRECT: "#3ecf8e", ISL: "#4da3ff", RELAY: "#a78bfa", NONE: "#5b6573" };

/** node → (ISL neighbour) → (GEO relay) → ground: the current data path. */
function LinkPath({ res, nd, s }: { res: PreparedResult; nd: PreparedNode; s: NodeSample }) {
  const hops: { icon: IconName; label: string; sub?: string }[] = [{ icon: "satellite", label: nd.name }];
  if (s.link === "ISL") hops.push({ icon: "satellite", label: res.nodes[s.linkRelay]?.name ?? "neighbour", sub: "ISL" });
  if (s.link === "RELAY") hops.push({ icon: "relay", label: res.raw.relays[s.linkGeo]?.name.replace(" (illustrative)", "") ?? "GEO relay", sub: "GEO" });
  if (s.link === "DIRECT" || s.link === "ISL") hops.push({ icon: "antenna", label: res.raw.stations[s.linkStation]?.name.split(" (")[0] ?? "station", sub: "ground" });
  if (s.link === "RELAY") hops.push({ icon: "antenna", label: "relay ground terminal", sub: "ground" });
  const color = LINK_COLOR[s.link];
  const none = s.link === "NONE";
  const W = 356, step = hops.length > 1 ? (W - 60) / (hops.length - 1) : 0;
  return (
    <svg viewBox={`0 0 ${W} 78`} width="100%" role="img" aria-label="Current data path" data-testid="link-path">
      {hops.slice(1).map((_, i) => (
        <path key={i} d={`M${30 + i * step + 16} 28 L${30 + (i + 1) * step - 16} 28`} className="flow flow-dash" stroke={color} strokeWidth={2}
          style={{ animationDuration: `${1.6 / Math.max(0.3, Math.min(s.linkDown / 3, 2))}s` }} />
      ))}
      {hops.map((h, i) => (
        <g key={i} transform={`translate(${30 + i * step - 16}, 12)`}>
          <rect width="32" height="32" rx="8" className="pf-card" style={none && i > 0 ? { opacity: 0.4 } : undefined} />
          <Icon name={h.icon} x={8} y={8} size={16} color={i === 0 ? "#e6e9ee" : color} />
          <text x="16" y="47" textAnchor="middle" style={{ fontSize: 10, fill: "#c3cad4" }}>{h.label.length > 16 ? h.label.slice(0, 15) + "…" : h.label}</text>
          {h.sub && <text x="16" y="59" textAnchor="middle" fill={color} style={{ fontSize: 9 }}>{h.sub}</text>}
        </g>
      ))}
      {none && <text x={W / 2} y={34} textAnchor="middle" className="val" fill="var(--muted)" fontSize={12}>no link</text>}
    </svg>
  );
}

/** Polar sky plot (azimuth / elevation) of the node as seen from a station during one pass. */
function SkyPlot({ res, nd, t }: { res: PreparedResult; nd: PreparedNode; t: number }) {
  const wins = nd.raw.contact_windows;
  const win = wins.find(([, a, b]) => t >= a && t < b) ?? wins.find(([, a]) => a > t) ?? wins[wins.length - 1];
  const trace = useMemo(() => {
    if (!win) return null;
    const [si, a, b] = win;
    const st = res.raw.stations[si];
    const pts: { az: number; el: number }[] = [];
    const p: [number, number, number] = [0, 0, 0];
    for (let tt = a; tt <= b; tt += res.dt / 2) {
      const c = cursorAt(res, tt);
      positionEci(nd, c, res.dt, p);
      pts.push(lookAngles(p, lerpAngle(res.gmst, c), st.ecef_km, st.lat_deg, st.lon_deg));
    }
    return { st, pts, a, b };
  }, [win, res, nd]);
  if (!trace) return <p className="note">No ground contacts in this horizon.</p>;
  const R = 70, cx = 80, cy = 80;
  const xy = (az: number, el: number) => {
    const r = (R * (90 - Math.max(el, -5))) / 90, a = (az * Math.PI) / 180;
    return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  };
  const d = trace.pts.map((q, i) => { const [x, y] = xy(q.az, q.el); return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`; }).join(" ");
  const inPass = t >= trace.a && t < trace.b;
  const now = (() => {
    if (!inPass) return null;
    const c = cursorAt(res, t);
    const p: [number, number, number] = [0, 0, 0];
    positionEci(nd, c, res.dt, p);
    return lookAngles(p, lerpAngle(res.gmst, c), trace.st.ecef_km, trace.st.lat_deg, trace.st.lon_deg);
  })();
  const mask = (R * (90 - trace.st.min_elevation_deg)) / 90;
  const first = trace.pts[0], last = trace.pts[trace.pts.length - 1];
  const maxEl = Math.max(...trace.pts.map((q) => q.el));
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }} data-testid="sky-plot">
      <svg viewBox="0 0 160 160" width={160} height={160} role="img" aria-label={`Sky plot from ${trace.st.name}`}>
        <defs><radialGradient id="sky" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stopColor="#13202f" /><stop offset="1" stopColor="#0a0f16" /></radialGradient></defs>
        <circle cx={cx} cy={cy} r={R} fill="url(#sky)" stroke="rgba(148,163,184,0.3)" />
        {[60, 30].map((e) => <circle key={e} cx={cx} cy={cy} r={(R * (90 - e)) / 90} fill="none" stroke="rgba(148,163,184,0.15)" />)}
        <circle cx={cx} cy={cy} r={mask} fill="none" stroke="#f5a524" strokeDasharray="2 3" opacity={0.7} />
        <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke="rgba(148,163,184,0.12)" />
        <line x1={cx} y1={cy - R} x2={cx} y2={cy + R} stroke="rgba(148,163,184,0.12)" />
        {[["N", 0], ["E", 90], ["S", 180], ["W", 270]].map(([l, az]) => {
          const [x, y] = xy(az as number, -7);
          return <text key={l as string} x={x} y={y + 3} textAnchor="middle" className="lbl" style={{ fontSize: 9 }}>{l}</text>;
        })}
        <path d={d} fill="none" stroke="#3ecf8e" strokeWidth={2} strokeLinecap="round" style={{ filter: "drop-shadow(0 0 3px #3ecf8e)" }} />
        {first && (() => { const [x, y] = xy(first.az, first.el); return <circle cx={x} cy={y} r={2.5} fill="#3ecf8e" />; })()}
        {last && (() => { const [x, y] = xy(last.az, last.el); return <rect x={x - 2.5} y={y - 2.5} width={5} height={5} fill="#3ecf8e" />; })()}
        {now && (() => { const [x, y] = xy(now.az, now.el); return <circle cx={x} cy={y} r={4.5} fill="#fff" stroke="#3ecf8e" strokeWidth={2} />; })()}
      </svg>
      <dl className="kv" style={{ flex: 1 }}>
        <dt>Station</dt><dd style={{ fontFamily: "var(--font-sans)" }}>{trace.st.name.split(" (")[0]}</dd>
        <dt>Pass</dt><dd>{inPass ? "in progress" : t < trace.a ? `in ${fmtDur(trace.a - t)}` : "last pass"}</dd>
        <dt>Duration</dt><dd>{fmtDur(trace.b - trace.a)}</dd>
        <dt>Max elevation</dt><dd>{maxEl.toFixed(0)}°</dd>
        {now && <><dt>Now</dt><dd>az {now.az.toFixed(0)}° · el {now.el.toFixed(0)}°</dd></>}
        <dt>Mask</dt><dd>{trace.st.min_elevation_deg}° <span style={{ color: "#f5a524" }}>┄</span></dd>
      </dl>
    </div>
  );
}

const ContactGantt = memo(function ContactGantt({ res, nd, t }: { res: PreparedResult; nd: PreparedNode; t: number }) {
  const dur = res.duration;
  return (
    <div data-testid="contact-gantt" style={{ fontSize: 11 }}>
      {res.raw.stations.map((st, si) => {
        const wins = nd.raw.contact_windows.filter((w) => w[0] === si);
        return (
          <div key={st.id} className="gantt-row">
            <span className="muted" title={st.name}>{st.name.split(" (")[0]}</span>
            <svg viewBox="0 0 1000 20" preserveAspectRatio="none" className="gantt-svg">
              <line x1="0" y1="19" x2="1000" y2="19" stroke="rgba(148,163,184,0.18)" vectorEffect="non-scaling-stroke" />
              {wins.map(([, a, b, el], i) => {
                const mid = ((a + b) / 2 / dur) * 1000, half = Math.max(((b - a) / dur) * 500, 5);
                const x0 = mid - half, x1 = mid + half, h = 3 + (el / 90) * 15;
                const active = t >= a && t < b;
                return (
                  <path key={i} d={`M${x0} 19 Q${(x0 + x1) / 2} ${19 - 2 * h} ${x1} 19 Z`} fill={active ? "#3ecf8e" : "rgba(62,207,142,0.45)"}
                    style={{ cursor: "pointer" }} onClick={() => timeStore.getState().seek(a)}>
                    <title>{`${fmtDur(b - a)} · max el ${el.toFixed(0)}°`}</title>
                  </path>
                );
              })}
              <line x1={(t / dur) * 1000} y1="0" x2={(t / dur) * 1000} y2="20" stroke="#fff" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
        );
      })}
      <div className="faint" style={{ fontSize: 10, marginTop: 2 }}>arc height ∝ maximum elevation of the pass</div>
    </div>
  );
});

const BacklogChart = memo(function BacklogChart({ res, nd }: { res: PreparedResult; nd: PreparedNode }) {
  const series = useMemo(() => [
    { data: nd.s.uplink_backlog_gbit, color: "#a78bfa", label: "upload backlog", fill: true },
    { data: nd.s.downlink_backlog_gbit, color: "#3ecf8e", label: "download backlog", fill: true },
  ], [nd]);
  const link = useMemo(() => [{ data: nd.s.link_down_gbps, color: "#4da3ff", label: "downlink rate", step: true, fill: true }], [nd]);
  return (
    <>
      <SectionTitle icon="link">Link rate</SectionTitle>
      <TimeChart dt={res.dt} duration={res.duration} height={64} unit="Gbps" series={link} />
      <SectionTitle icon="queue">Data backlog</SectionTitle>
      <TimeChart dt={res.dt} duration={res.duration} height={84} unit="Gbit" series={series} testId="backlog-chart" />
    </>
  );
});

export default function NetworkPanel() {
  const { res, nd, cfg, s, t } = useSelected(10);
  const adv = useUi((u) => u.detail === "advanced");
  const m = nd.raw.metrics;
  const nextWin = nd.raw.contact_windows.find(([, a]) => a > t);
  const curWin = nd.raw.contact_windows.find(([si, a, b]) => si === s.linkStation && t >= a && t < b);
  const linkSeries = useMemo(() => Float64Array.from(nd.s.link_type, (v) => (v > 0 ? 1 : 0)), [nd]);
  const insight = s.link === "NONE"
    ? `No link: data waits on board${nextWin ? `; next contact ${res.raw.stations[nextWin[0]].name.split(" (")[0]} in ${fmtDur(nextWin[1] - t)}` : ""}.`
    : s.link === "DIRECT" && curWin ? `Ground pass in progress, ${fmtDur(curWin[2] - t)} remaining.`
      : s.link === "RELAY" ? `Relayed through geostationary orbit: always-on coverage at the cost of ~${s.latencyMs.toFixed(0)} ms path latency.`
        : s.link === "ISL" ? "Reaching the ground through a neighbouring spacecraft over an inter-satellite link." : undefined;
  return (
    <div data-testid="network-panel">
      <div className="panel-title-row">
        <span className="mono" style={{ fontWeight: 600 }}>{nd.name}</span>
        <Badge kind="MODEL" text="Geometric visibility · fixed rates" />
      </div>
      <div className="card hero">
        <div className="muted" style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", margin: "2px 0 0 4px" }}>Active link</div>
        <LinkPath res={res} nd={nd} s={s} />
        {s.link !== "NONE" && (
          <div className="mono muted" style={{ fontSize: 11, textAlign: "center", marginTop: -4, marginBottom: 4 }}>
            ↓ {fmtGbps(s.linkDown)} · ↑ {fmtGbps(s.linkUp)} · {s.latencyMs.toFixed(s.latencyMs > 50 ? 0 : 1)} ms · {s.rangeKm.toFixed(0)} km
          </div>
        )}
      </div>
      <div className="gauges">
        <Gauge value={m.network_availability} display={fmtPct(m.network_availability)} label="Any link" sub="this run" color="#4da3ff" />
        <Gauge value={m.direct_contact_fraction} display={fmtPct(m.direct_contact_fraction)} label="Ground contact" sub={`${nd.raw.contact_windows.length} passes`} color="#3ecf8e" />
        <Gauge value={Math.min((s.upBacklog + s.downBacklog) / 500, 1)} display={fmtGbit(s.upBacklog + s.downBacklog)} label="Backlog" sub="waiting data" color={s.upBacklog + s.downBacklog > 200 ? "#f5a524" : "#a78bfa"} />
      </div>
      <Insight text={insight} />
      {!adv && <AdvancedHint what="sky plot, contact windows, backlog history" />}
      {adv && (
        <>
          <SectionTitle icon="globe">Sky plot (station view)</SectionTitle>
          <div className="card pad"><SkyPlot res={res} nd={nd} t={t} /></div>
          <div className="kpis">
            <KpiTile icon="up" label="Uplinked" value={fmtGbit(m.uplinked_gbit)} />
            <KpiTile icon="down" label="Downlinked" value={fmtGbit(m.downlinked_gbit)} />
            <KpiTile icon="link" label="Link up" value={s.link === "NONE" ? "no" : s.link.toLowerCase()} spark={{ data: linkSeries, dt: res.dt, duration: res.duration, color: "#3ecf8e", min: 0, max: 1 }} />
          </div>
          <SectionTitle icon="antenna" right={<span className="faint">click a pass to jump</span>}>Ground contact windows</SectionTitle>
          <ContactGantt res={res} nd={nd} t={t} />
          <BacklogChart res={res} nd={nd} />
          <p className="note">
            Visibility = elevation above each station&apos;s mask (geometry only). Rates are configured constants: no RF link budget,
            weather or antenna scheduling. Station coordinates are approximate public site locations; link parameters are illustrative.
            {cfg.comms.relay_enabled && " GEO relays are illustrative (three equatorial relays); latency includes the GEO-to-ground hop."}
            {cfg.comms.isl_enabled && " ISL: one hop to a neighbour with a ground or relay link and Earth-unobstructed line of sight."}
          </p>
        </>
      )}
    </div>
  );
}
