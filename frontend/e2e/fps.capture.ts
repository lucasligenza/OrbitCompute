import { test } from "@playwright/test";
test("fps probe (swiftshader)", async ({ page }) => {
  test.setTimeout(120_000);
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("CONSOLE", m.type(), m.text().slice(0, 300)); });
  page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 300)));
  page.on("requestfinished", (r) => { if (r.url().includes("/api/")) console.log("REQ done", r.url()); });
  page.on("requestfailed", (r) => console.log("REQ failed", r.url(), r.failure()?.errorText));
  await page.addInitScript(() => { localStorage.setItem("orbitcompute.tutorial.seen", "1"); localStorage.setItem("orbitcompute.quality", "low"); });
  await page.goto("/");
  for (let k = 0; k < 6; k++) {
    await page.waitForTimeout(5000);
    console.log("t", (k + 1) * 5, "oc", JSON.stringify(await page.evaluate(() => (window as unknown as { __oc?: unknown }).__oc ?? null)),
      "explain", await page.getByTestId("explain-panel").count());
  }
});
