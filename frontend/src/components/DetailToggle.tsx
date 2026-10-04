"use client";
import { useUi } from "@/state/ui";

/** Simple / Advanced switch shared by the detail and explanation panels. */
export default function DetailToggle({ testPrefix = "detail" }: { testPrefix?: string }) {
  const detail = useUi((s) => s.detail);
  const setDetail = useUi((s) => s.setDetail);
  return (
    <div className="seg" role="group" aria-label="Detail level" title="Simple shows the essentials; Advanced shows every chart, table and model note">
      {(["simple", "advanced"] as const).map((d) => (
        <button key={d} className={detail === d ? "on" : ""} onClick={() => setDetail(d)} aria-pressed={detail === d} data-testid={`${testPrefix}-${d}`}>
          {d}
        </button>
      ))}
    </div>
  );
}

/** Footer button in Simple view inviting the user to Advanced. */
export function AdvancedHint({ what }: { what: string }) {
  const setDetail = useUi((s) => s.setDetail);
  return (
    <button className="adv-hint" onClick={() => setDetail("advanced")} data-testid="advanced-hint">
      Advanced view: {what} →
    </button>
  );
}
