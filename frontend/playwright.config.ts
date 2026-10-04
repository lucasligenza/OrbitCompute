import { defineConfig } from "@playwright/test";

// Uses the system Microsoft Edge (no browser download). WebGL via SwiftShader in headless mode.
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    channel: process.env.PW_CHANNEL ?? "msedge",
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "uv --directory ../backend run uvicorn orbitcompute.api:app --port 8000",
      url: "http://127.0.0.1:8000/api/health",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "npm run dev",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
