import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // React Three Fiber mutates three.js objects (uniforms, geometries) inside useFrame by design;
    // this is render state, deliberately kept out of React state for performance.
    files: ["src/scene/**/*.tsx"],
    rules: { "react-hooks/immutability": "off" },
  },
  globalIgnores([".next/**", "out/**", "next-env.d.ts", "playwright-report/**", "test-results/**"]),
]);
