import { test, expect } from "@playwright/test";
import { watchErrors, checkLayout, VIEWPORTS } from "./helpers.ts";
type S = { running: boolean; ctx?: string; bars: number; lateBars: number; voices: number; current: { phaseName: string; drop: string | null; section: string; level: number } | null; events: { kind: string; detail: string }[] };
const state = (page: import("@playwright/test").Page) => page.evaluate(() => (window as unknown as { __schwarm: { state(): S } }).__schwarm.state());
for (const vp of VIEWPORTS)
  test(`main layout ${vp.width}×${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    const errors = watchErrors(page);
    await page.goto("./");
    await expect(page.locator("#phase")).toHaveText("Bereit");
    await checkLayout(page);
    // In landscape everything fits without scrolling (no submenus, all controls visible).
    if (vp.width > vp.height) {
      const fits = await page.evaluate(() => [...document.querySelectorAll(".controls > *")].every((el) => el.getBoundingClientRect().bottom <= window.innerHeight + 1));
      expect(fits).toBe(true);
    }
    expect(errors).toEqual([]);
  });
test("play: audio starts after the tap, bars are scheduled on time, sound is not silent", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("./");
  await page.click("#play");
  await expect.poll(async () => (await state(page)).bars, { timeout: 15000 }).toBeGreaterThan(2);
  const s = await state(page);
  expect(s.ctx).toBe("running");
  expect(s.voices).toBeGreaterThan(10);
  const rms = await page.evaluate(async () => {
    const a = (window as unknown as { __schwarm: { engine: { analyser: AnalyserNode } } }).__schwarm.engine.analyser;
    const buf = new Float32Array(a.fftSize);
    let best = 0;
    for (let i = 0; i < 20; i++) {
      a.getFloatTimeDomainData(buf);
      best = Math.max(best, Math.sqrt(buf.reduce((x, v) => x + v * v, 0) / buf.length));
      await new Promise((r) => setTimeout(r, 50));
    }
    return best;
  });
  expect(rms).toBeGreaterThan(0.005);
  await page.waitForTimeout(4000);
  expect((await state(page)).lateBars).toBe(0);
  await page.click("#play");
  await expect(page.locator("#play")).toHaveText("▶ Play");
  expect(errors).toEqual([]);
});
test("Drop jetzt erzwingen: amber while queued, drop on the one within 2 bars", async ({ page }) => {
  await page.goto("./");
  await page.click("#play");
  await expect.poll(async () => (await state(page)).bars, { timeout: 15000 }).toBeGreaterThan(1);
  await page.click("#drop");
  await expect(page.locator("#drop")).toHaveClass(/queued/);
  await expect.poll(async () => (await state(page)).events.some((e) => e.kind === "drop" && e.detail.includes("erzwungen")), { timeout: 10000 }).toBe(true);
  await expect(page.locator("#phase")).toHaveText("Drop", { timeout: 8000 });
  await expect(page.locator("#drop")).not.toHaveClass(/queued/);
});
test("Anzahl Tänzer changes the unlock rule (solo → group)", async ({ page }) => {
  await page.goto("./");
  await page.locator("#n").fill("0");
  await expect(page.locator("#rule")).toContainText("Solo");
  await expect(page.locator("#nOut")).toHaveText("1");
  await page.locator("#n").fill("1");
  await expect(page.locator("#rule")).toContainText("Gruppe");
  await expect(page.locator("#nOut")).toHaveText("5 Tsd.");
  await page.click("#modeSim");
  await expect(page.locator("#energy")).toBeDisabled();
  await page.click("button[data-preset='3h']");
  await expect(page.locator("button[data-preset='3h']")).toHaveAttribute("aria-pressed", "true");
});
