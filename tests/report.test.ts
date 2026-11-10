import { test } from "node:test";
import assert from "node:assert/strict";
import { rng, srng } from "../src/rng.ts";
import { Director, type BarPlan } from "../src/director.ts";
import { presetById } from "../src/curve.ts";
import { SetRunner } from "../src/set.ts";
import { analyze, toCsv, MOVE_AFTER } from "../src/report/analyze.ts";
import { cei, rowCei, type BarRow, type PartyRecord } from "../src/report/model.ts";
import { simulateNight } from "../src/report/demo.ts";
import { loadProfile, saveProfile, tapOffset, clampTv } from "../src/profile.ts";
import { NightLog, summarizeNight, loadNights, saveNight, MAX_NIGHTS } from "../src/report/guest-night.ts";
import { detectClicks } from "../src/calib/mic.ts";
import type { BarMsg } from "../src/net/session.ts";
test("srng = rng (same sequence) and its state can be saved/restored", () => {
  const a = rng(42), b = srng(42);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
  const st = b.state;
  const x = [b(), b(), b()];
  b.state = st;
  assert.deepEqual([b(), b(), b()], x);
});
test("director snapshot (JSON round trip) continues the set bar-for-bar identically", () => {
  const crowd = (i: number) => ({ energy: 3 + 5 * Math.abs(Math.sin(i / 40)), sync: 0.5 + 0.4 * Math.sin(i / 17), participation: 0.8, n: 12 });
  const a = new Director(presetById("1h"), 99);
  for (let i = 0; i < 400; i++) a.step(crowd(i));
  const snap = JSON.parse(JSON.stringify(a.snapshot()));
  const b = Director.restore(snap, presetById("1h"));
  const pa: BarPlan[] = [], pb: BarPlan[] = [];
  for (let i = 400; i < 900; i++) {
    pa.push(a.step(crowd(i)));
    pb.push(b.step(crowd(i)));
  }
  assert.deepEqual(pb, pa);
  assert.deepEqual(b.events, a.events);
  // SetRunner.resume works from a snapshot too.
  const r = new SetRunner({ preset: "1h", seed: 1, crowd: "live" });
  r.resume(snap);
  assert.equal(r.director.bar, 400);
});
const row = (i: number, o: Partial<BarRow> = {}): BarRow => ({ i, t: i * 1.8, w: 1e12 + i * 1800, soll: 5, lvl: 5, E: 5, S: 0.5, P: 0.8, n: 10, ready: 0, sec: "groove", ph: "Aufbau", d: null, mv: null, U: 0, pu: false, ...o });
const rec = (bars: BarRow[]): PartyRecord => ({ v: 1, id: "x", startedAt: bars[0].w, updatedAt: 0, preset: "1h", presetLabel: "", mode: "live", seed: 1, joinedMax: 10, bars, events: [], finished: true });
test("CEI = 100·(0.45·E/10 + 0.35·S + 0.20·P); unmeasured bars are null, not zero", () => {
  assert.equal(cei(10, 1, 1), 100);
  assert.equal(Math.round(cei(5, 0.5, 0.8) * 100) / 100, 22.5 + 17.5 + 16);
  assert.equal(rowCei(row(0, { n: 0 })), null);
});
test("moves: before/after CEI with curve-trend correction → gewirkt / eher nicht / überlagert", () => {
  const bars: BarRow[] = [];
  for (let i = 0; i < 200; i++) bars.push(row(i));
  // Move A at bar 20: the floor rises by 2 energy points afterwards (curve flat) → gewirkt (+9).
  for (let i = 20; i < 36; i++) bars[i].mv = "hats";
  for (let i = 20 + MOVE_AFTER[0]; i < 100; i++) bars[i].E = 7;
  // Move B at bar 120: curve rises by 2 points, the floor by 1 → below expectation → eher nicht.
  for (let i = 120; i < 136; i++) bars[i].mv = "bass";
  for (let i = 112; i < 200; i++) bars[i].E = 7;
  for (let i = 120 + MOVE_AFTER[0]; i < 200; i++) ((bars[i].soll = 7), (bars[i].E = 8));
  const r = analyze(rec(bars));
  assert.equal(r.moves.length, 2);
  const [a, b] = r.moves;
  assert.equal(a.type, "hats");
  assert.equal(a.verdict, "gewirkt");
  assert.equal(a.delta, 9);
  assert.equal(b.expected, 9);
  assert.equal(b.delta, 4.5);
  assert.equal(b.verdict, "eher nicht");
  assert.deepEqual(r.topMoves.map((m) => m.type), ["hats"]);
  assert.deepEqual(r.flopMoves.map((m) => m.type), ["bass"]);
  // A drop inside the window: the effect cannot be attributed to the move.
  bars[30].d = "rettung";
  assert.equal(analyze(rec(bars)).moves[0].verdict, "überlagert");
});
test("drops (type, waiting time), breakdowns, top moments, summary on a simulated night", () => {
  const night = simulateNight("1h", 7);
  const r = analyze(night);
  assert.ok(r.drops.length >= 2, `drops ${r.drops.length}`);
  for (const d of r.drops) assert.ok(d.waitBars >= 8 && d.waitBars <= 24, `wait ${d.waitBars}`);
  assert.equal(r.summary.drops, r.summary.unlocked + r.summary.rescue + r.summary.forced);
  assert.ok(r.breakdowns.length >= 1);
  assert.ok(r.breakdowns.every((b) => b.bars >= 8));
  assert.ok(r.top.length >= 2 && r.top.length <= 3);
  for (let k = 1; k < r.top.length; k++) assert.ok(r.top[k].cei <= r.top[k - 1].cei);
  assert.equal(r.summary.peak, r.top[0]);
  assert.ok(Math.abs(r.minutes.length - 60) <= 1);
  assert.equal(r.summary.maxN, 12);
  assert.equal(r.summary.measuredShare, 1);
  assert.ok(r.moves.length > 3);
  // CSV: header + one line per bar, parseable numbers.
  const csv = toCsv(night).trim().split("\n");
  assert.equal(csv.length, night.bars.length + 1);
  assert.ok(csv[0].startsWith("takt,zeit_s,uhrzeit_iso,soll"));
  assert.equal(csv[1].split(",").length, csv[0].split(",").length);
});
test("nobody counted (n = 0): no CEI, no peak, P/S null – the report does not invent values", () => {
  const r = analyze(rec(Array.from({ length: 64 }, (_, i) => row(i, { n: 0, E: 0, S: 0, P: 0 }))));
  assert.equal(r.summary.avgCei, null);
  assert.equal(r.summary.peak, null);
  assert.equal(r.minutes[0].cei, null);
  assert.equal(r.summary.measuredShare, 0);
});
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
test("party profile: Phase-1 latency migrates; saves merge; tap offset median wraps around the period", () => {
  const s = mem();
  s.setItem("schwarm.latency", "120");
  assert.deepEqual([loadProfile(s).speakerMs, loadProfile(s).speakerHow], [120, "tap"]);
  saveProfile({ tvMs: 80, tvHow: "tap" }, s);
  const p = loadProfile(s);
  assert.equal(p.speakerMs, 120);
  assert.equal(p.tvMs, 80);
  assert.equal(s.getItem("schwarm.latency"), "120");
  const taps = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000].map((t, k) => t + 85 + (k % 3) * 5 - 5);
  assert.equal(tapOffset(taps, 0, 1000), 85);
  assert.equal(tapOffset([990, 1990, 2985, 3995], 0, 1000), -10);
  assert.equal(clampTv(500), 300);
});
const msg = (i: number, o: Partial<BarMsg["crowd"]> = {}, drop: string | null = null, up = false): BarMsg => ({ t: "bar", ep: "e", i, at: 0, bpm: 130, lvl: 5, sec: "groove", phase: "Aufbau", min: 0, preset: "1h", soll: 5, pre: false, drop, dropAt: null, dropType: null, lm: up, up, p: 1, crowd: { n: 4, m: 4, joined: 4, E: 6, S: 0.5, P: 1, U: 0, medR: 0.6, ready: 0, mode: "klein", rule: "", ...o } });
test("guest night: per-minute crowd + own values, drops once, phones-up calls, stored locally (≤ 6 nights)", () => {
  const log = new NightLog("s1");
  const t0 = 1e12;
  for (let b = 0; b < 100; b++) {
    const w = t0 + b * 1846;
    log.bar(msg(b, { E: b < 50 ? 4 : 8, n: b < 50 ? 3 : 5 }, b === 60 ? "freigeschaltet" : null, b >= 55 && b < 58), w);
    log.bar(msg(b, {}, b === 60 ? "freigeschaltet" : null), w); // duplicate delivery
    if (b % 2 === 0) log.me({ e: 0.7, ph: 0, R: b < 50 ? 0.8 : 0.3, q: 1, pose: "pocket", n: 50, period: 1, still: false } as never, w);
  }
  const n = log.night;
  assert.equal(n.drops.length, 1);
  assert.equal(n.maxN, 5);
  assert.equal(n.phonesUp, 1);
  const s = summarizeNight(n);
  assert.equal(s.minutes, 4);
  assert.ok(Math.abs(s.myEnergy! - 7) < 1e-9);
  assert.ok(Math.abs(s.mySync! - 0.5) < 1e-9);
  assert.ok(s.peak! >= 1);
  const st = mem();
  for (let k = 0; k < 8; k++) saveNight({ ...n, start: n.start + k }, st);
  saveNight({ ...n, start: n.start + 7 }, st);
  assert.equal(loadNights(st).length, MAX_NIGHTS);
});
test("mic click onset detection: median delay, spread, missing clicks", () => {
  const sr = 48000, start = 1000;
  const x = new Float32Array(sr * 6);
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.004;
  for (let i = 0; i < x.length; i++) x[i] = noise();
  const clicks = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].map((c) => c + start / sr);
  const delay = [182, 180, 184, 181, 183, 179, 182, 0];
  clicks.forEach((c, k) => {
    if (!delay[k]) return;
    const at = Math.round(c * sr) - start + Math.round((delay[k] / 1000) * sr);
    for (let i = 0; i < 100; i++) x[at + i] = Math.sin(i / 3) * 0.3 * Math.exp(-i / 40) + (i === 0 ? 0.3 : 0);
  });
  const d = detectClicks(x, start, sr, clicks);
  assert.equal(d.found, 7);
  assert.equal(d.delays[7], null);
  assert.ok(Math.abs(d.medianMs! - 182) <= 1, String(d.medianMs));
  assert.ok(d.spreadMs! <= 3);
});
