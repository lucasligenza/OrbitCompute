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
  await expect(pf).toContainText("SOLAR");
  // t = 0 is in eclipse for the default preset; scrub into sunlight
  await expect(pf).toContainText("eclipse");
  await expect(pf).toContainText("DIS");
  await scrubTo(page, 0.45);
  await expect(page.getByTestId("explain-power")).not.toContainText("On battery");
});

test("thermal view shows schematic and model boundary", async ({ page }) => {
  await open(page);
  await page.getByTestId("mode-thermal").click();
  await expect(page.getByTestId("schematic")).toBeVisible();
  await expect(page.getByTestId("thermal-panel")).toContainText("Simplified 2-node thermal model");
  await page.getByTestId("detail-advanced").click();
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
  await expect(page.getByTestId("link-path")).toBeVisible();
  await expect(page.getByTestId("network-panel")).toContainText("Active link");
  await page.getByTestId("detail-advanced").click();
  await expect(page.getByTestId("contact-gantt")).toContainText("Svalbard");
  await expect(page.getByTestId("sky-plot")).toBeVisible();
});

test("mission feed: plain-language events, click seeks time", async ({ page }) => {
  await open(page);
  await page.getByTestId("toggle-events").click();
  await expect(page.getByTestId("mission-feed")).toBeVisible();
  await expect(page.getByTestId("mission-feed")).toContainText("Simulation starts");
  await expect(page.getByTestId("coming-up")).toBeVisible();
  const row = page.getByTestId("event-row").nth(3);
  const label = (await row.locator(".feed-time").innerText()).trim(); // "T+mm:ss"
  await row.click();
  await expect(page.getByTestId("met")).toHaveText(label);
  await page.getByTestId("feed-all").click();
  expect(await page.getByTestId("event-row").count()).toBeGreaterThan(20);
});

test("layout: panels, controls and legend never overlap", async ({ page }) => {
  for (const [w, h] of [[1440, 900], [1180, 800], [1024, 768]]) {
    await page.setViewportSize({ width: w, height: h });
    await open(page);
    const boxes = await page.evaluate(() => {
      const ids = ["detail-panel", "explain-panel", "scene-controls", "legend"];
      return ids.map((id) => {
        const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
        if (!el || getComputedStyle(el).display === "none") return null;
        const r = el.getBoundingClientRect();
        return r.width && r.height ? { id, l: r.left, r: r.right, t: r.top, b: r.bottom } : null;
      }).filter(Boolean) as { id: string; l: number; r: number; t: number; b: number }[];
    });
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap = a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
      expect(overlap, `${a.id} overlaps ${b.id} at ${w}x${h}`).toBe(false);
    }
    const tb = await page.evaluate(() => { const t = document.querySelector(".topbar")!; return t.scrollWidth - t.clientWidth; });
    expect(tb, `topbar overflows at ${w}px`).toBeLessThanOrEqual(1);
  }
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

test("simple/advanced toggle switches detail level and persists", async ({ page }) => {
  await open(page);
  await page.getByTestId("mode-power").click();
  await expect(page.getByTestId("soc-gauge")).toBeVisible();
  await expect(page.getByTestId("power-chart")).toHaveCount(0);
  await expect(page.getByTestId("big-numbers")).toBeVisible();
  await page.getByTestId("advanced-hint").click();
  await expect(page.getByTestId("power-chart")).toBeVisible();
  await expect(page.getByTestId("explain-power")).toContainText("Solar generation");
  await page.reload();
  await expect(page.getByTestId("scene")).toHaveAttribute("data-ready", "1");
  await page.getByTestId("mode-power").click();
  await expect(page.getByTestId("power-chart")).toBeVisible();
  await page.getByTestId("detail-simple").click();
  await expect(page.getByTestId("power-chart")).toHaveCount(0);
});

test("high quality graphics render frames", async ({ page }) => {
  await open(page);
  await page.getByTestId("quality-high").click();
  await expect(page.getByTestId("scene")).toHaveAttribute("data-quality", "high");
  await expect(page.getByTestId("scene")).toHaveAttribute("data-ready", "1");
  const f0 = await frames(page);
  await page.waitForTimeout(2500);
  expect(await frames(page)).toBeGreaterThan(f0);
  await page.getByTestId("quality-low").click();
});

test("guided tours: launcher, deep dive drives the simulation, exit restores scenario", async ({ page }) => {
  await open(page);
  await page.getByTestId("open-tutorial").click();
  await expect(page.getByTestId("tour-launcher")).toBeVisible();
  // jump straight to the "Getting rid of heat" chapter: it loads the large training platform
  await page.getByTestId("chapter-5").click();
  const card = page.getByTestId("tutorial");
  await expect(card).toContainText("Chapter 6/10");
  await expect(card).not.toContainText("Setting up this moment", { timeout: 60_000 });
  await expect(card).toContainText("radiators");
  await expect(page.getByTestId("preset-select")).toHaveValue("large-training");
  await expect(page.getByTestId("detail-panel")).toHaveAttribute("data-mode", "thermal");
  await page.getByTestId("tutorial-next").click();
  await expect(card).toContainText("Throttling");
  await page.getByTestId("tour-exit").click();
  await page.getByTestId("tour-restore").click();
  await expect(page.getByTestId("tutorial")).toHaveCount(0);
  await expect(page.getByTestId("preset-select")).toHaveValue("leo-inference", { timeout: 60_000 });
});
