// Phase 1: live party end to end – master + guests with fake DeviceMotion, through the real
// public transport where the box allows it (shiftr.io MQTT, PeerJS) and the local transport
// (same interface) for timing-sensitive checks.
import { test, expect, type Page, type Browser } from "@playwright/test";
import { watchErrors, checkLayout } from "./helpers.ts";
import { FAKE_MOTION } from "./fake-motion.ts";
test.describe.configure({ mode: "serial" });
type W = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ms = (page: Page) => page.evaluate(() => (window as unknown as W).__schwarm.state().party);
async function startMaster(page: Page, net: string, extra = "") {
  await page.goto(`./?crowd=live&net=${encodeURIComponent(net)}${extra}`);
  await expect(page.locator("#party")).toBeVisible();
  await expect.poll(async () => (await ms(page))?.nets?.length ?? 0, { timeout: 25000 }).toBeGreaterThan(0);
  const p = await ms(page);
  expect(p.url).toContain(`guest.html?s=${p.sid}`);
  expect(p.url).toMatch(/#k=[\w-]{22}$/);
  await expect(page.locator("#qr")).toHaveAttribute("data-text", p.url);
  await page.click("#closeParty");
  await page.click("#play");
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as W).__schwarm.state().bars)), { timeout: 15000 }).toBeGreaterThan(0);
  return p.url as string;
}
async function joinGuest(browser: Browser, url: string, dance: Record<string, unknown> = {}, page?: Page) {
  const g = page ?? (await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage());
  await g.addInitScript(FAKE_MOTION);
  const t0 = Date.now();
  await g.goto(url);
  await expect(g.locator("#consent")).toBeVisible();
  await g.evaluate((o) => (window as unknown as W).__dance(o), dance);
  await g.click("#agree");
  await expect(g.locator("#pocket")).toBeVisible({ timeout: 20000 });
  const joinMs = Date.now() - t0;
  return { g, joinMs };
}
const crowd = (page: Page) => page.evaluate(() => (window as unknown as W).__schwarm.state().party.crowd);
test("solo (N = 1): consent → join < 15 s; the drop unlocks from the single dancer's own beat stability", async ({ page, browser }) => {
  test.setTimeout(120000);
  const errors = watchErrors(page);
  const url = await startMaster(page, "local");
  // Same browser profile → BroadcastChannel transport.
  const g0 = await page.context().newPage();
  await g0.setViewportSize({ width: 390, height: 844 });
  const gErrors = watchErrors(g0);
  await g0.addInitScript(FAKE_MOTION);
  await g0.goto(url);
  await checkLayout(g0);
  await expect(g0.locator("#consent")).toContainText("keine Kamera");
  const { g, joinMs } = await joinGuest(browser, url, { amp: 5.5 }, g0);
  expect(joinMs).toBeLessThan(15000);
  await expect.poll(async () => (await crowd(page)).n, { timeout: 15000 }).toBe(1);
  await expect(page.locator("#rule")).toContainText("Solo");
  // 16 bars with Rᵢ ≥ 0.6 and energy ≥ 6 → readiness 1 (≈ 30 s at 128 BPM).
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as W).__schwarm.state().current?.readiness ?? 0)), { timeout: 70000, intervals: [2000] }).toBe(1);
  // Pocket mode is black + touch-locked; a 2 s hold on "Statistik" brings the live stats back.
  await expect(g.locator("#pocket")).toHaveCSS("background-color", "rgb(0, 0, 0)");
  const hold = g.locator("#showStats");
  const box = (await hold.boundingBox())!;
  await g.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await g.mouse.down();
  await g.waitForTimeout(2300);
  await g.mouse.up();
  await expect(g.locator("#gview")).toBeVisible();
  await expect(g.locator("#gN")).toHaveText("1");
  await expect(g.locator("#gNtxt")).toHaveText("Solo: nur du tanzt");
  await expect(g.locator("#gRuleN")).toContainText("Solo");
  await expect(g.locator("#gtag")).toHaveText("Live · verschlüsselt");
  await expect(g.locator("#myFb")).toHaveText("Du bist im Takt!");
  await checkLayout(g);
  // "Raus": measurement stops, the master drops the guest (not as tired: it leaves N).
  await g.click("#leave");
  await expect(g.locator("#join")).toBeVisible();
  await expect.poll(async () => (await crowd(page)).n, { timeout: 15000 }).toBe(0);
  await expect(page.locator("#lsVals")).toContainText("Niemand zählt");
  expect(errors).toEqual([]);
  expect(gErrors).toEqual([]);
});
test("5 guests over the real public broker (shiftr.io): sync → unlock; random phases → no unlock; hidden and dropped guests leave N", async ({ page, browser }) => {
  test.setTimeout(180000);
  const url = await startMaster(page, "shiftr.io");
  const guests = [];
  for (let i = 0; i < 5; i++) guests.push(await joinGuest(browser, url, { amp: 4.8, offset: (i - 2) * 0.12 }));
  for (const x of guests) expect(x.joinMs).toBeLessThan(15000);
  await expect.poll(async () => (await crowd(page)).n, { timeout: 20000 }).toBe(5);
  await expect.poll(async () => (await crowd(page)).sync, { timeout: 30000 }).toBeGreaterThan(0.8);
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as W).__schwarm.state().current?.readiness ?? 0)), { timeout: 30000 }).toBe(1);
  const offsets = await Promise.all(guests.map((x) => x.g.evaluate(() => (window as unknown as W).__guest.core().link.clock.offset)));
  console.log("clock offsets vs. master via shiftr.io (same machine, true offset 0):", offsets.map((o: number) => o.toFixed(1)).join(", "), "ms");
  // Everybody bounces with a random phase: raw R stays > 0, chance-corrected S collapses.
  for (const [i, x] of guests.entries()) await x.g.evaluate((o) => (window as unknown as W).__dance(o), { amp: 4.8, offset: [0, 2.5, 4.4, 1.2, 5.6][i] });
  await expect.poll(async () => (await crowd(page)).sync, { timeout: 30000 }).toBeLessThan(0.5);
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as W).__schwarm.state().current?.readiness ?? 1)), { timeout: 20000 }).toBeLessThan(1);
  // Page hidden → not counted; back → honest note.
  const h = guests[0].g;
  const setVis = (v: "hidden" | "visible") =>
    h.evaluate((v) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => v === "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    }, v);
  await setVis("hidden");
  await expect.poll(async () => (await crowd(page)).n, { timeout: 15000 }).toBe(4);
  await setVis("visible");
  await expect(h.locator("#hiddenNote")).toBeAttached();
  await expect.poll(async () => (await crowd(page)).n, { timeout: 15000 }).toBe(5);
  // A guest that just disappears (tab closed) drops out of N after the 5 s window.
  await guests[4].g.context().close();
  await expect.poll(async () => (await crowd(page)).n, { timeout: 20000 }).toBe(4);
  for (const x of guests.slice(0, 4)) await x.g.context().close();
});
test("50 guests (swarm harness, one connection each) over shiftr.io: N = 50, S follows the phases", async ({ page, browser }) => {
  test.setTimeout(240000);
  const url = await startMaster(page, "shiftr.io");
  const s = await (await browser.newContext()).newPage();
  await s.goto(url.replace("guest.html", "swarm.html").replace("#", "&n=50#"));
  await expect.poll(() => s.evaluate(() => (window as unknown as W).__swarm?.stats().synced ?? 0), { timeout: 150000, intervals: [3000] }).toBeGreaterThanOrEqual(48);
  await expect.poll(async () => (await crowd(page)).n, { timeout: 20000 }).toBeGreaterThanOrEqual(48);
  await expect.poll(async () => (await crowd(page)).sync, { timeout: 20000 }).toBeGreaterThan(0.9);
  const st = await s.evaluate(() => (window as unknown as W).__swarm.stats());
  const joins = [...st.joinMs].sort((a: number, b: number) => a - b);
  console.log(`50 guests: transports ${st.transports}, join median ${Math.round(joins[25])} ms, max clock offset ${st.maxOffsetMs.toFixed(1)} ms`);
  await s.evaluate(() => (window as unknown as W).__swarm.setMode(false));
  await expect.poll(async () => (await crowd(page)).sync, { timeout: 25000 }).toBeLessThan(0.3);
  const agg = await ms(page);
  expect(agg.latest.m).toBeGreaterThanOrEqual(45); // ~1 report per bar and guest
  await s.context().close();
});
test("phones up + flash on the one: guests flash at the master's drop time; reduced motion → no flash", async ({ page, browser }) => {
  test.setTimeout(120000);
  const url = await startMaster(page, "local");
  const g1 = await page.context().newPage();
  await g1.setViewportSize({ width: 390, height: 844 });
  const { g } = await joinGuest(browser, url, { amp: 4 }, g1);
  const g2 = await page.context().newPage();
  await g2.emulateMedia({ reducedMotion: "reduce" });
  const { g: gr } = await joinGuest(browser, url, { amp: 4 }, g2);
  await expect.poll(async () => (await crowd(page)).n, { timeout: 15000 }).toBe(2);
  await page.evaluate(() => (window as unknown as W).__schwarm.party().startLightMoment());
  await expect(g.locator("#light")).toBeVisible({ timeout: 10000 });
  await page.click("#drop");
  await expect(g.locator("#lightUp")).toHaveText("PHONES UP!", { timeout: 10000 });
  await expect.poll(async () => (await ms(page)).flashes.length, { timeout: 10000 }).toBeGreaterThan(0);
  const dropAt = (await ms(page)).flashes[0] as number;
  await expect.poll(() => g.evaluate(() => (window as unknown as W).__guest.flashLog.length), { timeout: 15000 }).toBeGreaterThan(0);
  const log = await g.evaluate(() => (window as unknown as W).__guest.flashLog);
  console.log(`flash: master drop ${dropAt.toFixed(1)}, guest planned ${log[0].planned.toFixed(1)}, shown ${log[0].shown.toFixed(1)} (frame ${(log[0].shown - log[0].planned).toFixed(1)} ms late)`);
  expect(Math.abs(log[0].planned - dropAt)).toBeLessThan(30);
  expect(log[0].shown - log[0].planned).toBeLessThan(60);
  // ≤ 1 flash per bar (< 3 Hz).
  if (log.length > 1) expect(log[1].planned - log[0].planned).toBeGreaterThan(1500);
  await expect.poll(() => gr.evaluate(() => (window as unknown as W).__guest.flashLog.length), { timeout: 15000 }).toBeGreaterThan(0);
  expect((await gr.evaluate(() => (window as unknown as W).__guest.flashLog))[0].reduced).toBe(true);
  expect(await gr.locator("#flash").evaluate((e) => getComputedStyle(e).opacity)).toBe("0");
  // TV mode on the master shows the same moment big.
  await page.click("#openParty");
  await page.click("#pTv");
  await expect(page.locator("#tv")).toBeVisible();
  await page.click("#tvExit");
});
test("short code join via the lobby (shiftr.io) and master tab reload: guests stay and resync", async ({ page, browser }) => {
  test.setTimeout(150000);
  await startMaster(page, "shiftr.io");
  const p = await ms(page);
  const g = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await g.addInitScript(FAKE_MOTION);
  await g.goto("./guest.html?net=shiftr.io");
  await expect(g.locator("#join")).toBeVisible();
  await checkLayout(g);
  await g.fill("#codeIn", `${p.code.slice(0, 3).toLowerCase()}-${p.code.slice(3)}`);
  await g.click("#codeGo");
  await expect(g.locator("#consent")).toBeVisible({ timeout: 20000 });
  await g.evaluate(() => (window as unknown as W).__dance({ amp: 4 }));
  await g.click("#agree");
  await expect(g.locator("#pocket")).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => (await crowd(page)).n, { timeout: 20000 }).toBe(1);
  const ep0 = await g.evaluate(() => (window as unknown as W).__guest.core().link.ep);
  // Reload: same session from localStorage, new page epoch; the guest keeps its connection.
  await page.reload();
  await expect.poll(async () => (await ms(page))?.nets?.length ?? 0, { timeout: 25000 }).toBeGreaterThan(0);
  expect((await ms(page)).sid).toBe(p.sid);
  await page.click("#closeParty");
  await page.click("#play");
  await expect.poll(() => g.evaluate(() => (window as unknown as W).__guest.core().link.ep), { timeout: 20000 }).not.toBe(ep0);
  await expect.poll(async () => (await crowd(page)).n, { timeout: 25000 }).toBe(1);
  await g.context().close();
});
test("WebRTC fallback (PeerJS signalling, master as hub): a guest joins and counts", async ({ page, browser }) => {
  test.setTimeout(90000);
  const url = await startMaster(page, "peer");
  const { g, joinMs } = await joinGuest(browser, url, { amp: 4 });
  console.log(`PeerJS join ${joinMs} ms`);
  await expect.poll(async () => (await crowd(page)).n, { timeout: 20000 }).toBe(1);
  expect(await g.evaluate(() => (window as unknown as W).__guest.core().link.transport)).toBe("WebRTC (PeerJS)");
  await g.context().close();
});
test("master live layout: everything fits in landscape, party overlay readable", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("./?crowd=live&net=local");
  await expect(page.locator("#party")).toBeVisible();
  await checkLayout(page);
  await page.click("#closeParty");
  await checkLayout(page);
  const fits = await page.evaluate(() => [...document.querySelectorAll(".controls > *")].filter((el) => (el as HTMLElement).offsetParent).every((el) => el.getBoundingClientRect().bottom <= window.innerHeight + 1));
  expect(fits).toBe(true);
});
