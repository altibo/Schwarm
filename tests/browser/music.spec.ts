import { test, expect, type Page } from "@playwright/test";
import { watchErrors } from "./helpers.ts";
type W = { __schwarm: { engine: { ctx: AudioContext | null; lateBars: number; perf: { bars: number; schedMsSum: number; schedMsMax: number; maxSources: number }; runner: { director: { level: number; genre: string } } }; state(): { current: { genre: string; level: number } | null } } };
const meta = (page: Page) => page.locator("#meta");
test("music style: Hard House is the default, Techno selectable and remembered", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("./");
  await expect(page.locator('#genres button[data-genre="hardhouse"]')).toHaveAttribute("aria-pressed", "true");
  await page.click("#play");
  await expect(meta(page)).toContainText("Hard House", { timeout: 15000 });
  await expect(meta(page)).toContainText(/F-Moll · 14\d(,\d+)? BPM/);
  await page.click("#play");
  await page.click('#genres button[data-genre="techno"]');
  await expect(page.locator('#genres button[data-genre="techno"]')).toHaveAttribute("aria-pressed", "true");
  await page.click("#play");
  await expect(meta(page)).toContainText("Techno", { timeout: 15000 });
  await expect(meta(page)).toContainText(/12\d(,\d+)? BPM/);
  await page.click("#play");
  await page.reload();
  await expect(page.locator('#genres button[data-genre="techno"]')).toHaveAttribute("aria-pressed", "true");
  await page.click('#genres button[data-genre="hardhouse"]');
  expect(errors).toEqual([]);
});
for (const genre of ["hardhouse", "techno"] as const)
  test(`CPU: ${genre} at full energy with 4× CPU throttling keeps up (no late bars, audio clock on time)`, async ({ page }) => {
    test.setTimeout(90000);
    await page.goto("./");
    await page.click(`#genres button[data-genre="${genre}"]`);
    // Jump straight to the top level (the densest arrangement).
    await page.evaluate(() => ((window as unknown as W).__schwarm.engine.runner.director.level = 10));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.click("#play");
    await expect.poll(() => page.evaluate(() => (window as unknown as W).__schwarm.engine.perf.bars), { timeout: 20000 }).toBeGreaterThan(1);
    const a = await page.evaluate(() => ({ wall: performance.now(), ctx: (window as unknown as W).__schwarm.engine.ctx!.currentTime }));
    await page.waitForTimeout(30000);
    const b = await page.evaluate(() => {
      const e = (window as unknown as W).__schwarm.engine;
      return { wall: performance.now(), ctx: e.ctx!.currentTime, late: e.lateBars, perf: e.perf, level: e.runner.director.level };
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    const drift = (b.wall - a.wall) / 1000 - (b.ctx - a.ctx);
    const mean = b.perf.schedMsSum / b.perf.bars;
    console.log(`${genre}: level ${b.level}, ${b.perf.bars} bars, schedule mean ${mean.toFixed(1)} ms / max ${b.perf.schedMsMax.toFixed(1)} ms per bar (4× throttled), max live sources ${b.perf.maxSources}, audio clock drift ${drift.toFixed(3)} s / 30 s`);
    expect(b.late).toBe(0);
    expect(Math.abs(drift)).toBeLessThan(0.5);
    expect(mean).toBeLessThan(40);
    await page.click("#play");
  });
