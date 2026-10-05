// Manual visual check: npx playwright test --config=e2e/capture.config.ts dataflow
import { expect, test, type Page } from "@playwright/test";
async function scrub(page: Page, f: number) {
  const b = (await page.getByTestId("scrubber").boundingBox())!;
  await page.mouse.click(b.x + b.width * f, b.y + b.height / 2);
}
test("capture data flow journeys", async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => { localStorage.setItem("orbitcompute.tutorial.seen", "1"); localStorage.setItem("orbitcompute.quality", "high"); });
  await page.goto("/");
  await expect(page.getByTestId("explain-panel")).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.getByTestId("preset-select").selectOption("iss-reference");
  await expect(page.getByTestId("explain-panel")).toContainText("OC-ISSREF", { timeout: 60000 });
  await page.getByTestId("mode-network").click();
  await scrub(page, 0.175);
  await page.getByTestId("follow").click();
  await page.waitForTimeout(2600);
  await page.mouse.move(720, 450);
  for (let k = 0; k < 5; k++) { await page.mouse.wheel(0, 260); await page.waitForTimeout(80); }
  await page.waitForTimeout(1000);
  for (let f = 0; f < 4; f++) {
    await page.screenshot({ path: `../.panel-shots/journey-${f}.png` });
    await page.waitForTimeout(450);
  }
  await page.getByTestId("reset-view").click();
  await page.waitForTimeout(1800);
  await scrub(page, 0.181);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "../.panel-shots/journey-waiting.png" });
});
