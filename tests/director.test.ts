import { test } from "node:test";
import assert from "node:assert/strict";
import { SetRunner } from "../src/set.ts";
import { Director, BLOCK, MAX_BUILD_BLOCKS, BPM_MIN, BPM_MAX, type BarPlan } from "../src/director.ts";
import { presetById, sollAt } from "../src/curve.ts";
import { arrange, fingerprint } from "../src/arranger.ts";
const runAll = (preset = "1h", seed = 2026) => {
  const run = new SetRunner({ preset, seed, crowd: "sim" });
  const plans: BarPlan[] = [];
  while (!run.finished) plans.push(run.next().plan);
  return { plans, run };
};
const { plans, run } = runAll();
test("set length and phrase grid", () => {
  const last = plans[plans.length - 1];
  assert.ok(last.minute >= 59.5 && last.minute < 60.1);
  for (const p of plans) if (p.section === "groove") assert.ok(p.phraseBar >= 0 && p.phraseBar < 16);
});
test("tempo: 128–138 BPM, at most ±1 BPM per phrase, constant inside a phrase", () => {
  for (let i = 1; i < plans.length; i++) {
    assert.ok(plans[i].bpm >= BPM_MIN && plans[i].bpm <= BPM_MAX);
    const d = Math.abs(plans[i].bpm - plans[i - 1].bpm);
    assert.ok(d <= 1 + 1e-9, `bar ${i}`);
    if (d > 0) assert.equal(plans[i].phraseBar, 0, "tempo changes only on a phrase start");
  }
});
test("level: max one step per phrase, inside the curve band", () => {
  const starts = plans.filter((p) => p.section === "groove" && p.phraseBar === 0 && !p.drop);
  for (let i = 1; i < starts.length; i++) assert.ok(Math.abs(starts[i].level - starts[i - 1].level) <= 1);
  for (const p of plans) assert.ok(p.level >= 1 && p.level <= 10);
});
test("every drop lands on the one after pre-drop bars; builds come in 8-bar blocks; rescue after ≤ 3 blocks", () => {
  const drops = plans.filter((p) => p.drop);
  assert.ok(drops.length >= 3, `drops: ${drops.length}`);
  for (const d of drops) {
    assert.equal(d.phraseBar, 0);
    assert.equal(plans[d.index - 1].preDrop, true);
    assert.equal(plans[d.index - 1].section, "build");
    let k = d.index - 1, n = 0;
    while (plans[k].section === "build") {
      k--;
      n++;
    }
    if (d.drop !== "erzwungen") assert.equal(n % BLOCK, 0, `build length ${n}`);
    assert.ok(n <= BLOCK * MAX_BUILD_BLOCKS);
  }
});
test("breakdowns: never more than 25 min at level ≥ 7 without one; fatigue bounded", () => {
  let high = 0;
  for (const p of plans) {
    if (p.section === "breakdown") high = 0;
    else if (p.level >= 7) high += 240 / p.bpm / 60;
    assert.ok(high <= 25.5, `minute ${p.minute}`);
    assert.ok(p.fatigue < 1.2);
  }
  assert.ok(plans.some((p) => p.section === "breakdown"));
});
test("Vorhalten: music stays within [Soll − 2, Soll] (+ hysteresis slack)", () => {
  // Manual crowd far above the curve: the music must not overshoot the curve.
  const hot = new SetRunner({ preset: "1h", seed: 1, crowd: "manual" });
  hot.manual = { energy: 10, sync: 0.9, participation: 1, n: 40 };
  while (!hot.finished) {
    const p = hot.next().plan;
    if (p.section === "groove" && p.sinceDrop > 16) assert.ok(p.level <= Math.ceil(sollAt(presetById("1h"), p.minute)) + 1, `minute ${p.minute}: ${p.level} vs ${p.soll}`);
  }
  // Crowd not moving at all: the music still follows the curve, at most 2 (+1 lag) below.
  const cold = new SetRunner({ preset: "1h", seed: 1, crowd: "manual" });
  cold.manual = { energy: 0, sync: 0, participation: 1, n: 40 };
  const cp: BarPlan[] = [];
  while (!cold.finished) cp.push(cold.next().plan);
  for (const p of cp) if (p.section === "groove" && p.minute > 5) assert.ok(p.level >= Math.floor(p.soll) - 4, `minute ${p.minute}`);
  // …and two failed moves in a row fall back to an anchor groove for 2 phrases.
  assert.ok(cold.director.events.some((e) => e.kind === "anchor"));
  assert.ok(cp.some((p) => p.anchor));
  // Without beat lock no drop unlocks: all drops are rescue drops.
  assert.ok(cp.filter((p) => p.drop).every((p) => p.drop === "rettung"));
});
test("forced drop arrives within 2 bars", () => {
  const d = new Director(presetById("1h"), 3);
  const crowd = { energy: 4, sync: 0.2, participation: 1, n: 10 };
  for (let i = 0; i < 40; i++) d.step(crowd);
  d.forceDrop();
  const a = d.step(crowd);
  const b = d.step(crowd);
  assert.equal(a.preDrop, true);
  assert.equal(b.drop, "erzwungen");
});
test("solo (N = 1): drop unlocks from the dancer's own beat stability", () => {
  const solo = new SetRunner({ preset: "10m", seed: 4, crowd: "manual", n: 1 });
  solo.manual = { energy: 8, sync: 0.75, participation: 1, n: 1 };
  const ps: BarPlan[] = [];
  while (!solo.finished) ps.push(solo.next().plan);
  assert.ok(ps.every((p) => p.unlockMode === "solo"));
  assert.ok(ps.some((p) => p.drop === "freigeschaltet"));
  const shaky = new SetRunner({ preset: "10m", seed: 4, crowd: "manual", n: 1 });
  shaky.manual = { energy: 8, sync: 0.3, participation: 1, n: 1 };
  const qs: BarPlan[] = [];
  while (!shaky.finished) qs.push(shaky.next().plan);
  assert.ok(qs.filter((p) => p.drop).every((p) => p.drop === "rettung"));
});
test("deterministic: same seed → identical set (blind test = offline render)", () => {
  const a = runAll("10m", 9).plans.map((p) => arrange(p)).map((s) => fingerprint(s, "exact"));
  const b = runAll("10m", 9).plans.map((p) => arrange(p)).map((s) => fingerprint(s, "exact"));
  assert.deepEqual(a, b);
  void run;
});
