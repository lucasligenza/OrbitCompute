// Manual visual check: npx playwright test --config=e2e/capture.config.ts e2e/panels.capture.ts
import { expect, test } from "@playwright/test";

const MODES = (process.env.MODES ?? "power,thermal,compute,network,orbit,system").split(",");

test("capture panels simple + advanced", async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => { localStorage.setItem("orbitcompute.tutorial.seen", "1"); localStorage.setItem("orbitcompute.quality", "high"); });
  await page.goto("/");
  await expect(page.getByTestId("scene")).toHaveAttribute("data-ready", "1");
  const b = (await page.getByTestId("scrubber").boundingBox())!;
  await page.mouse.click(b.x + b.width * 0.52, b.y + b.height / 2);
  for (const m of MODES) {
    await page.getByTestId(`mode-${m}`).click();
    for (const d of ["simple", "advanced"]) {
      await page.getByTestId(`detail-${d}`).click();
      await page.waitForTimeout(700);
      await page.getByTestId("detail-panel").screenshot({ path: `../.panel-shots/${m}-${d}.png` });
    }
  }
  await page.getByTestId("detail-simple").click();
  await page.screenshot({ path: "../.panel-shots/full.png" });
});
