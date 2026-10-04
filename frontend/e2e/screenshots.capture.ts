// Manual: npx playwright test --config=e2e/capture.config.ts  (writes docs/images/*.png)
import { expect, test, type Page } from "@playwright/test";

async function scrub(page: Page, f: number) {
  const b = (await page.getByTestId("scrubber").boundingBox())!;
  await page.mouse.click(b.x + b.width * f, b.y + b.height / 2);
}

test("capture README screenshots", async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => { localStorage.setItem("orbitcompute.tutorial.seen", "1"); localStorage.setItem("orbitcompute.quality", "high"); });
  await page.goto("/");
  await expect(page.getByTestId("scene")).toHaveAttribute("data-ready", "1");
  await page.waitForTimeout(3500); // intro dolly
  await page.getByTestId("mode-power").click();
  await scrub(page, 0.37);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "../docs/images/power-mode.png" });
  await page.getByTestId("mode-compute").click();
  await scrub(page, 0.55);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "../docs/images/compute-mode.png" });
  await page.getByTestId("follow").click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "../docs/images/follow-closeup.png" });
  await page.getByTestId("reset-view").click();
  await page.waitForTimeout(1800);
  await page.getByTestId("preset-select").selectOption("large-training");
  await expect(page.getByTestId("explain-panel")).toContainText("OC-XL", { timeout: 60000 });
  await page.getByTestId("mode-thermal").click();
  await scrub(page, 0.6);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "../docs/images/thermal-mode.png" });
  await page.getByTestId("preset-select").selectOption("distributed-inference");
  await expect(page.getByTestId("node-label-5")).toBeAttached({ timeout: 60000 });
  await page.getByTestId("mode-network").click();
  await scrub(page, 0.3);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "../docs/images/network-constellation.png" });
  const fps = await page.evaluate(() => (window as unknown as { __oc: { fps: number } }).__oc.fps);
  console.log("FPS (headless swiftshader):", fps);
});
