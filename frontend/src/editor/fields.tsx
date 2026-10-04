"use client";
import { useState } from "react";

interface NumProps {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  slider?: boolean;
  scale?: number; // display = value * scale (e.g. fractions as %)
  testId?: string;
}

export function NumField({ label, hint, value, onChange, min, max, step = 1, unit, slider, scale = 1, testId }: NumProps) {
  const shown = +(value * scale).toFixed(6);
  // Local text only while the user is typing; otherwise display the committed value.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? String(shown);
  const commit = (s: string) => {
    setDraft(null);
    const v = Number(s);
    if (!isFinite(v) || s.trim() === "") return;
    let x = v;
    if (min !== undefined) x = Math.max(min, x);
    if (max !== undefined) x = Math.min(max, x);
    onChange(x / scale);
  };
  return (
    <div className="field">
      <label>{label}{hint && <small>{hint}</small>}</label>
      <div className="ctl" style={slider ? { flexDirection: "column", alignItems: "stretch", gap: 2 } : undefined}>
        {slider && (
          <input type="range" min={min} max={max} step={step} value={shown} aria-label={label}
            onChange={(e) => onChange(Number(e.target.value) / scale)} />
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="number" value={text} min={min} max={max} step={step} aria-label={label} data-testid={testId}
            onChange={(e) => setDraft(e.target.value)} onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commit((e.target as HTMLInputElement).value)} />
          {unit && <span className="unit">{unit}</span>}
        </div>
      </div>
    </div>
  );
}

export function BoolField({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="field">
      <label>{label}{hint && <small>{hint}</small>}</label>
      <div className="ctl"><input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} aria-label={label} /></div>
    </div>
  );
}

export function SelectField<T extends string>({ label, hint, value, options, onChange, testId }: {
  label: string; hint?: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; testId?: string;
}) {
  return (
    <div className="field">
      <label>{label}{hint && <small>{hint}</small>}</label>
      <div className="ctl">
        <select value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={label} data-testid={testId}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    </div>
  );
}
