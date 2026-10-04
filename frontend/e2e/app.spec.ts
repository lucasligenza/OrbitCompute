import { expect, test, type Page } from "@playwright/test";

const errors: string[] = [];

async function open(page: Page) {
  errors.length = 0;
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.addInitScript(() => {
    localStorage.setItem("orbitcompute.tutorial.seen", "1");
    localStorage.setItem("orbitcompute.quality", "low"); // SwiftShader: keep headless runs fast
  });
  await page.goto("/");
  await expect(page.getByTestId("scene")).toHaveAttribute("data-ready", "1");
  await expect(page.getByTestId("explain-panel")).toBeVisible();
}

const simT = (page: Page) => page.evaluate(() => (window as unknown as { __oc: { t: number } }).__oc.t);
const frames = (page: Page) => page.evaluate(() => (window as unknown as { __oc: { frames: number } }).__oc.frames);

async function scrubTo(page: Page, frac: number) {
  const box = (await page.getByTestId("scrubber").boundingBox())!;
  await page.mouse.click(box.x + box.width * frac, box.y + box.height / 2);
}

test("3D scene loads and renders frames", async ({ page }) => {
  await open(page);
  const f0 = await frames(page);
  await page.waitForTimeout(800);
  expect(await frames(page)).toBeGreaterThan(f0);
  await expect(page.getByTestId("node-label-0")).toBeAttached();
  await expect(page.getByTestId("utc")).toContainText("2026");
  expect(errors.filter((e) => !/Download the React DevTools/.test(e))).toEqual([]);
});

test("playback advances simulation time and pauses", async ({ page }) => {
  await open(page);
  await page.getByTestId("speed-1000").click();
  await page.getByTestId("play").click();
  await page.waitForTimeout(1500);
  await page.getByTestId("play").click();
  const t1 = await simT(page);
  expect(t1).toBeGreaterThan(100);
  await page.waitForTimeout(500);
  expect(await simT(page)).toBe(t1);
});

test("scrubbing backward restores identical state", async ({ page }) => {
  await open(page);
  await scrubTo(page, 0.4);
  const a = await page.getByTestId("explain-panel").innerText();
  await scrubTo(page, 0.85);
  const b = await page.getByTestId("explain-panel").innerText();
  expect(b).not.toBe(a);
  await scrubTo(page, 0.4);
  await expect.poll(() => page.getByTestId("explain-panel").innerText()).toBe(a);
});

test("visualization modes change panel and legend", async ({ page }) => {
  await open(page);
  for (const mode of ["power", "thermal", "compute", "network", "system", "orbit"]) {
    await page.getByTestId(`mode-${mode}`).click();
    await expect(page.getByTestId("detail-panel")).toHaveAttribute("data-mode", mode);
    await expect(page.getByTestId(`${mode}-panel`)).toBeVisible();
  }
  await page.getByTestId("mode-thermal").click();
  await expect(page.getByTestId("legend")).toContainText("Equipment temperature");
});

test("power flow responds to eclipse", async ({ page }) => {
  await open(page);
  await page.getByTestId("mode-power").click();
  const pf = page.getByTestId("power-flow");
  await expect(pf).toContainText("SOLAR ARRAY");
  // t = 0 is in eclipse for the default preset; scrub into sunlight
  await expect(pf).toContainText("ECLIPSE");
  await expect(pf).toContainText("DISCHARGING");
  await scrubTo(page, 0.45);
  await expect(page.getByTestId("explain-power")).not.toContainText("On battery");
});

test("thermal view shows schematic and model boundary", async ({ page }) => {
  await open(page);
  await page.getByTestId("mode-thermal").click();
  await expect(page.getByTestId("schematic")).toBeVisible();
  await expect(page.getByTestId("thermal-panel")).toContainText("Simplified 2-node thermal model");
  await expect(page.getByTestId("thermal-panel")).toContainText("not a spacecraft thermal analysis");
});

test("compute view: rack and job inspector", async ({ page }) => {
  await open(page);
  await page.getByTestId("mode-compute").click();
  await scrubTo(page, 0.5);
  await expect(page.getByTestId("rack")).toBeVisible();
  await page.getByTestId("job-row").first().click();
  const insp = page.getByTestId("job-inspector");
  await expect(insp).toBeVisible();
  await expect(insp).toContainText("Progress");
  await expect(insp).toContainText("Deadline");
});

test("network view: contact windows", async ({ page }) => {
  await open(page);
  await page.getByTestId("mode-network").click();
  await expect(page.getByTestId("contact-gantt")).toContainText("Svalbard");
  await expect(page.getByTestId("network-panel")).toContainText("Active link");
});

test("event timeline click seeks time", async ({ page }) => {
  await open(page);
  await page.getByTestId("toggle-events").click();
  const row = page.getByTestId("event-row").nth(3);
  const label = (await row.innerText()).split("\n")[0].trim(); // "T+mm:ss"
  await row.click();
  await expect(page.getByTestId("met")).toHaveText(label);
});

test("constellation preset and node selection", async ({ page }) => {
  await open(page);
  await page.getByTestId("preset-select").selectOption("distributed-inference");
  await expect(page.getByTestId("node-label-5")).toBeAttached({ timeout: 60_000 });
  const sel = page.getByTestId("explain-panel").getByRole("combobox");
  await sel.selectOption({ index: 3 });
  await expect(page.getByTestId("explain-panel")).toContainText("ORBITAL COMPUTE NODE OC-B1");
});

test("scenario editing reruns the simulation", async ({ page }) => {
  await open(page);
  await page.getByTestId("open-design").click();
  await expect(page.getByTestId("orbit-preview")).toContainText("Period");
  await page.getByTestId("design-tab-hardware").click();
  const count = page.getByTestId("accel-count");
  await count.fill("32");
  await count.press("Enter");
  await page.getByTestId("run-sim").click();
  await expect(page.getByTestId("explain-panel")).toContainText("32 × inf-350", { timeout: 60_000 });
  await expect(page.getByTestId("design-drawer")).toContainText("Result is up to date");
});

test("comparison runs two schedulers", async ({ page }) => {
  await open(page);
  await page.getByTestId("open-compare").click();
  await page.getByTestId("cmp-a-scheduler").selectOption("fifo");
  await page.getByTestId("cmp-b-scheduler").selectOption("energy");
  await page.getByTestId("cmp-run").click();
  const table = page.getByTestId("cmp-table");
  await expect(table).toContainText("Completed workloads", { timeout: 60_000 });
  await expect(table).toContainText("Min thermal margin");
  await expect(page.getByTestId("compare-view")).toContainText("Energy-aware");
});
