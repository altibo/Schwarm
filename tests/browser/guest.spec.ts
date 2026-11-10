import { test, expect } from "@playwright/test";
import { watchErrors, checkLayout } from "./helpers.ts";
for (const vp of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 360, height: 740 }])
  test(`participant view ${vp.width}×${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    const errors = watchErrors(page);
    await page.goto("./guest.html?preview");
    await expect(page.locator("#gN")).toHaveText("128");
    await checkLayout(page);
    expect(errors).toEqual([]);
  });
test("N from 1 to 5000: solo text, log-scaled dots; pocket mode is black, Statistik brings stats back", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./guest.html?preview");
  await page.locator("#sN").fill("0");
  await expect(page.locator("#gNtxt")).toHaveText("Solo: nur du tanzt");
  await expect(page.locator("#gRuleN")).toContainText("Solo");
  // solo: readiness follows MY beat stability, not the crowd sync slider
  await page.click("#sPhase button[data-v='Build-up']");
  await page.locator("#sS").fill("0.95");
  await page.locator("#sMe").fill("8");
  await page.locator("#sMs").fill("0.45");
  await expect(page.locator("#gReadyTxt")).not.toHaveText("frei");
  await page.locator("#sMs").fill("0.8");
  await expect(page.locator("#gReadyTxt")).toHaveText("frei");
  await page.locator("#sN").fill("1");
  await expect(page.locator("#gN")).toHaveText("5 Tsd.");
  await expect(page.locator("#gScale")).toContainText("1 Punkt ≈");
  const dots = await page.evaluate(() => (window as unknown as { __guest: { dotsFor(n: number): number } }).__guest.dotsFor(5000));
  expect(dots).toBeLessThanOrEqual(420);
  await page.click("#toPocket");
  await expect(page.locator("#pocket")).toBeVisible();
  await expect(page.locator("#gview")).toBeHidden();
  const bg = await page.locator("#pocket").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgb(0, 0, 0)");
  // Touch lock: a tap does nothing, a 2 s hold brings the stats back.
  await page.click("#showStats");
  await expect(page.locator("#gview")).toBeHidden();
  const box = (await page.locator("#showStats").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(2300);
  await page.mouse.up();
  await expect(page.locator("#gview")).toBeVisible();
});
