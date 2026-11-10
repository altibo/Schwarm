import { test, expect } from "@playwright/test";
test("PWA: works offline after the first visit (pages + samples cached)", async ({ page, context }) => {
  await page.goto("./");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15000 }).toBe(true);
  await context.setOffline(true);
  for (const p of ["./", "./test.html", "./guest.html"]) {
    await page.goto(p);
    await expect(page.locator(".logo")).toHaveText("SCHWARM");
  }
  const ok = await page.evaluate(async () => (await fetch("./samples/drum-clap.wav")).ok);
  expect(ok).toBe(true);
  await page.goto("./");
  await page.click("#play");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __schwarm: { state(): { bars: number } } }).__schwarm.state().bars), { timeout: 15000 }).toBeGreaterThan(1);
  await context.setOffline(false);
});
