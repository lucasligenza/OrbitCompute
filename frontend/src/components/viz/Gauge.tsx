// 270° arc gauge. Value always shown as text; colour is never the only cue.
interface Props {
  value: number; // 0..1
  display: string;
  label: string;
  sub?: string;
  color: string;
  ticks?: { at: number; color: string; label?: string }[];
  size?: number;
  testId?: string;
}

const START = 135; // degrees, measured clockwise from +x (SVG)
const SWEEP = 270;

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arcPath(cx: number, cy: number, r: number, f0: number, f1: number) {
  const a0 = START + SWEEP * f0, a1 = START + SWEEP * f1;
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export default function Gauge({ value, display, label, sub, color, ticks, size = 92, testId }: Props) {
  const v = Math.min(Math.max(value, 0), 1);
  const c = 50, r = 38;
  const gid = `g${label.replace(/\W/g, "")}`;
  return (
    <div className="gauge" style={{ width: size }} data-testid={testId}>
      <svg viewBox="0 0 100 92" width={size} height={size * 0.92} role="img" aria-label={`${label}: ${display}`}>
        <defs>
          <linearGradient id={gid} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor={color} stopOpacity="0.55" />
            <stop offset="1" stopColor={color} />
          </linearGradient>
          <filter id={`${gid}f`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2" /></filter>
        </defs>
        <path d={arcPath(c, c, r, 0, 1)} stroke="rgba(148,163,184,0.16)" strokeWidth="7" fill="none" strokeLinecap="round" />
        {v > 0.002 && (
          <>
            <path d={arcPath(c, c, r, 0, v)} stroke={color} strokeWidth="7" fill="none" strokeLinecap="round" opacity="0.35" filter={`url(#${gid}f)`} />
            <path d={arcPath(c, c, r, 0, v)} stroke={`url(#${gid})`} strokeWidth="7" fill="none" strokeLinecap="round" />
          </>
        )}
        {ticks?.map((t, i) => {
          const [x0, y0] = polar(c, c, r - 6, START + SWEEP * t.at);
          const [x1, y1] = polar(c, c, r + 6, START + SWEEP * t.at);
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke={t.color} strokeWidth="1.6" />;
        })}
        <text x="50" y="50" textAnchor="middle" className="gauge-val">{display}</text>
        {sub && <text x="50" y="64" textAnchor="middle" className="gauge-sub">{sub}</text>}
      </svg>
      <div className="gauge-label">{label}</div>
    </div>
  );
}
