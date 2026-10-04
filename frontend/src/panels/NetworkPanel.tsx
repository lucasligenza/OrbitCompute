"use client";
import { memo, useMemo } from "react";
import { Badge } from "@/components/Badge";
import TimeChart from "@/components/charts/TimeChart";
import { fmtDur, fmtGbit, fmtGbps, fmtPct } from "@/sim/format";
import type { PreparedNode, PreparedResult } from "@/sim/result";
import { timeStore } from "@/state/time";
import { useSelected } from "./hooks";

const ContactGantt = memo(function ContactGantt({ res, nd, t }: { res: PreparedResult; nd: PreparedNode; t: number }) {
  const dur = res.duration;
  const stations = res.raw.stations;
  return (
    <div data-testid="contact-gantt" style={{ fontSize: 11 }}>
      {stations.map((st, si) => {
        const wins = nd.raw.contact_windows.filter((w) => w[0] === si);
        return (
          <div key={st.id} style={{ display: "grid", gridTemplateColumns: "118px 1fr", alignItems: "center", gap: 6, height: 15 }}>
            <span className="muted" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={st.name}>{st.name.split(" (")[0]}</span>
            <div style={{ position: "relative", height: 8, background: "#121822", borderRadius: 2 }}>
              {wins.map(([, a, b, el], i) => (
                <div key={i} title={`${fmtDur(b - a)} · max el ${el.toFixed(0)}°`}
                  onClick={() => timeStore.getState().seek(a)}
                  style={{ position: "absolute", left: `${(a / dur) * 100}%`, width: `${Math.max(((b - a) / dur) * 100, 0.3)}%`, top: 0, bottom: 0,
                    background: t >= a && t < b ? "var(--ok)" : "rgba(62,207,142,0.45)", cursor: "pointer", borderRadius: 1 }} />
              ))}
              <div style={{ position: "absolute", left: `${(t / dur) * 100}%`, top: -2, bottom: -2, width: 1, background: "#fff" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
});

const BacklogChart = memo(function BacklogChart({ res, nd }: { res: PreparedResult; nd: PreparedNode }) {
  const series = useMemo(() => [
    { data: nd.s.uplink_backlog_gbit, color: "#a78bfa", label: "upload backlog" },
    { data: nd.s.downlink_backlog_gbit, color: "#3ecf8e", label: "download backlog" },
  ], [nd]);
  const link = useMemo(() => [{ data: nd.s.link_down_gbps, color: "#4da3ff", label: "downlink rate", step: true, fill: true }], [nd]);
  return (
    <>
      <div className="group-h">Link rate</div>
      <TimeChart dt={res.dt} duration={res.duration} height={60} unit="Gbps" series={link} />
      <div className="group-h">Data backlog</div>
      <TimeChart dt={res.dt} duration={res.duration} height={80} unit="Gbit" series={series} testId="backlog-chart" />
    </>
  );
});

export default function NetworkPanel() {
  const { res, nd, cfg, s, t } = useSelected(10);
  const m = nd.raw.metrics;
  const linkLabel =
    s.link === "DIRECT" ? `Ground: ${res.raw.stations[s.linkStation]?.name}`
      : s.link === "ISL" ? `ISL via ${res.nodes[s.linkRelay]?.name}`
        : s.link === "RELAY" ? `${res.raw.relays[s.linkGeo]?.name}` : "No link";
  return (
    <div data-testid="network-panel">
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
        <span className="mono" style={{ fontWeight: 600 }}>{nd.name}</span>
        <Badge kind="MODEL" text="Geometric visibility · fixed rates" />
      </div>
      <div className="stat" style={{ marginBottom: 8 }}>
        <div className="k">Active link</div>
        <div className="n" style={{ fontSize: 13, color: s.link === "NONE" ? "var(--muted)" : "var(--ok)" }}>{linkLabel}</div>
        {s.link !== "NONE" && (
          <div className="muted mono" style={{ fontSize: 11, marginTop: 2 }}>
            ↓ {fmtGbps(s.linkDown)} · ↑ {fmtGbps(s.linkUp)} · {s.latencyMs.toFixed(s.latencyMs > 50 ? 0 : 1)} ms · {s.rangeKm.toFixed(0)} km path
          </div>
        )}
      </div>
      <div className="stats">
        <div className="stat"><div className="k">Any link</div><div className="n">{fmtPct(m.network_availability)}</div></div>
        <div className="stat"><div className="k">Direct contact</div><div className="n">{fmtPct(m.direct_contact_fraction)}</div></div>
        <div className="stat"><div className="k">Contacts</div><div className="n">{nd.raw.contact_windows.length}</div></div>
        <div className="stat"><div className="k">Uplinked</div><div className="n">{fmtGbit(m.uplinked_gbit)}</div></div>
        <div className="stat"><div className="k">Downlinked</div><div className="n">{fmtGbit(m.downlinked_gbit)}</div></div>
        <div className="stat"><div className="k">Terminal</div><div className="n">{fmtGbps(cfg.comms.terminal_rate_gbps)}</div></div>
      </div>
      <div className="group-h">Ground contact windows <span className="faint">click to jump</span></div>
      <ContactGantt res={res} nd={nd} t={t} />
      <BacklogChart res={res} nd={nd} />
      <p className="note">
        Visibility = elevation above each station&apos;s mask (geometry only). Rates are configured constants — no RF link budget,
        weather or antenna scheduling. Station coordinates are approximate public site locations; link parameters are illustrative.
        {cfg.comms.relay_enabled && " GEO relays are illustrative (three equatorial relays); latency includes the GEO-to-ground hop."}
        {cfg.comms.isl_enabled && " ISL: one hop to a neighbour with a ground or relay link and Earth-unobstructed line of sight."}
      </p>
    </div>
  );
}
