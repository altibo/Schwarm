// Phase 2: "Nach der Nacht" report, story cards (master + guest), TV flash calibration, mic
// click measurement (loopback), party profile, resume after a master reload.
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { watchErrors, checkLayout } from "./helpers.ts";
import { FAKE_MOTION } from "./fake-motion.ts";
import { FAKE_MIC } from "./fake-mic.ts";
test.describe.configure({ mode: "serial" });
type W = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const st = (page: Page) => page.evaluate(() => (window as unknown as W).__schwarm.state());
const imgSize = (page: Page, sel: string) => page.locator(sel).evaluate(async (el: HTMLImageElement) => (await el.decode(), [el.naturalWidth, el.naturalHeight]));
test("Nach der Nacht: example night → summary, charts, drops, moves, story card, CSV/JSON export, delete", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./report.html");
  await expect(page.locator("#list")).toBeVisible();
  await page.click("#demo");
  await expect(page.locator("#detail")).toBeVisible();
  await expect(page.locator("#dMode")).toContainText("simulierter");
  await expect(page.locator("#dTiles .rtile")).toHaveCount(11);
  await expect(page.locator("#dDrops tr")).not.toHaveCount(1);
  expect(await page.locator("#dDrops tr").count()).toBeGreaterThan(2);
  expect(await page.locator("#dMoves tr").count()).toBeGreaterThan(3);
  await expect(page.locator("#dTop li")).not.toHaveCount(0);
  // Charts are drawn (non-empty pixels).
  const ink = await page.locator("#cEnergy").evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n / (d.length / 4);
  });
  expect(ink).toBeGreaterThan(0.05);
  expect(await imgSize(page, "#cardImg")).toEqual([1080, 1920]);
  await checkLayout(page);
  const [csv] = await Promise.all([page.waitForEvent("download"), page.click("#exCsv")]);
  expect(csv.suggestedFilename()).toMatch(/^schwarm-.*\.csv$/);
  const lines = readFileSync((await csv.path())!, "utf8").trim().split("\n");
  expect(lines[0]).toContain("takt,zeit_s,uhrzeit_iso,soll");
  expect(lines.length).toBeGreaterThan(1500);
  const [json] = await Promise.all([page.waitForEvent("download"), page.click("#exJson")]);
  const j = JSON.parse(readFileSync((await json.path())!, "utf8"));
  expect(j.mode).toBe("sim");
  expect(j.report.drops).toBeGreaterThan(1);
  const [png] = await Promise.all([page.waitForEvent("download"), page.click("#dlCard")]);
  expect(png.suggestedFilename()).toMatch(/karte\.png$/);
  // Two-step delete.
  await page.click("#back");
  await expect(page.locator("#parties li")).toHaveCount(1);
  await page.click("#parties li button");
  await page.click("#del");
  await expect(page.locator("#del")).toContainText("Wirklich");
  await page.click("#del");
  await expect(page.locator("#list")).toBeVisible();
  await expect(page.locator("#parties li")).toHaveCount(0);
  await expect(page.locator("#empty")).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  await checkLayout(page);
  expect(errors).toEqual([]);
});
test("live night: master + 2 guests → recorded locally (N, drop), report says Live, guest gets its own card + past-nights list", async ({ page }) => {
  test.setTimeout(150000);
  const errors = watchErrors(page);
  await page.goto("./?crowd=live&net=local");
  await expect.poll(async () => (await st(page)).party?.nets?.length ?? 0, { timeout: 20000 }).toBeGreaterThan(0);
  const url: string = (await st(page)).party.url;
  await page.click("#pStart");
  await expect.poll(async () => (await st(page)).bars, { timeout: 15000 }).toBeGreaterThan(0);
  const guests: Page[] = [];
  for (let k = 0; k < 2; k++) {
    const g = await page.context().newPage();
    await g.setViewportSize({ width: 390, height: 844 });
    await g.addInitScript(FAKE_MOTION);
    await g.goto(url);
    await g.evaluate(() => (window as unknown as W).__dance({ amp: 5 }));
    await g.click("#agree");
    await expect(g.locator("#pocket")).toBeVisible({ timeout: 20000 });
    guests.push(g);
  }
  await expect.poll(async () => (await st(page)).party.crowd.n, { timeout: 20000 }).toBe(2);
  await page.bringToFront();
  await page.waitForTimeout(8000);
  await page.click("#drop");
  await expect.poll(async () => (await st(page)).events.some((e: { kind: string }) => e.kind === "drop"), { timeout: 15000 }).toBe(true);
  await page.waitForTimeout(4000);
  await page.click("#play"); // stop → saved
  const rec = await page.evaluate(() => (window as unknown as W).__schwarm.recorder());
  expect(rec.mode).toBe("live");
  expect(Math.max(...rec.bars.map((b: { n: number }) => b.n))).toBe(2);
  expect(rec.bars.some((b: { d: string | null }) => b.d === "erzwungen")).toBe(true);
  // Guest: personal card from its own sensor + the crowd values it received.
  const g = guests[0];
  const night = await g.evaluate(() => (window as unknown as W).__guest.night());
  expect(night.maxN).toBe(2);
  expect(night.drops.length).toBe(1);
  expect(night.minutes.reduce((a: number, m: { meBars: number }) => a + m.meBars, 0)).toBeGreaterThan(3);
  const box = (await g.locator("#showStats").boundingBox())!;
  await g.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await g.mouse.down();
  await g.waitForTimeout(2300);
  await g.mouse.up();
  await g.click("#myCard");
  await expect(g.locator("#cardView")).toBeVisible();
  expect(await imgSize(g, "#gCardImg")).toEqual([1080, 1920]);
  await checkLayout(g);
  await g.click("#gCardClose");
  await g.click("#leave");
  await expect(g.locator("#cardView")).toBeVisible();
  await g.click("#gCardClose");
  await expect(g.locator("#nights li")).toHaveCount(1);
  await expect(g.locator("#nights li")).toContainText("1 Drop");
  // Master report page lists the live night.
  const r = await page.context().newPage();
  await r.goto("./report.html");
  await expect(r.locator("#parties li").first()).toContainText("Live gemessen");
  await r.click("#parties li button");
  await expect(r.locator("#dMode")).toBeHidden();
  await expect(r.locator("#dDrops")).toContainText("erzwungen");
  expect(errors).toEqual([]);
});
test("master reload: the party resumes at the same point of the curve (director state restored), record continues", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto("./");
  await page.click("#modeSim");
  await page.click("#play");
  await expect.poll(async () => (await st(page)).bars, { timeout: 30000 }).toBeGreaterThanOrEqual(9);
  const before = await st(page);
  const recId = (await page.evaluate(() => (window as unknown as W).__schwarm.recorder())).id;
  await page.reload();
  await expect(page.locator("#resume")).toBeVisible();
  await expect(page.locator("#resumeTxt")).toContainText("fortsetzen");
  await checkLayout(page);
  await page.click("#resumeGo");
  await expect.poll(async () => (await st(page)).bars, { timeout: 15000 }).toBeGreaterThan(0);
  const after = await st(page);
  // Continues from the saved snapshot (≤ 4 bars + look-ahead back), not from bar 0.
  expect(after.current.index).toBeGreaterThan(before.current.index - 8);
  expect(after.current.index).toBeGreaterThanOrEqual(8);
  expect(await page.evaluate(() => (window as unknown as W).__schwarm.recorder().id)).toBe(recId);
  await page.click("#play");
  // "Neu beginnen" discards it.
  await page.reload();
  await page.click("#resumeNo");
  await page.reload();
  await expect(page.locator("#resume")).toBeHidden();
});
test("TV light surface: flash calibration by 8 taps (+80 ms) or slider, stored in the party profile; the master flash is drawn that much early", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto("./?crowd=live&net=local");
  await expect(page.locator("#profTxt")).toContainText("noch nicht eingemessen");
  await page.click("#tvCalOpen");
  await expect(page.locator("#tvcal")).toBeVisible();
  await expect(page.locator(".hint-tv")).toContainText("kein Casting oder AirPlay, Spielmodus an");
  await checkLayout(page);
  // Tap 8× at flash + 80 ms (the flash schedule is ref + k·1000 ms in performance time).
  await page.evaluate(async () => {
    const cal = (window as unknown as W).__schwarm.tvCal;
    const el = document.getElementById("tvcalFlash")!;
    for (let k = 1; k <= 8; k++) {
      const at = cal.ref + k * 1000 + 80;
      await new Promise((r) => setTimeout(r, Math.max(0, at - performance.now())));
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    }
  });
  const p = await page.evaluate(() => (window as unknown as W).__schwarm.profile());
  expect(p.tvHow).toBe("tap");
  expect(Math.abs(p.tvMs - 80)).toBeLessThanOrEqual(20);
  await expect(page.locator("#tvcalCount")).toContainText("Gemessen");
  await page.locator("#tvMs").fill("120");
  expect((await page.evaluate(() => (window as unknown as W).__schwarm.profile())).tvMs).toBe(120);
  await page.click("#tvcalDone");
  // Speaker not calibrated yet → still "noch nicht eingemessen"; tap the beat once and it is.
  await page.click("#pStart");
  await expect.poll(async () => (await st(page)).bars, { timeout: 15000 }).toBeGreaterThan(1);
  await page.click("#openParty");
  for (let k = 0; k < 8; k++) {
    await page.click("#tap");
    await page.waitForTimeout(240);
  }
  await expect(page.locator("#profTxt")).toContainText("Party-Profil geladen");
  await expect(page.locator("#profTxt")).toContainText("TV 120 ms");
  await page.click("#pTv");
  await page.evaluate(() => (window as unknown as W).__schwarm.engine.runner.director.forceDrop());
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__schwarm.masterFlashLog.length), { timeout: 15000 }).toBeGreaterThan(0);
  const f = (await page.evaluate(() => (window as unknown as W).__schwarm.masterFlashLog))[0];
  expect(f.tvMs).toBe(120);
  expect(f.planned - f.drawn).toBeGreaterThan(120 - 40);
  expect(f.planned - f.drawn).toBeLessThan(120 + 10);
  // TV colour follows energy: the CSS variables are set.
  expect(await page.locator("#tv").evaluate((e) => getComputedStyle(e).getPropertyValue("--tvglow"))).not.toBe("");
  // Second start: profile survives a reload.
  await page.goto("./?crowd=live&net=local");
  await expect(page.locator("#profTxt")).toContainText("Party-Profil geladen");
  await expect(page.locator("#resumeNo")).toBeVisible();
  await page.click("#resumeNo");
});
test("mic click measurement (loopback: speaker → 150 ms → 'mic'), warnings shown, result stored in the profile; denied mic is reported honestly", async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(FAKE_MIC);
  await page.goto("./?crowd=live&net=local");
  await page.click("#micOpen");
  await expect(page.locator("#mic")).toBeVisible();
  await expect(page.locator(".warn-bt")).toContainText("Freisprech");
  await expect(page.locator(".mic-box")).toContainText("eingebauten Mikrofon");
  await checkLayout(page);
  await page.click("#micGo");
  await expect(page.locator("#micRes")).toContainText(/Gemessen|Klicks|unsicher/, { timeout: 20000 });
  const txt = await page.locator("#micRes").textContent();
  const total = Number(/Gemessen: (\d+) ms/.exec(txt ?? "")?.[1]);
  console.log(`mic loopback: ${txt}`);
  expect(total).toBeGreaterThanOrEqual(145);
  expect(total).toBeLessThan(320);
  await page.click("#micUse");
  const p = await page.evaluate(() => (window as unknown as W).__schwarm.profile());
  expect(p.speakerHow).toBe("mic");
  expect(p.micTotalMs).toBe(total);
  await expect(page.locator("#profTxt")).toContainText("per Mikrofon");
  await page.evaluate(() => ((window as unknown as W).__micDeny = true));
  await page.click("#micOpen");
  await page.click("#micGo");
  await expect(page.locator("#micRes")).toContainText("Mikrofon nicht erlaubt");
  await expect(page.locator("#micUse")).toBeDisabled();
});
