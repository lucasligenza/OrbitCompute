import type { Provenance } from "@/sim/types";

const TITLES: Record<Provenance, string> = {
  REAL: "Real observation or sourced data",
  PHYSICS: "Calculated from established physical relations",
  MODEL: "Simplified engineering model — see docs/SCIENCE.md",
  USER: "User-configured assumption",
  PRESET: "Illustrative preset — not a real spacecraft or product",
  PREVIEW: "Quick preview estimate — not a simulation result",
};

export function Badge({ kind, text }: { kind: Provenance; text?: string }) {
  return (
    <span className={`badge ${kind}`} title={TITLES[kind]}>
      {text ?? kind}
    </span>
  );
}

export function StatusDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="status">
      <i style={{ background: color }} />
      {label}
    </span>
  );
}
