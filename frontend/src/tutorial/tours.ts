// Guided tours. The quick tour explains the interface; the deep dive walks through every aspect of
// an orbital data center, driving the simulation and quoting numbers from the result on screen.
import { fmtDur, fmtKw, fmtPct } from "@/sim/format";
import type { PreparedNode, PreparedResult } from "@/sim/result";
import { sampleNode, type NodeSample } from "@/sim/sample";
import type { Metrics, NodeConfig } from "@/sim/types";
import { useUi } from "@/state/ui";
import { act } from "./actions";

export interface TourCtx { res: PreparedResult; nd: PreparedNode; cfg: NodeConfig; s: NodeSample; m: Metrics; run: Metrics; t: number }

export interface TourStep {
  chapter?: string;
  title: string;
  /** data-tutorial anchor to highlight ("" = none, card sits at the bottom) */
  target: string;
  body: string[] | ((c: TourCtx) => string[]);
  /** optional hands-on suggestion */
  tryIt?: string;
  setup?: () => Promise<void> | void;
}

export function tourCtx(res: PreparedResult, t: number): TourCtx {
  const ui = useUi.getState();
  const nd = res.nodes[Math.min(ui.selectedNode, res.nodes.length - 1)];
  return { res, nd, cfg: res.raw.scenario.nodes[nd.index], s: sampleNode(res, nd, t), m: nd.raw.metrics, run: res.raw.metrics, t };
}

const eclFrac = (c: TourCtx) => c.nd.raw.eclipse_windows.reduce((a, [x, y]) => a + (y - x), 0) / c.res.duration;
const longestEcl = (c: TourCtx) => Math.max(0, ...c.nd.raw.eclipse_windows.map(([a, b]) => b - a));
const period = (c: TourCtx) => Number(c.nd.raw.orbit.period_s);
const num = (c: TourCtx, k: string) => Number(c.res.raw.nodes[c.nd.index].derived[k]);
const passMinutes = (c: TourCtx) => {
  const w = c.nd.raw.contact_windows;
  return w.length ? w.reduce((a, [, x, y]) => a + (y - x), 0) / w.length / 60 : 0;
};

// --------------------------------------------------------------------------------------------
// Quick tour: the interface in ~2 minutes
// --------------------------------------------------------------------------------------------
export const QUICK: TourStep[] = [
  { target: "scene", title: "Welcome to OrbitCompute", setup: () => act.mode("orbit"), body: [
    "This is a hypothetical AI compute spacecraft orbiting Earth. Everything comes from a deterministic engine: orbital mechanics, sunlight, power, heat, workloads and communications.",
    "Drag to rotate, scroll to zoom, double-click a spacecraft to follow it.",
  ] },
  { target: "modes", title: "Visualization modes", body: ["The same scene re-encodes for Orbit, Power, Thermal, Compute, Network and System (keys 1–6)."] },
  { target: "scrubber", title: "Time", body: [
    "Purple bands are eclipses, green bands ground contacts. Press play or drag the timeline. Scrubbing backward restores the exact state.",
  ] },
  { target: "detail", title: "Detail panel", setup: () => { act.mode("power"); act.panels(); }, body: [
    "Each mode has a detail panel. Simple shows the essentials; Advanced adds every chart, table and model note.",
  ] },
  { target: "explain", title: "What is happening now", setup: () => act.right("now"), body: ["A plain explanation of the selected spacecraft at this instant, with the reason behind it."] },
  { target: "feed", title: "Mission feed", setup: () => act.right("feed"), body: ["Every event across all spacecraft in plain language. Click an entry to jump there."] },
  { target: "design", title: "Design", setup: () => act.right("now"), body: ["Change orbit, hardware, workloads, ground stations and the scheduler, then run the simulation again."] },
  { target: "compare", title: "Compare", body: ["Compare two designs, or one design under two schedulers, with synchronized timelines. Reopen tours any time with the ? button."] },
];

// --------------------------------------------------------------------------------------------
// Deep dive: how a space data center works (~10 min)
// --------------------------------------------------------------------------------------------
export const DEEP: TourStep[] = [
  // 1 ── The idea
  { chapter: "The idea", target: "", title: "A data center in orbit",
    setup: async () => { act.overlay(null); await act.preset("leo-inference"); act.mode("orbit"); act.detail("simple"); act.panels(); act.right("now"); act.seekFrac(0.02); },
    body: (c) => [
      `Meet ${c.nd.name}: a hypothetical spacecraft carrying ${c.cfg.compute.accelerator_count} AI accelerators that can draw up to ${fmtKw(num(c, "compute_max_kw"))}.`,
      "The pitch for orbital compute: abundant sunlight, no land, no water for cooling. The catch: it orbits in and out of Earth's shadow, can only shed heat by radiation, and talks to the ground only when a station or relay can see it.",
      "This tour walks through each of those, using the simulation you are looking at.",
    ] },
  { chapter: "The idea", target: "scene", title: "Reading the scene",
    body: [
      "The bright blue trail is where the spacecraft has been, the faint line where it is going. The amber line on the globe is its ground track, and the translucent circle under it is the area of Earth that can see it.",
      "Its label shows the value for the current mode. Rings around the spacecraft show battery, utilization or temperature in the matching modes.",
    ], tryIt: "Double-click the spacecraft to fly in and follow it; press Reset view to come back." },

  // 2 ── Orbit
  { chapter: "Orbit", target: "detail", title: "One lap every hour and a half",
    setup: () => { act.mode("orbit"); act.detail("simple"); },
    body: (c) => [
      `At ${c.s.alt.toFixed(0)} km it moves at about 7.6 km/s and circles Earth every ${(period(c) / 60).toFixed(1)} minutes: ${(86400 / period(c)).toFixed(1)} orbits a day.`,
      `The orbit is tilted ${Number(c.nd.raw.orbit.inclination_deg).toFixed(0)}° to the equator, so the ground track sweeps between ${Number(c.nd.raw.orbit.inclination_deg).toFixed(0)}°N and ${Number(c.nd.raw.orbit.inclination_deg).toFixed(0)}°S while Earth turns underneath.`,
      "The map shows the track in sunlight (amber) and in shadow (violet).",
    ] },
  { chapter: "Orbit", target: "scrubber", title: "Time is yours",
    setup: () => act.play(100),
    body: [
      "The simulation is playing at 100× real time. Every frame is read from a pre-computed, deterministic result, so you can pause, scrub backward or jump anywhere and always see the same state.",
    ], tryIt: "Try 1000× to watch several orbits go by." },

  // 3 ── Sunlight and shadow
  { chapter: "Sunlight and shadow", target: "", title: "Watch it enter Earth's shadow",
    setup: () => { act.pause(); act.mode("power"); act.detail("simple"); if (act.seekEvent("eclipse_enter", { offset: -150 })) act.play(10); },
    body: (c) => [
      "Playing at 10×: watch the spacecraft slide into the dark cone behind Earth. The arrays go dark and the label changes to 'eclipse'.",
      `On this orbit it spends ${fmtPct(eclFrac(c))} of the time in shadow, up to ${fmtDur(longestEcl(c))} at a stretch. Shadow is computed from Sun–Earth geometry, including the brief penumbra.`,
    ] },
  { chapter: "Sunlight and shadow", target: "detail", title: "The battery takes over",
    setup: () => { act.pause(); act.seekEvent("eclipse_enter", { offset: 240 }); },
    body: (c) => [
      `Solar generation is now ${fmtKw(c.s.pGen)}. Every load — ${fmtKw(c.s.pCompute)} of compute, ${fmtKw(c.s.pPlatform + c.s.pThermal + c.s.pHeater)} of platform and thermal control, ${fmtKw(c.s.pComms)} of comms — comes from the battery (${fmtPct(c.s.soc)} charged).`,
      "In the flow diagram, ribbon width is proportional to power: follow it from the battery through the bus to each load.",
    ] },
  { chapter: "Sunlight and shadow", target: "", title: "An orbit with no night",
    setup: async () => { await act.preset("sso-batch"); act.mode("power"); act.seekFrac(0.3); },
    body: (c) => [
      `This is a dawn–dusk sun-synchronous orbit: it rides the boundary between day and night, so its orbit plane barely meets Earth's shadow. In this season it is in sunlight ${fmtPct(1 - eclFrac(c))} of the time.`,
      "That allows a much smaller battery. The trade-off: it passes over the poles, so it depends on high-latitude ground stations.",
    ] },

  // 4 ── Power and batteries
  { chapter: "Power and batteries", target: "detail", title: "When power runs short",
    setup: async () => {
      await act.preset("power-constrained-training"); act.mode("power"); act.detail("advanced");
      if (!act.seekEvent("power_short_start", { offset: 60 })) act.seekEvent("soc_reserve", { offset: 60 });
    },
    body: (c) => [
      `This design asks for more than its arrays can give: ${fmtKw(num(c, "compute_max_kw"))} of compute against ${fmtKw(num(c, "rated_solar_kw"))} of rated solar, before losing a third of every orbit to shadow.`,
      `The power system protects the spacecraft: compute is slowed or shed first, and at the ${fmtPct(c.cfg.battery.min_soc)} battery reserve it is switched off so essential systems keep running. In this run compute was power-limited for ${fmtDur(c.m.power_limited_time_s)}.`,
    ] },
  { chapter: "Power and batteries", target: "detail", title: "Too much sun can be wasted too",
    setup: async () => { await act.preset("leo-inference"); act.mode("power"); act.detail("advanced"); act.seekFrac(0.31); },
    body: (c) => [
      `Back on the inference node: once the battery is full and the loads are covered, extra solar power has nowhere to go. ${c.nd.name} curtailed ${c.m.curtailed_kwh.toFixed(0)} kWh over this run.`,
      "Sizing an orbital data center is a balance: arrays big enough for orbit-average demand, a battery big enough for the longest eclipse, and loads that can soak up surplus sunlight.",
    ] },

  // 5 ── Compute and workloads
  { chapter: "Compute and workloads", target: "detail", title: "Racks of accelerators",
    setup: () => { act.mode("compute"); act.detail("simple"); act.seekFrac(0.5); act.selectBusiestJob(); },
    body: (c) => [
      `Each cell is an accelerator, coloured by the job using it. ${fmtPct(c.s.util)} of them are busy right now, running ${c.s.nRunning} jobs.`,
      "There are four kinds of work: inference sessions (blue, urgent, often realtime), training runs (violet, wide and long), batch jobs (teal, with data to upload and download) and background work (grey).",
    ] },
  { chapter: "Compute and workloads", target: "detail", title: "Following one job",
    body: [
      "The inspector shows the selected job's lifecycle: uploading its input (violet), computing (blue; hatched when stalled), downloading the result (green), with its deadline in red.",
      "Realtime jobs need a live communication link to make progress. Without one they hold accelerators but stall.",
    ], tryIt: "Click any coloured cell to inspect a different job." },

  // 6 ── Getting rid of heat
  { chapter: "Getting rid of heat", target: "detail", title: "In space, heat can only radiate away",
    setup: async () => {
      useUi.getState().selectJob(null);
      await act.preset("large-training"); act.mode("thermal"); act.detail("simple");
      act.seekEvent("throttle_start", { offset: -600 });
    },
    body: (c) => [
      `There is no air to carry heat off. Everything the electronics dissipate — ${fmtKw(c.s.qDiss)} right now — must leave as infrared from ${c.cfg.thermal.radiator_area_m2.toFixed(0)} m² of radiators. Radiated power grows with the fourth power of temperature (P = εσAT⁴).`,
      `This megawatt-class platform has a deliberately marginal radiator. Its equipment is at ${c.s.tEquip.toFixed(0)} °C with ${(c.cfg.thermal.throttle_c - c.s.tEquip).toFixed(0)} K left before throttling.`,
    ] },
  { chapter: "Getting rid of heat", target: "", title: "Throttling",
    setup: () => { act.seekEvent("throttle_start", { offset: -60 }); act.play(10); },
    body: (c) => [
      "Playing at 10× across the throttle point: when the equipment passes its threshold, clocks are reduced. Less heat is generated, but every job slows down.",
      `In this run the platform spent ${fmtDur(c.m.throttled_time_s)} throttled. More radiator area or the thermal-aware scheduler avoids it, at a cost.`,
    ] },
  { chapter: "Getting rid of heat", target: "detail", title: "An honest thermal model",
    setup: () => { act.pause(); act.detail("advanced"); },
    body: [
      "The thermal panel uses a simplified two-node model: equipment coupled to a radiator, with Earth's infrared absorbed through a view factor. It captures the essential behaviour, not a full spacecraft thermal analysis. The panel says so, and so does every result.",
    ] },

  // 7 ── Talking to the ground
  { chapter: "Talking to the ground", target: "detail", title: "Brief windows of contact",
    setup: async () => { await act.preset("iss-reference"); act.mode("network"); act.detail("advanced"); act.seekEvent("aos", { offset: 60 }); },
    body: (c) => [
      `This hypothetical node flies the real orbit of the ISS (from a CelesTrak orbit snapshot). A ground station can only talk to it while it is above the station's horizon mask: typically ${passMinutes(c).toFixed(0)} minutes per pass.`,
      `Across eight stations it has a direct link only ${fmtPct(c.m.direct_contact_fraction)} of the time. The sky plot shows the current pass as the station sees it.`,
    ] },
  { chapter: "Talking to the ground", target: "", title: "People on Earth",
    setup: () => { act.detail("simple"); act.seekEvent("aos", { nth: 2, offset: 120 }); act.play(1); },
    body: [
      "Watch the packets: requests from people in nearby cities (cyan) travel to the ground station and up to the spacecraft; results (green) come back down. Packet density follows the simulated data rates and live sessions.",
      "Which cities and the ground network between them are illustrative; the link timing and volumes are simulated.",
    ] },
  { chapter: "Talking to the ground", target: "", title: "When the link drops",
    setup: () => { act.pause(); act.seekEvent("los", { nth: 2, offset: 120 }); },
    body: (c) => [
      "Now the station has lost sight of the spacecraft. Requests pile up at the station in amber: those users are waiting.",
      `${c.s.nStalled > 0 ? `${c.s.nStalled} realtime session${c.s.nStalled === 1 ? " is" : "s are"} stalled on board. ` : ""}This is why intermittent ground contact limits what orbital compute can serve.`,
    ] },
  { chapter: "Talking to the ground", target: "detail", title: "Relays fill the gaps",
    setup: async () => { await act.preset("leo-inference"); act.mode("network"); act.detail("simple"); act.seekFrac(0.3); },
    body: (c) => [
      `With (illustrative) geostationary relay satellites, ${c.nd.name} stays connected ${fmtPct(c.m.network_availability)} of the time. The price is latency: every packet travels about 75,000 km through geostationary orbit (${c.s.latencyMs.toFixed(0)} ms).`,
    ] },

  // 8 ── Scheduling
  { chapter: "Scheduling", target: "compare", title: "Who runs when?",
    setup: async () => { await act.preset("power-constrained-training"); act.compare({ source: "current", scheduler: "fifo" }, { source: "current", scheduler: "energy" }); },
    body: [
      "A scheduler decides which jobs get accelerators every step. This comparison runs the same power-starved satellite twice: first-come-first-served (A) against an energy-aware scheduler (B), which only runs low-priority work when there is spare solar power or battery.",
    ] },
  { chapter: "Scheduling", target: "cmp-table", title: "Reading the trade-off",
    body: [
      "Look at power-limited time, minimum battery charge and completed workloads. The energy-aware scheduler avoids power shortages and keeps the battery above its reserve, but finishes fewer jobs. There is no free lunch, only trade-offs you can now measure.",
    ], tryIt: "Change the schedulers in the dropdowns and run again." },

  // 9 ── Constellations
  { chapter: "Constellations", target: "", title: "Many smaller spacecraft",
    setup: async () => { act.overlay(null); await act.preset("distributed-inference"); act.mode("network"); act.selectNode(1); act.seekFrac(0.35); },
    body: (c) => [
      `Instead of one big spacecraft, this design uses ${c.res.nodes.length} smaller ones in three orbit planes, flying in pairs. One spacecraft in each pair has a relay terminal; its partner reaches the ground through an inter-satellite link.`,
      "Spreading out improves coverage and resilience, at the cost of duplicated hardware on every spacecraft.",
    ] },
  { chapter: "Constellations", target: "feed", title: "Keeping track of everything",
    setup: () => act.right("feed"),
    body: [
      "With many spacecraft, the Mission feed collects every important event (eclipses, power shortages, overheating, links, missed deadlines) in one plain-language timeline, with what comes next at the top.",
    ] },

  // 10 ── Design your own
  { chapter: "Design your own", target: "design-drawer", title: "Change anything",
    setup: async () => { act.right("now"); await act.preset("leo-inference"); act.design("hardware"); },
    body: [
      "The design drawer lets you change the orbit, accelerators, solar arrays, battery, radiators, communications, workloads, ground stations and scheduler. The schematic and quick sizing estimates update as you type; press Run simulation for the real answer.",
    ], tryIt: "Halve the radiator area, run, then look at Thermal mode." },
  { chapter: "Design your own", target: "", title: "What we learned",
    setup: () => act.overlay(null),
    body: [
      "Orbital compute trades terrestrial constraints for new ones: shadow dictates batteries, radiation-only cooling dictates radiator area, and intermittent links dictate what work can run and when.",
      "Every number here comes from the simulation, which is a simplified engineering model, not a spacecraft design. Explore freely: the ? button reopens the tours any time.",
    ] },
];

export const TOURS = { quick: QUICK, deep: DEEP } as const;

export function chapters(steps: TourStep[]) {
  const out: { name: string; first: number }[] = [];
  steps.forEach((s, i) => { if (s.chapter && out[out.length - 1]?.name !== s.chapter) out.push({ name: s.chapter, first: i }); });
  return out;
}
