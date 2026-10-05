import { expect, test } from "@playwright/test";
test("walk the deep dive", async ({ page }) => {
  test.setTimeout(420_000);
  await page.addInitScript(() => { localStorage.removeItem("orbitcompute.tutorial.seen"); localStorage.setItem("orbitcompute.quality", "high"); });
  await page.goto("/");
  await expect(page.getByTestId("tour-launcher")).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: "../.panel-shots/tour-00-launcher.png" });
  await page.getByTestId("start-deep").click();
  const card = page.getByTestId("tutorial");
  for (let i = 1; i <= 40; i++) {
    await expect(card).toBeVisible();
    await expect(card).not.toContainText("Setting up this moment", { timeout: 60000 });
    await page.waitForTimeout(1800);
    const txt = (await card.innerText()).replace(/\n+/g, " | ");
    console.log(`STEP ${i}: ${txt.slice(0, 420)}`);
    await page.screenshot({ path: `../.panel-shots/tour-${String(i).padStart(2, "0")}.png` });
    const next = page.getByTestId("tutorial-next");
    if (await next.count()) await next.click();
    else break;
  }
  await page.getByTestId("tour-done").click();
  await page.getByTestId("tour-restore").click();
  await expect(page.getByTestId("preset-select")).toHaveValue("leo-inference");
});
