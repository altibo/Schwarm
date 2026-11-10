import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { watchErrors, checkLayout } from "./helpers.ts";
test.use({ viewport: { width: 390, height: 844 } });
test("blind test page states it is a test and fits the phone", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("./test.html");
  await expect(page.locator(".test-badge")).toContainText("TEST");
  await expect(page.locator(".intro")).toContainText("Das ist ein Test");
  await checkLayout(page);
  expect(errors).toEqual([]);
});
test("playlist mode: rating every 10 min, Langweilig logged, JSON + CSV export", async ({ page }) => {
  await page.goto("./test.html?zeitraffer=600");
  await page.fill("#listener", "T01");
  await page.click("#mode button[data-v='playlist']");
  await page.fill("#playlist", "Kuratiert 1");
  await page.click("#start");
  await page.click("#bored");
  await expect(page.locator("#boredInfo")).toContainText("Getippt");
  await expect(page.locator("#rate")).toBeVisible({ timeout: 5000 });
  await page.locator("#rateBtns button", { hasText: /^7$/ }).click();
  await expect(page.locator("#rate")).toBeHidden();
  page.once("dialog", (d) => d.accept());
  await page.click("#start");
  await expect(page.locator("#list .item")).toHaveCount(1);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#exportJson")]);
  const data = JSON.parse(readFileSync(await dl.path(), "utf8"));
  expect(data[0].schema).toBe("schwarm-blindtest/1");
  expect(data[0].mode).toBe("playlist");
  expect(data[0].ratings[0].value).toBe(7);
  expect(data[0].bored.length).toBe(1);
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.click("#exportCsv")]);
  const csv = readFileSync(await dl2.path(), "utf8");
  expect(csv.split("\n")[0]).toContain("test_id,hoerer");
  expect(csv).toContain("langweilig");
  // gate calculator accepts the export
  await page.setInputFiles("#files", await dl.path());
  await expect(page.locator("#gate")).toContainText("Urteil");
});
test("Set A mode plays the fixed set and logs what was playing at a Langweilig tap", async ({ page }) => {
  await page.goto("./test.html");
  await page.click("#start");
  await page.waitForTimeout(4500);
  await page.click("#bored");
  const st = await page.evaluate(() => (window as unknown as { __blindtest: { state(): { run: { bored: { bar?: number; phase?: string }[]; seed: number } } } }).__blindtest.state());
  expect(st.run.seed).toBe(2026);
  expect(st.run.bored[0].bar).toBeGreaterThanOrEqual(0);
  expect(st.run.bored[0].phase).toBeTruthy();
  // the listener does not see the phase/level
  await expect(page.locator("body")).not.toContainText("Warm-up");
});
