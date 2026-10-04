// Manual: npx playwright test --config=e2e/capture.config.ts  (writes docs/images/*.png)
import { expect, test } from "@playwright/test";

test("capture README screenshots", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("orbitcompute.tutorial.seen", "1"));
  await page.goto("/");
  await expect(page.getByTestId("scene")).toHaveAttribute("data-ready", "1");
  const scrub = async (f: number) => {
    const b = (await page.getByTestId("scrubber").boundingBox())!;
    await page.mouse.click(b.x + b.width * f, b.y + b.height / 2);
  };
  await page.getByTestId("mode-power").click();
  await scrub(0.37);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "../docs/images/power-mode.png" });
  await page.getByTestId("mode-compute").click();
  await scrub(0.55);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "../docs/images/compute-mode.png" });
  await page.getByTestId("preset-select").selectOption("large-training");
  await expect(page.getByTestId("explain-panel")).toContainText("OC-XL", { timeout: 60000 });
  await page.getByTestId("mode-thermal").click();
  await scrub(0.6);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "../docs/images/thermal-mode.png" });
  await page.getByTestId("preset-select").selectOption("distributed-inference");
  await expect(page.getByTestId("node-label-5")).toBeAttached({ timeout: 60000 });
  await page.getByTestId("mode-network").click();
  await scrub(0.3);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "../docs/images/network-constellation.png" });
});
