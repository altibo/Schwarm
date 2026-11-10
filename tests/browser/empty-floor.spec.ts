// Regression (real-device test, Phase 1): after dancing, the guest laid the phone on the table;
// the master's measured curve stuck at a constant mid value while "0 tanzen mit" was shown.
// With nobody counting, the measured energy must go to 0 and the director plays the curve.
import { test, expect, type Page } from "@playwright/test";
import { FAKE_MOTION } from "./fake-motion.ts";
test.describe.configure({ mode: "serial" });
type W = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const st = (page: Page) => page.evaluate(() => (window as unknown as W).__schwarm.state());
async function party(page: Page) {
  await page.goto("./?crowd=live&net=local");
  await expect.poll(async () => (await st(page)).party?.nets?.length ?? 0, { timeout: 20000 }).toBeGreaterThan(0);
  const url: string = (await st(page)).party.url;
  await page.click("#closeParty");
  await page.click("#play");
  return url;
}
async function guest(page: Page, url: string) {
  const g = await page.context().newPage();
  await g.setViewportSize({ width: 390, height: 844 });
  await g.addInitScript(FAKE_MOTION);
  await g.goto(url);
  await g.evaluate(() => (window as unknown as W).__dance({ amp: 5 }));
  await g.click("#agree");
  await expect(g.locator("#pocket")).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => (await st(page)).party.crowd.energy, { timeout: 25000 }).toBeGreaterThan(4);
  // …and the heard plan (what the curve and the director get) shows it too.
  await expect.poll(async () => (await st(page)).current?.crowd?.energy ?? 0, { timeout: 15000 }).toBeGreaterThan(4);
  return g;
}
/** The measured value the director and the curve get for the newest heard bar. */
const ist = async (page: Page) => (await st(page)).current?.crowd?.energy ?? NaN;
test("0 dancers: master alone (nobody counts) → measured energy 0 on every bar, 'Niemand zählt', curve-only", async ({ page }) => {
  test.setTimeout(60000);
  await party(page);
  await expect.poll(async () => (await st(page)).bars, { timeout: 20000 }).toBeGreaterThan(5);
  const s = await st(page);
  expect(s.party.crowd.n).toBe(0);
  expect(s.party.crowd.energy).toBe(0);
  expect(await ist(page)).toBe(0);
  await expect(page.locator("#lsVals")).toContainText("Niemand zählt");
  expect(s.current.readiness).toBe(0);
});
test("guest stops reporting (network gone: every packet lost, no goodbye) → out of N within the presence window, energy decays to 0", async ({ page }) => {
  test.setTimeout(90000);
  const url = await party(page);
  const g = await guest(page, url);
  // From now on nothing this phone sends arrives (like Wi-Fi dropping mid-dance).
  await g.evaluate(() => ((window as unknown as W).__guest.core().link.send = async () => true));
  const t0 = Date.now();
  await expect.poll(async () => (await st(page)).party.crowd.n, { timeout: 15000 }).toBe(0);
  await expect.poll(() => ist(page), { timeout: 20000 }).toBe(0);
  console.log(`silent guest: N = 0 and energy 0 after ${Date.now() - t0} ms`);
  // …and it stays 0 (no stale value comes back).
  for (let k = 0; k < 3; k++) {
    await page.waitForTimeout(2000);
    expect(await ist(page)).toBe(0);
    expect((await st(page)).party.crowd.energy).toBe(0);
  }
  await expect(page.locator("#lsVals")).toContainText("Niemand zählt");
  await g.close();
});
test("phone lies still on the table (pocket mode on): energy ≈ 0 at once, after 60 s not counted, energy 0 – never a held mid value", async ({ page }) => {
  test.setTimeout(200000);
  const url = await party(page);
  const g = await guest(page, url);
  await g.evaluate(() => (window as unknown as W).__dance({ amp: 0, noise: 0.03, tilt: 0 }));
  await expect.poll(() => ist(page), { timeout: 12000 }).toBeLessThan(0.5);
  expect((await st(page)).party.crowd.n).toBe(1);
  const t0 = Date.now();
  let maxE = 0;
  while (Date.now() - t0 < 75000) {
    await page.waitForTimeout(2500);
    maxE = Math.max(maxE, await ist(page));
    if (process.env.DBG) console.log(JSON.stringify(await page.evaluate(() => { const s = (window as unknown as W).__schwarm.state(); return { ist: s.current?.crowd.energy, sec: s.current?.section, ph: s.current?.phaseName, L: s.party.latest, lm: s.party.lm }; })));
    if ((await st(page)).party.crowd.n === 0 && Date.now() - t0 > 8000) break;
  }
  expect(maxE, "no jump back to a mid value while lying still").toBeLessThan(0.5);
  // Under load a throttled guest can drop out of N via the presence window first; either way it must end up 'still'.
  await expect.poll(() => g.evaluate(() => (window as unknown as W).__guest.core().my.still), { timeout: 45000 }).toBe(true);
  const s = await st(page);
  expect(s.party.crowd.n).toBe(0);
  expect(s.party.joined).toBe(1);
  for (let k = 0; k < 3; k++) {
    await page.waitForTimeout(2000);
    expect(await ist(page)).toBe(0);
  }
  await expect(page.locator("#tvN")).toHaveText("0 tanzen mit");
  // Picking it up and dancing again counts again.
  await g.evaluate(() => (window as unknown as W).__dance({ amp: 5 }));
  await expect.poll(async () => (await st(page)).party.crowd.n, { timeout: 15000 }).toBe(1);
  await expect.poll(() => ist(page), { timeout: 15000 }).toBeGreaterThan(4);
});
