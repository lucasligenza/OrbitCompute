import { expect, test, type Page } from "@playwright/test";
async function scrub(page: Page, f: number) {
  const b = (await page.getByTestId("scrubber").boundingBox())!;
  await page.mouse.click(b.x + b.width * f, b.y + b.height / 2);
}
test("capture data flow", async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => { localStorage.setItem("orbitcompute.tutorial.seen", "1"); localStorage.setItem("orbitcompute.quality", "high"); });
  await page.goto("/");
  await expect(page.getByTestId("explain-panel")).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.getByTestId("mode-network").click();
  await page.getByTestId("preset-select").selectOption("iss-reference");
  await expect(page.getByTestId("explain-panel")).toContainText("OC-ISSREF", { timeout: 60000 });
  await page.getByTestId("mode-network").click();
  // direct pass, default (wide) view, then follow close-up
  await scrub(page, 0.175);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "../.panel-shots/flow-direct-wide.png" });
  await page.getByTestId("follow").click();
  await page.waitForTimeout(2600);
  await page.mouse.move(720, 450);
  for (let k = 0; k < 4; k++) { await page.mouse.wheel(0, 260); await page.waitForTimeout(80); }
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "../.panel-shots/flow-direct.png" });
  await page.getByTestId("reset-view").click();
  await page.waitForTimeout(1800);
  // just after LOS from Wallops: users waiting at the home station (still facing the camera)
  await scrub(page, 0.181);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "../.panel-shots/flow-waiting.png" });
});
