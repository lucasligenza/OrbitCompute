import { expect, test } from "@playwright/test";
test("capture layout", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => { localStorage.setItem("orbitcompute.tutorial.seen", "1"); localStorage.setItem("orbitcompute.quality", "high"); localStorage.removeItem("orbitcompute.detail"); });
  for (const [w, h] of [[1440, 900], [1024, 768]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/");
    await expect(page.getByTestId("scene")).toHaveAttribute("data-ready", "1");
    await expect(page.getByTestId("explain-panel")).toBeVisible({ timeout: 60000 });
    const b = (await page.getByTestId("scrubber").boundingBox())!;
    await page.mouse.click(b.x + b.width * 0.31, b.y + b.height / 2);
    await page.getByTestId("mode-power").click();
    await page.getByTestId("tab-feed").click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `../.panel-shots/layout-${w}.png` });
  }
});
