import { Icon, type IconName } from "./Icon";
import Sparkline from "./Sparkline";

interface Props {
  icon?: IconName;
  label: string;
  value: string;
  unit?: string;
  status?: { text: string; color: string };
  spark?: { data: ArrayLike<number>; dt: number; duration: number; color: string; min?: number; max?: number };
  accent?: string;
}

/** Raised card with label, large value, optional status chip and whole-horizon sparkline. */
export default function KpiTile({ icon, label, value, unit, status, spark, accent }: Props) {
  return (
    <div className="kpi card raised">
      <div className="kpi-h">
        {icon && <Icon name={icon} size={13} color={accent ?? "var(--muted)"} />}
        <span>{label}</span>
        {status && <span className="chip-s" style={{ color: status.color, borderColor: status.color }}>{status.text}</span>}
      </div>
      <div className="kpi-v mono">{value}{unit && <small> {unit}</small>}</div>
      {spark && <Sparkline {...spark} />}
    </div>
  );
}

export function Insight({ text, tone = "var(--accent)" }: { text?: string; tone?: string }) {
  if (!text) return null;
  return (
    <div className="insight" style={{ borderLeftColor: tone }}>
      <Icon name="layers" size={13} color={tone} />
      <span>{text}</span>
    </div>
  );
}

export function SectionTitle({ icon, children, right }: { icon?: IconName; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="sect">
      {icon && <Icon name={icon} size={13} color="var(--muted)" />}
      <span>{children}</span>
      {right && <span className="sect-r">{right}</span>}
    </div>
  );
}
