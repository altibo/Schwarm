import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, presetById, sollAt, curvePhase } from "../src/curve.ts";
import { CrowdAggregate, unlockRule, readiness, sliderToN, nToSlider, N_MAX } from "../src/crowd.ts";
test("presets: 60 min one wave, 3 h two waves", () => {
  assert.equal(presetById("1h").minutes, 60);
  assert.equal(presetById("3h").minutes, 180);
  const peaks = (id: string) => {
    const p = presetById(id);
    let n = 0;
    for (let m = 1; m < p.minutes; m++) if (sollAt(p, m) > sollAt(p, m - 1) && sollAt(p, m) >= sollAt(p, m + 1) && sollAt(p, m) > 8) n++;
    return n;
  };
  assert.equal(peaks("1h"), 1);
  assert.equal(peaks("3h"), 2);
  for (const p of PRESETS) for (let m = 0; m <= p.minutes; m += 0.5) assert.ok(sollAt(p, m) >= 0 && sollAt(p, m) <= 10);
  assert.equal(curvePhase(presetById("1h"), 1), "Warm-up");
  assert.equal(curvePhase(presetById("1h"), 42), "Peak");
  assert.equal(curvePhase(presetById("1h"), 56), "Ausklang");
});
test("aggregate: O(1) streaming sums, N = 1 uses own beat stability", () => {
  const solo = new CrowdAggregate();
  solo.add({ energy: 7, phase: 1.2, stability: 0.4 });
  assert.equal(solo.result().n, 1);
  assert.equal(solo.result().sync, 0.4); // Rayleigh R would be 1 for one phase: meaningless
  const big = new CrowdAggregate();
  for (let i = 0; i < 10000; i++) big.add({ energy: 6, phase: (i % 100) * 0.0628, stability: 0.9 });
  const r = big.result();
  assert.equal(r.n, 10000);
  assert.ok(r.sync < 0.05, "uniform phases → R ≈ 0");
  const locked = new CrowdAggregate();
  for (let i = 0; i < 500; i++) locked.add({ energy: 8, phase: 0.1, stability: 0.2 });
  locked.add({ energy: 0, phase: 0, stability: 0, counts: false });
  assert.ok(locked.result().sync > 0.99);
  assert.ok(Math.abs(locked.result().participation - 500 / 501) < 1e-9);
});
test("unlock rule changes with N: solo, small group, Rayleigh threshold falls with N", () => {
  assert.equal(unlockRule(1).mode, "solo");
  assert.equal(unlockRule(3).mode, "klein");
  assert.equal(unlockRule(5).mode, "gruppe");
  assert.ok(unlockRule(5).syncMin > unlockRule(50).syncMin);
  assert.equal(unlockRule(5000).syncMin, 0.35);
  assert.equal(readiness({ energy: 7, sync: 0.7, participation: 0, n: 1 }), 1);
  assert.ok(readiness({ energy: 7, sync: 0.3, participation: 1, n: 1 }) < 1);
  assert.equal(readiness({ energy: 7, sync: 0.5, participation: 0.2, n: 100 }) < 1, true, "participation counts for groups");
});
test("log slider for 'Anzahl Tänzer' spans 1 … 5000", () => {
  assert.equal(sliderToN(0), 1);
  assert.equal(sliderToN(1), N_MAX);
  for (const n of [1, 12, 150, 1000]) assert.ok(Math.abs(sliderToN(nToSlider(n)) - n) <= Math.max(1, n * 0.01));
});
