import base from "../playwright.config";
import { defineConfig } from "@playwright/test";
// Screenshot capture uses the real GPU (High quality is too heavy for SwiftShader).
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: /screenshots\.capture\.ts/,
  use: { ...base.use, launchOptions: { args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] } },
});
