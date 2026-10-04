import type { Catalog, OrbitConfig, OrbitPreview, Scenario, SimResultRaw } from "./types";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!r.ok) {
    let detail = `${r.status} ${r.statusText}`;
    try {
      const j = await r.json();
      detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j).slice(0, 400);
    } catch {
      /* non-JSON error */
    }
    throw new Error(detail);
  }
  return r.json() as Promise<T>;
}

export const api = {
  catalog: () => req<Catalog>("/api/catalog"),
  preset: (id: string) => req<Scenario>(`/api/presets/${id}`),
  simulate: (s: Scenario) => req<SimResultRaw>("/api/simulate", { method: "POST", body: JSON.stringify(s) }),
  preview: (orbit: OrbitConfig, epoch_utc: string, min_elevation_deg = 10) =>
    req<OrbitPreview>("/api/orbit/preview", { method: "POST", body: JSON.stringify({ orbit, epoch_utc, min_elevation_deg }) }),
  saveScenario: (s: Scenario) => req<{ id: string }>("/api/scenarios", { method: "POST", body: JSON.stringify(s) }),
  listScenarios: () => req<{ id: string; name: string; updated_at: string }[]>("/api/scenarios"),
  getScenario: (id: string) => req<Scenario>(`/api/scenarios/${id}`),
};
