"use client";
import dynamic from "next/dynamic";

// WebGL + window access: the whole app shell renders on the client only.
const App = dynamic(() => import("@/components/App"), {
  ssr: false,
  loading: () => (
    <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", color: "#8b95a3" }}>
      Loading OrbitCompute…
    </div>
  ),
});

export default function Page() {
  return <App />;
}
