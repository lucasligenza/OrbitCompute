export function fmtKw(kw: number, digits?: number): string {
  const a = Math.abs(kw);
  if (a >= 1000) return `${(kw / 1000).toFixed(digits ?? 2)} MW`;
  if (a >= 100) return `${kw.toFixed(digits ?? 0)} kW`;
  return `${kw.toFixed(digits ?? 1)} kW`;
}

export function fmtKwh(kwh: number): string {
  return Math.abs(kwh) >= 1000 ? `${(kwh / 1000).toFixed(2)} MWh` : `${kwh.toFixed(kwh < 100 ? 1 : 0)} kWh`;
}

export function fmtPct(x: number, digits = 0): string {
  return `${(x * 100).toFixed(digits)}%`;
}

export function fmtC(c: number): string {
  return `${c.toFixed(1)} °C`;
}

export function fmtGbps(g: number): string {
  return g >= 1 ? `${g.toFixed(1)} Gbps` : `${(g * 1000).toFixed(0)} Mbps`;
}

export function fmtGbit(g: number): string {
  if (g >= 8000) return `${(g / 8000).toFixed(2)} TB`;
  if (g >= 8) return `${(g / 8).toFixed(1)} GB`;
  return `${(g * 125).toFixed(0)} MB`;
}

/** mm:ss or h:mm:ss */
export function fmtDur(s: number): string {
  if (!isFinite(s)) return "—";
  const sign = s < 0 ? "−" : "";
  s = Math.abs(Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (x: number) => String(x).padStart(2, "0");
  return h > 0 ? `${sign}${h}:${p(m)}:${p(ss)}` : `${sign}${p(m)}:${p(ss)}`;
}

export function fmtHours(s: number): string {
  if (s < 3600) return `${(s / 60).toFixed(0)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

export function fmtUtc(epochMs: number, t: number): string {
  const d = new Date(epochMs + t * 1000);
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export function fmtMet(t: number): string {
  return `T+${fmtDur(t)}`;
}
