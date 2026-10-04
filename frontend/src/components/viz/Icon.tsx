// Minimal inline SVG icon set (16×16, stroke-based). No icon dependency.
export type IconName =
  | "sun" | "moon" | "battery" | "bolt" | "chip" | "thermo" | "radiator" | "antenna" | "satellite" | "clock"
  | "warning" | "globe" | "link" | "queue" | "check" | "down" | "up" | "relay" | "layers" | "orbit" | "flame";

const P: Record<IconName, React.ReactNode> = {
  sun: <><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3" /></>,
  moon: <path d="M12.5 10.2A5.2 5.2 0 0 1 5.8 3.5a5.2 5.2 0 1 0 6.7 6.7z" />,
  battery: <><rect x="1.5" y="4.5" width="11.5" height="7" rx="1.2" /><path d="M14.5 7v2" /><path d="M3.5 6.5h4v3h-4z" fill="currentColor" stroke="none" /></>,
  bolt: <path d="M9 1.5L3.5 9h4L6.5 14.5 12.5 7h-4z" />,
  chip: <><rect x="4" y="4" width="8" height="8" rx="1" /><path d="M6 1.5v2.5M10 1.5v2.5M6 12v2.5M10 12v2.5M1.5 6h2.5M1.5 10h2.5M12 6h2.5M12 10h2.5" /></>,
  thermo: <><path d="M6.5 9.5V3a1.5 1.5 0 0 1 3 0v6.5a3 3 0 1 1-3 0z" /><circle cx="8" cy="11.8" r="1.2" fill="currentColor" stroke="none" /></>,
  radiator: <><path d="M2 3h12M2 13h12" /><path d="M4 3v10M7 3v10M10 3v10M13 3v10" /></>,
  antenna: <><path d="M3 4.5a7 7 0 0 1 10 0M5.2 6.8a4 4 0 0 1 5.6 0" /><circle cx="8" cy="9" r="1" /><path d="M8 10v4.5M5.5 14.5h5" /></>,
  satellite: <><rect x="6" y="6" width="4" height="4" rx="0.6" /><path d="M1.5 4.5l3 3M11.5 11.5l3 3M2 2h3v3H2zM11 11h3v3h-3z" /></>,
  clock: <><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></>,
  warning: <><path d="M8 2l6.5 11.5h-13z" /><path d="M8 6.5v3.5M8 11.8v.2" /></>,
  globe: <><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" /></>,
  link: <><path d="M6.5 9.5l3-3" /><path d="M7 4.5l1.3-1.3a2.5 2.5 0 0 1 3.5 3.5L10.5 8M9 11.5l-1.3 1.3a2.5 2.5 0 0 1-3.5-3.5L5.5 8" /></>,
  queue: <><path d="M2.5 4h11M2.5 8h11M2.5 12h7" /></>,
  check: <path d="M3 8.5l3 3 7-7" />,
  down: <path d="M8 2.5v11M4 9.5l4 4 4-4" />,
  up: <path d="M8 13.5v-11M4 6.5l4-4 4 4" />,
  relay: <><circle cx="8" cy="4" r="1.6" /><path d="M8 5.6V9M3 14l5-5 5 5" /></>,
  layers: <><path d="M8 2l6 3-6 3-6-3z" /><path d="M2 8l6 3 6-3M2 11l6 3 6-3" /></>,
  orbit: <><ellipse cx="8" cy="8" rx="6.5" ry="3" transform="rotate(-25 8 8)" /><circle cx="8" cy="8" r="2" /></>,
  flame: <path d="M8 1.5c1 2.5 4 4 4 7.5a4 4 0 0 1-8 0c0-1.8 1-3 2-4 0 1.5.8 2.3 1.5 2.5C7 5.5 7.5 3.5 8 1.5z" />,
};

export function Icon({ name, size = 14, color, title, x, y }: { name: IconName; size?: number; color?: string; title?: string; x?: number; y?: number }) {
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color ?? "currentColor"} strokeWidth={1.4}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}
      style={{ flex: "none" }}>
      {title && <title>{title}</title>}
      {P[name]}
    </svg>
  );
}
