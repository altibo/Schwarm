import { test } from "node:test";
import assert from "node:assert/strict";
import { SetRunner } from "../src/set.ts";
import { fingerprint, type Score } from "../src/arranger.ts";
import { evaluateGate, toCsv, minutesToBoredom, type BlindResult } from "../src/gate.ts";
const scores: Score[] = [];
const run = new SetRunner({ preset: "1h", seed: 2026, crowd: "sim" });
while (!run.finished) scores.push(run.next());
test("events stay on the bar grid; breakdowns have no kick; grooves keep four on the floor", () => {
  for (const s of scores) {
    for (const e of s.events) assert.ok(e.step >= 0 && e.step < 16, `${e.voice} ${e.step}`);
    const kicks = s.events.filter((e) => e.voice === "kick").map((e) => e.step);
    if (s.plan.section === "breakdown") assert.equal(kicks.length, 0);
    if (s.plan.section === "groove" && s.plan.fill !== "kickout") for (const k of [0, 4, 8, 12]) assert.ok(kicks.includes(k));
  }
});
test("drop bar: crash + impact on the one; last pre-drop bar has a gap from step 14", () => {
  for (const s of scores.filter((x) => x.plan.drop)) {
    assert.ok(s.events.some((e) => e.voice === "impact" && e.step === 0));
    assert.ok(s.events.some((e) => e.voice === "crash" && e.step === 0));
    const prev = scores[s.plan.index - 1];
    assert.equal(prev.auto.gapAt, 14);
    assert.ok(prev.events.every((e) => e.step < 14));
  }
});
test("variation: many distinct bars per 10 minutes, no long exact loops", () => {
  for (let w = 0; w < 60; w += 10) {
    const win = scores.filter((s) => s.plan.minute >= w && s.plan.minute < w + 10);
    const distinct = new Set(win.map((s) => fingerprint(s))).size;
    assert.ok(distinct >= 120, `${w}–${w + 10} min: ${distinct} distinct of ${win.length}`);
  }
  let run1 = 1, best = 1;
  for (let i = 1; i < scores.length; i++) {
    run1 = fingerprint(scores[i]) === fingerprint(scores[i - 1]) ? run1 + 1 : 1;
    best = Math.max(best, run1);
  }
  assert.ok(best <= 4, `identical consecutive bars: ${best}`);
});
test("hymn of the night returns in the wave", () => {
  assert.ok(scores.filter((s) => s.events.some((e) => e.layer === "lead")).length > 40);
});
const res = (mode: BlindResult["mode"], bored: number | null, ratings: number[], id: string): BlindResult => ({
  schema: "schwarm-blindtest/1", id, listener: id, playback: "Kopfhörer", mode, pack: null, preset: null, seed: null, playlistName: mode === "playlist" ? "P, \"1\"" : null,
  startedAt: "2026-11-10T12:00:00Z", durationSec: 3600, plannedSec: 3600, finished: true,
  bored: bored === null ? [] : [{ t: bored * 60 }], ratings: ratings.map((v, i) => ({ due: (i + 1) * 600, t: (i + 1) * 600 + 3, value: v })), userAgent: "test",
});
test("gate: ≥ 45 min to boredom and ≥ 80 % of the playlist score; < 65 % is no-go", () => {
  const many = (mode: BlindResult["mode"], b: number | null, r: number[]) => Array.from({ length: 10 }, (_, i) => res(mode, b, r, `${mode}${i}`));
  assert.equal(evaluateGate([...many("schwarm", 50, [7, 7]), ...many("playlist", null, [8, 8])]).verdict, "bestanden");
  assert.equal(evaluateGate([...many("schwarm", 30, [7, 7]), ...many("playlist", null, [8, 8])]).verdict, "grauzone");
  assert.equal(evaluateGate([...many("schwarm", null, [4, 4]), ...many("playlist", null, [8, 8])]).verdict, "no-go");
  assert.equal(evaluateGate([res("schwarm", 50, [7], "a"), res("playlist", null, [8], "b")]).verdict, "grauzone", "fewer than 10 listeners is only preliminary");
  assert.equal(evaluateGate([res("schwarm", 50, [7], "a")]).verdict, "zu wenig daten");
  assert.equal(minutesToBoredom(res("schwarm", null, [5], "x")), 60);
});
test("CSV export: one row per tap and rating, quoted cells", () => {
  const csv = toCsv([res("playlist", 12.5, [6, 7], "p1")]);
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 1 + 1 + 2 + 1);
  assert.match(lines[0], /^test_id,hoerer,wiedergabe,modus/);
  assert.ok(csv.includes('"P, ""1"""'));
  assert.ok(lines.some((l) => l.includes(",langweilig,750.0,12.50,")));
});
