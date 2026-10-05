"use client";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/Badge";
import SpacecraftSchematic from "@/components/SpacecraftSchematic";
import { api } from "@/sim/api";
import { fmtKw, fmtPct } from "@/sim/format";
import type { JobSpec, NodeConfig, OrbitPreview, Scenario, SchedulerKey } from "@/sim/types";
import { useScenario } from "@/state/scenario";
import { useUi } from "@/state/ui";
import { BoolField, NumField, SelectField } from "./fields";

type Tab = "orbit" | "hardware" | "workload" | "ground" | "simulation";
const SCHEDULERS: { value: SchedulerKey; label: string; hint: string }[] = [
  { value: "fifo", label: "FIFO", hint: "Arrival order with head-of-line blocking. Ignores power, thermal and network state." },
  { value: "priority", label: "Priority", hint: "Highest priority first; smaller jobs backfill free accelerators." },
  { value: "energy", label: "Energy-aware", hint: "Runs low-priority work only on solar surplus or spare battery; reserves charge for the next eclipse." },
  { value: "thermal", label: "Thermal-aware", hint: "Limits heat dissipation to keep equipment below the throttle threshold." },
  { value: "deadline", label: "Deadline-aware (EDF)", hint: "Earliest deadline first; jobs that cannot make their deadline are demoted." },
  { value: "network", label: "Network-aware", hint: "Skips realtime jobs without a link; defers output-heavy jobs when the download backlog is high." },
];
const SIGMA = 5.670374419e-8;

function Orbit({ node, i, edit, epoch }: { node: NodeConfig; i: number; edit: (fn: (n: NodeConfig) => void) => void; epoch: string }) {
  const catalog = useScenario((s) => s.catalog)!;
  const setUi = useUi((s) => s.set);
  const [adv, setAdv] = useState(false);
  const [pv, setPv] = useState<OrbitPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const o = node.orbit;
  useEffect(() => {
    const h = setTimeout(() => {
      api.preview(o, epoch).then((d) => { setPv(d); setErr(null); setUi({ preview: { nodeIndex: i, data: d } }); })
        .catch((e) => setErr((e as Error).message));
    }, 250);
    return () => clearTimeout(h);
  }, [o, epoch, i, setUi]);
  const presets = Object.entries(catalog.orbits);
  return (
    <div data-testid="orbit-editor">
      <SelectField label="Orbit preset" value={o.preset ?? ""} testId="orbit-preset"
        options={[{ value: "", label: "Custom" }, ...presets.map(([k, v]) => ({ value: k, label: v.label }))]}
        onChange={(k) => edit((n) => {
          if (!k) { n.orbit.preset = null; return; }
          const p = catalog.orbits[k];
          n.orbit = { ...n.orbit, mode: "kepler", sun_synchronous: false, ltan_h: null, tle_line1: null, tle_line2: null, tle_name: null,
            eccentricity: 0, arg_perigee_deg: 0, ...Object.fromEntries(Object.entries(p).filter(([kk]) => kk !== "label")), preset: k };
        })} />
      {o.mode === "tle" ? (
        <div className="note">
          <Badge kind="REAL" text="TLE" /> {o.tle_name} — propagated with SGP4 from its epoch. Choose a Keplerian preset to edit elements.
          <pre className="mono" style={{ fontSize: 10.5, whiteSpace: "pre-wrap" }}>{o.tle_line1}{"\n"}{o.tle_line2}</pre>
        </div>
      ) : (
        <>
          <NumField label="Altitude" hint="above equatorial radius" value={o.altitude_km} min={200} max={2000} step={10} unit="km" slider testId="altitude"
            onChange={(v) => edit((n) => { n.orbit.altitude_km = v; n.orbit.preset = null; })} />
          <BoolField label="Sun-synchronous" hint="inclination from J2 nodal-rate condition" value={o.sun_synchronous}
            onChange={(v) => edit((n) => { n.orbit.sun_synchronous = v; n.orbit.ltan_h = v ? (n.orbit.ltan_h ?? 18) : null; n.orbit.preset = null; })} />
          {o.sun_synchronous ? (
            <NumField label="LTAN" hint="local time of ascending node (sets RAAN)" value={o.ltan_h ?? 18} min={0} max={23.99} step={0.25} unit="h" slider
              onChange={(v) => edit((n) => { n.orbit.ltan_h = v; n.orbit.preset = null; })} />
          ) : (
            <>
              <NumField label="Inclination" value={o.inclination_deg} min={0} max={180} step={0.5} unit="°" slider testId="inclination"
                onChange={(v) => edit((n) => { n.orbit.inclination_deg = v; n.orbit.preset = null; })} />
              <NumField label="RAAN" hint="right ascension of ascending node" value={o.raan_deg} min={0} max={360} step={1} unit="°" slider
                onChange={(v) => edit((n) => { n.orbit.raan_deg = v; n.orbit.ltan_h = null; n.orbit.preset = null; })} />
            </>
          )}
          <NumField label="Eccentricity" value={o.eccentricity} min={0} max={0.1} step={0.001} slider
            onChange={(v) => edit((n) => { n.orbit.eccentricity = v; n.orbit.preset = null; })} />
          <button className="btn sm ghost" onClick={() => setAdv(!adv)}>{adv ? "▾" : "▸"} Advanced</button>
          {adv && (
            <>
              <NumField label="Argument of perigee" value={o.arg_perigee_deg} min={0} max={360} unit="°"
                onChange={(v) => edit((n) => { n.orbit.arg_perigee_deg = v; })} />
              <NumField label="Mean anomaly at epoch" value={o.mean_anomaly_deg} min={0} max={360} unit="°"
                onChange={(v) => edit((n) => { n.orbit.mean_anomaly_deg = v; })} />
            </>
          )}
        </>
      )}
      <div className="group-h">Preview <Badge kind="PREVIEW" /></div>
      {err && <div className="note" style={{ color: "var(--bad)" }}>{err}</div>}
      {pv && (
        <div className="stats" data-testid="orbit-preview">
          <div className="stat"><div className="k">Period</div><div className="n">{(pv.period_s / 60).toFixed(1)} min</div></div>
          <div className="stat"><div className="k">Inclination</div><div className="n">{pv.elements.inclination_deg.toFixed(2)}°</div></div>
          <div className="stat"><div className="k">β angle</div><div className="n">{pv.beta_deg.toFixed(1)}°</div></div>
          <div className="stat"><div className="k">Eclipse / orbit</div><div className="n">{pv.eclipse_minutes.toFixed(1)} min</div></div>
          <div className="stat"><div className="k">Sunlit</div><div className="n">{fmtPct(1 - pv.eclipse_fraction)}</div></div>
          <div className="stat"><div className="k">Footprint</div><div className="n">{pv.footprint_half_angle_deg.toFixed(1)}°</div></div>
        </div>
      )}
      <p className="note">The dashed white loop in the scene is this preview at epoch. Eclipse estimate uses a cylindrical shadow and
        the β angle at epoch; the simulation uses the full conical model over time. Press <b>Run simulation</b> to apply.</p>
    </div>
  );
}

function Hardware({ node, edit, eclipseFrac }: { node: NodeConfig; edit: (fn: (n: NodeConfig) => void) => void; eclipseFrac: number }) {
  const catalog = useScenario((s) => s.catalog)!;
  const c = node.compute;
  const ratedSolar = (node.solar.area_m2 * node.solar.efficiency * 1361 * node.solar.derate * node.solar.pointing_factor) / 1000;
  const computeMax = (c.accelerator_count * c.max_w * c.host_overhead) / 1000;
  const fixedLoads = node.platform.avionics_kw + node.platform.thermal_base_kw + node.comms.idle_kw;
  const fullLoad = fixedLoads + computeMax * (1 + node.platform.pump_fraction);
  const orbitAvgGen = ratedSolar * (1 - eclipseFrac) * node.battery.charge_efficiency;
  const radCap = (t: number) => (node.thermal.emissivity * SIGMA * node.thermal.radiator_area_m2 * Math.pow(t + 273.15, 4)) / 1000;
  const tRad = node.thermal.throttle_c - fullLoad / node.thermal.conductance_kw_per_k;
  const ed = <K extends keyof NodeConfig>(sec: K, key: keyof NodeConfig[K]) => (v: number | boolean) =>
    edit((n) => { (n[sec] as unknown as Record<string, unknown>)[key as string] = v; });
  return (
    <div data-testid="hardware-editor">
      <SpacecraftSchematic cfg={node} />
      <div className="stats">
        <div className="stat"><div className="k">Array rated</div><div className="n">{fmtKw(ratedSolar)}</div></div>
        <div className="stat"><div className="k">Orbit-avg gen.</div><div className="n">{fmtKw(orbitAvgGen)}</div></div>
        <div className="stat"><div className="k">Full load</div><div className="n" style={{ color: fullLoad > orbitAvgGen ? "var(--warn)" : undefined }}>{fmtKw(fullLoad)}</div></div>
        <div className="stat"><div className="k">Radiator @ thr.</div><div className="n" style={{ color: radCap(tRad) < fullLoad ? "var(--warn)" : undefined }}>{fmtKw(radCap(tRad))}</div></div>
        <div className="stat"><div className="k">Eclipse energy</div><div className="n">{(fullLoad * eclipseFrac * 1.6).toFixed(0)} kWh</div></div>
        <div className="stat"><div className="k">Usable battery</div><div className="n">{(node.battery.capacity_kwh * (node.battery.max_soc - node.battery.min_soc)).toFixed(0)} kWh</div></div>
      </div>
      <p className="note">Quick sizing estimates <Badge kind="PREVIEW" />: orbit-average generation vs. full-load demand, radiator rejection
        at (throttle − full-load ΔT across G), and energy for one ~{(eclipseFrac * 96).toFixed(0)}-minute eclipse at full load. Run the simulation for the real answer.</p>

      <div className="group-h">Compute</div>
      <SelectField label="Accelerator class" hint="illustrative class, not a product" value={c.accelerator_class}
        options={Object.entries(catalog.accelerators).map(([k, v]) => ({ value: k, label: v.label }))}
        onChange={(k) => edit((n) => { const a = catalog.accelerators[k]; Object.assign(n.compute, { accelerator_class: k, idle_w: a.idle_w, max_w: a.max_w, relative_throughput: a.relative_throughput, memory_gb: a.memory_gb }); })} />
      <NumField label="Accelerator count" value={c.accelerator_count} min={0} max={4096} step={8} slider testId="accel-count" onChange={(v) => ed("compute", "accelerator_count")(Math.round(v))} />
      <NumField label="Full-load power" hint="per accelerator" value={c.max_w} min={10} max={3000} step={10} unit="W" onChange={ed("compute", "max_w")} />
      <NumField label="Idle power" hint="per accelerator" value={c.idle_w} min={0} max={1000} step={5} unit="W" onChange={ed("compute", "idle_w")} />
      <NumField label="Relative throughput" hint="1.0 = reference class" value={c.relative_throughput} min={0.01} max={10} step={0.05} onChange={ed("compute", "relative_throughput")} />
      <NumField label="Host overhead" hint="CPU, memory, networking multiplier" value={c.host_overhead} min={1} max={3} step={0.05} unit="×" onChange={ed("compute", "host_overhead")} />

      <div className="group-h">Solar array</div>
      <NumField label="Area" value={node.solar.area_m2} min={0} max={20000} step={10} unit="m²" slider testId="solar-area" onChange={ed("solar", "area_m2")} />
      <NumField label="Cell efficiency" value={node.solar.efficiency} min={0.05} max={0.5} step={0.01} scale={100} unit="%" onChange={ed("solar", "efficiency")} />
      <NumField label="Derate" hint="wiring, mismatch, ageing" value={node.solar.derate} min={0.3} max={1} step={0.01} scale={100} unit="%" onChange={ed("solar", "derate")} />
      <NumField label="Pointing factor" hint="1.0 = ideal sun tracking" value={node.solar.pointing_factor} min={0} max={1} step={0.05} onChange={ed("solar", "pointing_factor")} />

      <div className="group-h">Battery</div>
      <NumField label="Capacity" value={node.battery.capacity_kwh} min={1} max={10000} step={5} unit="kWh" slider testId="battery-capacity" onChange={ed("battery", "capacity_kwh")} />
      <NumField label="Max charge power" value={node.battery.max_charge_kw} min={0} max={5000} step={5} unit="kW" onChange={ed("battery", "max_charge_kw")} />
      <NumField label="Max discharge power" value={node.battery.max_discharge_kw} min={0} max={5000} step={5} unit="kW" onChange={ed("battery", "max_discharge_kw")} />
      <NumField label="Charge efficiency" value={node.battery.charge_efficiency} min={0.5} max={1} step={0.01} scale={100} unit="%" onChange={ed("battery", "charge_efficiency")} />
      <NumField label="Discharge efficiency" value={node.battery.discharge_efficiency} min={0.5} max={1} step={0.01} scale={100} unit="%" onChange={ed("battery", "discharge_efficiency")} />
      <NumField label="Reserve SOC" hint="compute is shed here" value={node.battery.min_soc} min={0} max={0.9} step={0.01} scale={100} unit="%" onChange={ed("battery", "min_soc")} />
      <NumField label="Emergency floor" hint="essential loads only below reserve" value={node.battery.emergency_soc} min={0} max={0.5} step={0.01} scale={100} unit="%" onChange={ed("battery", "emergency_soc")} />
      <NumField label="Initial SOC" value={node.battery.initial_soc} min={0} max={1} step={0.01} scale={100} unit="%" onChange={ed("battery", "initial_soc")} />

      <div className="group-h">Radiator & thermal</div>
      <NumField label="Radiating area" hint="both faces counted" value={node.thermal.radiator_area_m2} min={0} max={20000} step={10} unit="m²" slider testId="radiator-area" onChange={ed("thermal", "radiator_area_m2")} />
      <NumField label="Emissivity" value={node.thermal.emissivity} min={0.05} max={1} step={0.01} onChange={ed("thermal", "emissivity")} />
      <NumField label="Heat transport conductance" value={node.thermal.conductance_kw_per_k} min={0.1} max={500} step={0.5} unit="kW/K" onChange={ed("thermal", "conductance_kw_per_k")} />
      <NumField label="Equipment heat capacity" value={node.thermal.equipment_heat_capacity_kj_per_k} min={10} max={1e6} step={100} unit="kJ/K" onChange={ed("thermal", "equipment_heat_capacity_kj_per_k")} />
      <NumField label="Throttle threshold" value={node.thermal.throttle_c} min={20} max={150} step={1} unit="°C" onChange={ed("thermal", "throttle_c")} />
      <NumField label="Thermal limit" value={node.thermal.limit_c} min={30} max={160} step={1} unit="°C" onChange={ed("thermal", "limit_c")} />
      <NumField label="Sun-facing fraction" hint="radiator solar loading (default edge-on)" value={node.thermal.sun_exposure_fraction} min={0} max={1} step={0.05} onChange={ed("thermal", "sun_exposure_fraction")} />

      <div className="group-h">Platform & communications</div>
      <NumField label="Avionics / housekeeping" value={node.platform.avionics_kw} min={0} max={500} step={0.5} unit="kW" onChange={ed("platform", "avionics_kw")} />
      <NumField label="Comms terminal rate" value={node.comms.terminal_rate_gbps} min={0.01} max={400} step={0.5} unit="Gbps" onChange={ed("comms", "terminal_rate_gbps")} />
      <BoolField label="GEO relay terminal" hint="illustrative relay satellites" value={node.comms.relay_enabled} onChange={ed("comms", "relay_enabled")} />
      {node.comms.relay_enabled && <NumField label="Relay rate" value={node.comms.relay_rate_gbps} min={0.01} max={100} step={0.1} unit="Gbps" onChange={ed("comms", "relay_rate_gbps")} />}
      <BoolField label="Inter-satellite link" value={node.comms.isl_enabled} onChange={ed("comms", "isl_enabled")} />
    </div>
  );
}

function Workload({ draft, edit }: { draft: Scenario; edit: (fn: (s: Scenario) => void) => void }) {
  const result = useScenario((s) => s.result);
  const w = draft.workload;
  const [text, setText] = useState(() => JSON.stringify(w.jobs.slice(0, 50), null, 1));
  const [err, setErr] = useState<string | null>(null);
  const importJobs = () => {
    try {
      const jobs = JSON.parse(text) as JobSpec[];
      if (!Array.isArray(jobs)) throw new Error("Expected a JSON array of jobs");
      edit((s) => { s.workload.mode = "explicit"; s.workload.jobs = jobs; });
      setErr(null);
    } catch (e) { setErr((e as Error).message); }
  };
  const exportGenerated = () => {
    if (!result) return;
    const jobs: JobSpec[] = result.jobs.map((j) => ({
      job_id: j.job_id, name: j.name, type: j.type, arrival_s: j.arrival_s, deadline_s: j.deadline_s, priority: j.priority,
      accelerators: j.accelerators, work_ref_acc_h: j.work_ref_acc_h, input_gbit: j.input_gbit, output_gbit: j.output_gbit,
      network_dependency: j.network_dependency,
    }));
    setText(JSON.stringify(jobs, null, 1));
  };
  return (
    <div data-testid="workload-editor">
      <SelectField label="Workload source" value={w.mode} options={[{ value: "generated", label: "Generated (seeded, deterministic)" }, { value: "explicit", label: "Explicit job list (imported)" }]}
        onChange={(v) => edit((s) => { s.workload.mode = v; })} />
      {w.mode === "generated" ? (
        <>
          <NumField label="Seed" value={w.seed} min={0} max={1e9} onChange={(v) => edit((s) => { s.workload.seed = Math.round(v); })} />
          <NumField label="Intensity" hint="offered load ÷ nominal capacity" value={w.intensity} min={0} max={3} step={0.05} slider testId="intensity"
            onChange={(v) => edit((s) => { s.workload.intensity = v; })} />
          <div className="group-h">Mix (relative share of offered work)</div>
          {(["inference", "training", "batch", "background"] as const).map((k) => (
            <NumField key={k} label={k} value={w.mix[k]} min={0} max={1} step={0.05} slider onChange={(v) => edit((s) => { s.workload.mix[k] = v; })} />
          ))}
          <p className="note">
            Inference: serving sessions, high priority, short deadlines, often <i>realtime</i> (needs a link to progress). Training: wide,
            long, low priority, large input upload. Batch: medium jobs with input and output transfers. Background: low-priority filler.
          </p>
        </>
      ) : (
        <p className="note">{w.jobs.length} explicit jobs loaded.</p>
      )}
      <div className="group-h">Import / export jobs (JSON)</div>
      <textarea className="json" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="Jobs JSON" />
      {err && <div className="note" style={{ color: "var(--bad)" }}>{err}</div>}
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <button className="btn sm" onClick={importJobs}>Import as explicit jobs</button>
        <button className="btn sm" onClick={exportGenerated} disabled={!result}>Load jobs from current result</button>
      </div>
      <p className="note">Fields: job_id, type (inference|training|batch|background), arrival_s, deadline_s, priority 0–10, accelerators,
        work_ref_acc_h, input_gbit, output_gbit, network_dependency (none|input|output|both|realtime).</p>
    </div>
  );
}

function Ground({ draft, edit }: { draft: Scenario; edit: (fn: (s: Scenario) => void) => void }) {
  const catalog = useScenario((s) => s.catalog)!;
  const [custom, setCustom] = useState({ name: "", lat: 0, lon: 0 });
  const inScenario = new Set(draft.ground_stations.map((g) => g.id));
  return (
    <div data-testid="ground-editor">
      <p className="note">Coordinates are approximate public locations of real ground-station sites <Badge kind="REAL" />; minimum
        elevation and link rates are illustrative <Badge kind="PRESET" />. OrbitCompute does not represent any real capacity at these sites.</p>
      {catalog.ground_stations.map((st) => {
        const cur = draft.ground_stations.find((g) => g.id === st.id);
        return (
          <div key={st.id} style={{ borderBottom: "1px solid var(--line)", padding: "4px 0" }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={inScenario.has(st.id)}
                onChange={(e) => edit((s) => {
                  s.ground_stations = e.target.checked ? [...s.ground_stations, { ...st }] : s.ground_stations.filter((g) => g.id !== st.id);
                })} />
              <span>{st.name}</span>
              <span className="faint mono" style={{ marginLeft: "auto", fontSize: 11 }}>{st.lat_deg.toFixed(2)}°, {st.lon_deg.toFixed(2)}°</span>
            </label>
            {cur && (
              <div style={{ paddingLeft: 22 }}>
                <NumField label="Min elevation" value={cur.min_elevation_deg} min={0} max={45} unit="°"
                  onChange={(v) => edit((s) => { s.ground_stations.find((g) => g.id === st.id)!.min_elevation_deg = v; })} />
                <NumField label="Downlink" value={cur.downlink_gbps} min={0.01} max={100} step={0.1} unit="Gbps"
                  onChange={(v) => edit((s) => { s.ground_stations.find((g) => g.id === st.id)!.downlink_gbps = v; })} />
              </div>
            )}
          </div>
        );
      })}
      {draft.ground_stations.filter((g) => !catalog.ground_stations.some((c) => c.id === g.id)).map((g) => (
        <div key={g.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0" }}>
          <span>{g.name}</span><Badge kind="USER" />
          <span className="faint mono" style={{ fontSize: 11 }}>{g.lat_deg}°, {g.lon_deg}°</span>
          <button className="btn sm ghost" style={{ marginLeft: "auto" }} onClick={() => edit((s) => { s.ground_stations = s.ground_stations.filter((x) => x.id !== g.id); })}>Remove</button>
        </div>
      ))}
      <div className="group-h">Add custom station <Badge kind="USER" /></div>
      <div className="field"><label>Name</label><div className="ctl"><input type="text" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} /></div></div>
      <NumField label="Latitude" value={custom.lat} min={-90} max={90} step={0.01} unit="°" onChange={(v) => setCustom({ ...custom, lat: v })} />
      <NumField label="Longitude" value={custom.lon} min={-180} max={180} step={0.01} unit="°" onChange={(v) => setCustom({ ...custom, lon: v })} />
      <button className="btn sm" disabled={!custom.name}
        onClick={() => edit((s) => {
          s.ground_stations.push({ id: `user-${Date.now().toString(36)}`, name: custom.name, lat_deg: custom.lat, lon_deg: custom.lon, alt_m: 0,
            min_elevation_deg: 10, downlink_gbps: 2, uplink_gbps: 0.5, provenance: "USER (illustrative)" });
        })}>Add station</button>
    </div>
  );
}

function Simulation({ draft, edit }: { draft: Scenario; edit: (fn: (s: Scenario) => void) => void }) {
  const cur = SCHEDULERS.find((s) => s.value === draft.sim.scheduler)!;
  return (
    <div data-testid="simulation-editor">
      <div className="field"><label>Scenario name</label><div className="ctl"><input type="text" value={draft.name} onChange={(e) => edit((s) => { s.name = e.target.value; s.preset_id = null; })} /></div></div>
      <div className="field"><label>Epoch (UTC)<small>ISO-8601</small></label><div className="ctl"><input type="text" value={draft.sim.epoch_utc} onChange={(e) => edit((s) => { s.sim.epoch_utc = e.target.value; })} /></div></div>
      <NumField label="Duration" value={draft.sim.duration_s / 3600} min={1} max={72} step={1} unit="h" slider onChange={(v) => edit((s) => { s.sim.duration_s = v * 3600; })} />
      <NumField label="Time step" hint="engine sample interval" value={draft.sim.step_s} min={5} max={300} step={5} unit="s" onChange={(v) => edit((s) => { s.sim.step_s = v; })} />
      <SelectField label="Scheduler" value={draft.sim.scheduler} options={SCHEDULERS} testId="scheduler-select" onChange={(v) => edit((s) => { s.sim.scheduler = v; })} />
      <p className="note">{cur.hint}</p>
      <p className="note">Samples per node: {Math.floor(draft.sim.duration_s / draft.sim.step_s)} (max 6000). Results are deterministic and cached by scenario hash.</p>
    </div>
  );
}

export default function DesignDrawer() {
  const draft = useScenario((s) => s.draft);
  const edit = useScenario((s) => s.edit);
  const run = useScenario((s) => s.run);
  const dirty = useScenario((s) => s.dirty);
  const status = useScenario((s) => s.status);
  const sel = useUi((s) => s.selectedNode);
  const setUi = useUi((s) => s.set);
  const preview = useUi((s) => s.preview);
  const [tab, setTab] = useState<Tab>(() => useUi.getState().designTab);
  const [nodeIdx, setNodeIdx] = useState(sel);
  const [saved, setSaved] = useState<string | null>(null);
  const idx = Math.min(nodeIdx, (draft?.nodes.length ?? 1) - 1);
  const node = draft?.nodes[idx];
  const editNode = useMemo(() => (fn: (n: NodeConfig) => void) => edit((s) => fn(s.nodes[idx])), [edit, idx]);
  useEffect(() => () => setUi({ preview: null }), [setUi]);
  if (!draft || !node) return null;
  const eclipseFrac = preview?.nodeIndex === idx ? preview.data.eclipse_fraction : 0.37;

  const addNode = () => edit((s) => {
    if (s.nodes.length >= 12) return;
    const base = structuredClone(s.nodes[idx]);
    let k = s.nodes.length + 1;
    while (s.nodes.some((n) => n.id === `OC-${String(k).padStart(2, "0")}`)) k++;
    base.id = base.name = `OC-${String(k).padStart(2, "0")}`;
    base.orbit.mean_anomaly_deg = (base.orbit.mean_anomaly_deg + 60) % 360;
    s.nodes.push(base);
  });
  const removeNode = () => edit((s) => { if (s.nodes.length > 1) s.nodes.splice(idx, 1); });

  return (
    <div className="overlay">
      <aside className="drawer" data-testid="design-drawer" data-tutorial="design-drawer" aria-label="Design">
        <div className="drawer-h">
          <h2>Design</h2>
          <Badge kind={draft.provenance} />
          <span className="spacer" />
          <button className="btn sm ghost" onClick={() => setUi({ overlay: null })} aria-label="Close design">✕</button>
        </div>
        <div style={{ padding: "8px 16px 0" }}>
          <div className="nodechips">
            {draft.nodes.map((n, i) => (
              <button key={n.id} className={`chip${i === idx ? " on" : ""}`} onClick={() => setNodeIdx(i)}>{n.name}</button>
            ))}
            <button className="chip" onClick={addNode} disabled={draft.nodes.length >= 12} data-testid="add-node" title="Duplicate this node (max 12)">+ node</button>
            {draft.nodes.length > 1 && <button className="chip" onClick={removeNode}>remove {node.name}</button>}
          </div>
        </div>
        <div className="subtabs">
          {(["orbit", "hardware", "workload", "ground", "simulation"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)} data-testid={`design-tab-${t}`}>{t}</button>
          ))}
        </div>
        <div className="drawer-b">
          {tab === "orbit" && <Orbit node={node} i={idx} edit={editNode} epoch={draft.sim.epoch_utc} />}
          {tab === "hardware" && <Hardware node={node} edit={editNode} eclipseFrac={eclipseFrac} />}
          {tab === "workload" && <Workload draft={draft} edit={edit} />}
          {tab === "ground" && <Ground draft={draft} edit={edit} />}
          {tab === "simulation" && <Simulation draft={draft} edit={edit} />}
        </div>
        <div className="drawer-f">
          <button className="btn primary" onClick={() => run()} disabled={status === "running"} data-testid="run-sim">
            {status === "running" ? <><span className="spinner" /> Running…</> : "Run simulation"}
          </button>
          <span className="muted" style={{ fontSize: 11 }}>{dirty ? "Edits not yet simulated" : "Result is up to date"}</span>
          <span className="spacer" />
          {saved && <span className="faint" style={{ fontSize: 11 }}>{saved}</span>}
          <button className="btn sm" onClick={() => api.saveScenario(draft).then((r) => setSaved(`saved · ${r.id}`)).catch((e) => setSaved((e as Error).message))}>Save</button>
        </div>
      </aside>
    </div>
  );
}
