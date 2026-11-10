// Offline render: runs the real Web Audio graph in headless Chromium (OfflineAudioContext) in
// chunks with a 20 s pre-roll, writes 16-bit WAV + plan JSON. Usage:
//   node tools/render.ts <preset> <seed> <outBase> [sampleRate]
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { openSync, writeSync, closeSync, writeFileSync } from "node:fs";
const [preset = "1h", seedArg = "2026", outBase = "/workspace/schwarm/renders/schwarm-1h", srArg = "44100", stem = ""] = process.argv.slice(2);
// stem "kick": render only the kick voice (used to measure beat accuracy without other sounds)
const genre = process.env.GENRE || undefined;
const ALL = ["hbass", "donk", "roll", "hoover", "reese", "rstab", "chop", "pluck", "clapx", "revcrash", "zap", "drum", "noisehat", "sub", "fm", "saw", "acid", "pad", "stab", "lead", "riser", "crash", "impact", "downlifter", "atmos", "rumble"];
const seed = Number(seedArg), sr = Number(srArg);
const server = await createServer({ server: { port: 5199, strictPort: false, hmr: false, watch: null }, logLevel: "error" });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? "http://localhost:5199/";
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => m.type() === "error" && console.error("page:", m.text()));
await page.goto(`${url}render.html`);
await page.waitForFunction(() => document.body.textContent === "render ready");
if (stem === "kick") await page.evaluate((skip) => ((window as never as { __skip: string[] }).__skip = skip), ALL);
// ONLY=a,b: render only these voices/layers (balance check of single elements)
const only = (process.env.ONLY ?? "").split(",").filter(Boolean);
const LAYERS = ["kick", "bass", "reese", "hats", "openhat", "ride", "clap", "snare", "perc", "perc2", "hook", "hook2", "stab", "chop", "pad", "atmos", "fill", "fx", "drum", "acid", "lead"];
if (only.length) await page.evaluate((skip) => ((window as never as { __skip: string[] }).__skip = skip), [...ALL, ...LAYERS, "hkick", "kick"].filter((x) => !only.includes(x)).concat("rumble"));
const plan = await page.evaluate(([p, s, g]) => (window as never as { schwarm: { prepare: (a: string, b: number, g?: string) => unknown } }).schwarm.prepare(p as string, s as number, (g as string) || undefined), [preset, seed, genre ?? ""]) as { total: number; bars: unknown[] };
writeFileSync(`${outBase}.plan.json`, JSON.stringify({ preset, seed, genre: genre ?? "default", sampleRate: sr, ...plan }));
const total = plan.total;
const CH = 120;
const fd = openSync(`${outBase}.wav`, "w");
const frames = Math.round(total * sr);
const header = Buffer.alloc(44);
header.write("RIFF", 0); header.writeUInt32LE(36 + frames * 4, 4); header.write("WAVE", 8); header.write("fmt ", 12);
header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22); header.writeUInt32LE(sr, 24);
header.writeUInt32LE(sr * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(frames * 4, 40);
writeSync(fd, header);
let peak = 0, clipped = 0, voices = 0;
const t0 = Date.now();
for (let s = 0; s < total; s += CH) {
  const e = Math.min(total, s + CH);
  const r = await page.evaluate(([a, b, c]) => (window as never as { schwarm: { renderChunk: (a: number, b: number, c: number) => Promise<{ b64: string; peak: number; clipped: number; voices: number }> } }).schwarm.renderChunk(a, b, c), [s, e, sr]);
  writeSync(fd, Buffer.from(r.b64, "base64"));
  peak = Math.max(peak, r.peak); clipped += r.clipped; voices += r.voices;
  process.stdout.write(`\r${(e / 60).toFixed(1)} / ${(total / 60).toFixed(1)} min  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
closeSync(fd);
writeFileSync(`${outBase}.render.json`, JSON.stringify({ preset, seed, sampleRate: sr, seconds: total, floatPeak: peak, clippedSamples: clipped, voices, renderSeconds: (Date.now() - t0) / 1000 }, null, 1));
console.log(`\npeak ${peak.toFixed(4)} clipped ${clipped} voices ${voices}`);
await browser.close();
await server.close();
