// Screenshots of all three screens (landscape 844×390 and portrait 390×844) against a running server.
//   node tools/shots.ts <baseUrl> <outDir>
import { chromium, type Page } from "@playwright/test";
const [base = "http://127.0.0.1:4180/", out = "/workspace/schwarm/shots"] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const VPS = [
  { name: "844x390", width: 844, height: 390 },
  { name: "390x844", width: 390, height: 844 },
];
const page = async (w: number, h: number) => browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
async function main(vp: (typeof VPS)[number]) {
  const p = await page(vp.width, vp.height);
  await p.goto(base);
  await p.click("button[data-preset='10m']");
  await p.click("#modeSim");
  await p.click("#play");
  await p.waitForTimeout(80000);
  await p.click("#drop");
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/main-dropqueued-${vp.name}.png` });
  await p.waitForFunction(() => document.getElementById("phase")?.textContent === "Drop", null, { timeout: 15000 });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/main-${vp.name}.png`, fullPage: vp.height > vp.width });
  await p.close();
}
async function test(vp: (typeof VPS)[number]) {
  const p = await page(vp.width, vp.height);
  await p.goto(`${base}test.html`);
  await p.screenshot({ path: `${out}/test-start-${vp.name}.png` });
  const q = await page(vp.width, vp.height);
  await q.goto(`${base}test.html?zeitraffer=600`);
  await q.fill("#listener", "H07");
  await q.click("#mode button[data-v='playlist']");
  await q.fill("#playlist", "Kuratiert Techno 1");
  await q.click("#start");
  await q.click("#bored");
  await q.waitForSelector("#rate:not([hidden])");
  await q.evaluate(() => document.querySelector(".run")?.scrollIntoView());
  await q.screenshot({ path: `${out}/test-running-${vp.name}.png` });
  await p.close();
  await q.close();
}
async function guest(vp: (typeof VPS)[number]) {
  const p: Page = await page(vp.width, vp.height);
  await p.goto(`${base}guest.html`);
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${out}/guest-${vp.name}.png` });
  await p.locator("#sN").fill("0.86");
  await p.locator("#sS").fill("0.82");
  await p.click("#sPhase button[data-v='Build-up']");
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/guest-1500-buildup-${vp.name}.png` });
  await p.locator("#sN").fill("0");
  await p.locator("#sMs").fill("0.45");
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/guest-solo-${vp.name}.png` });
  await p.click("#toPocket");
  await p.screenshot({ path: `${out}/guest-pocket-${vp.name}.png` });
  await p.close();
}
const only = process.env.SHOTS; // e.g. SHOTS=guest
await Promise.all([
  ...(!only || only === "main" ? VPS.map(main) : []),
  ...(!only || only === "test" ? VPS.map(test) : []),
  ...(!only || only === "guest" ? VPS.map(guest) : []),
]);
await browser.close();
console.log("shots done");
