import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveAggregator, toCrowd, samplingP, type FeaturePacket } from "../src/aggregate.ts";
import { readiness, unlockRule } from "../src/crowd.ts";
import { ClockSync } from "../src/net/clock.ts";
import { Box, newKey, codeTopic, randomCode, normCode } from "../src/net/crypto.ts";
import { rng } from "../src/rng.ts";
const pkt = (id: string, bar: number, o: Partial<FeaturePacket> = {}): FeaturePacket => ({ id, bar, e: 0.7, ph: 0, R: 0.8, q: 1, pose: "pocket", ...o });
function barOf(n: number, f: (i: number) => Partial<FeaturePacket>, bar = 1, agg = new LiveAggregator()) {
  for (let i = 0; i < n; i++) agg.add(pkt(`d${i}`, bar, f(i)), 1000);
  return agg.finalize(bar, 1000);
}
test("chance correction: random phases at N = 5 give R ≈ 0.4 but S² ≈ 0 on average; false unlocks ≤ 5 %", () => {
  const r = rng(1);
  let unbiased = 0;
  let R = 0;
  let falseUnlocks = 0;
  const runs = 2000;
  for (let k = 0; k < runs; k++) {
    const g = barOf(5, () => ({ ph: r() * Math.PI * 2 }));
    unbiased += (g.m * g.R * g.R - 1) / (g.m - 1);
    R += g.R;
    if (readiness(toCrowd(g)) >= 1) falseUnlocks++;
  }
  assert.ok(R / runs > 0.3 && R / runs < 0.5, `mean R ${R / runs}`);
  assert.ok(Math.abs(unbiased / runs) < 0.03, `mean S² ${unbiased / runs}`);
  assert.ok(falseUnlocks / runs <= 0.05, `false unlocks ${falseUnlocks / runs}`);
});
test("locked phases: S ≈ 1, Rayleigh Z = m·R² large; the drop unlocks for a dancing group", () => {
  const g = barOf(12, (i) => ({ ph: 0.1 * Math.sin(i), e: 0.75 }));
  assert.ok(g.S > 0.95 && g.Z > 10);
  const c = toCrowd(g);
  assert.equal(c.n, 12);
  assert.equal(unlockRule(c.n).mode, "gruppe");
  assert.equal(readiness(c), 1);
});
test("Rayleigh significance is required on top of the musical threshold for measured input", () => {
  // N = 5 with S = 0.6: above the old R-floor but N·R² < 3 → not unlocked.
  const c = { energy: 7, sync: 0.6, participation: 1, n: 5, reports: 5, stability: 0.8 };
  assert.ok(readiness(c) < 1);
  assert.ok(readiness({ ...c, sync: 0.72 }) >= 1);
  // The median own stability Rᵢ must be ≥ 0.5 as well.
  assert.ok(readiness({ ...c, sync: 0.9, stability: 0.3 }) < 1);
});
test("trimmed q-weighted energy: one shaker cannot pull the crowd energy up", () => {
  const calm = barOf(10, () => ({ e: 0.3 }));
  const withShaker = barOf(10, (i) => ({ e: i === 0 ? 1 : 0.3 }));
  assert.ok(Math.abs(calm.E - 3) < 0.3);
  assert.ok(withShaker.E - calm.E < 0.3, `${withShaker.E}`);
  const lowQ = barOf(2, (i) => (i === 0 ? { e: 1, q: 0.1 } : { e: 0.2, q: 1 }));
  assert.ok(lowQ.E < 4);
});
test("participation P and phones-up share U; duplicates are ignored", () => {
  const agg = new LiveAggregator();
  for (let i = 0; i < 10; i++) agg.add(pkt(`d${i}`, 3, { e: i < 6 ? 0.6 : 0.05, pose: i < 4 ? "up" : "pocket" }), 0);
  agg.add(pkt("d0", 3), 0);
  const g = agg.finalize(3, 0);
  assert.equal(g.m, 10);
  assert.ok(Math.abs(g.P - 0.6) < 1e-9);
  assert.ok(Math.abs(g.U - 0.4) < 1e-9);
});
test("presence: hidden pages and dropped devices leave N (not counted as tired)", () => {
  const agg = new LiveAggregator({ windowMs: 5000 });
  for (let i = 0; i < 5; i++) agg.seen(`d${i}`, 0);
  assert.equal(agg.active(1000), 5);
  agg.seen("d0", 1500, false);
  agg.leave("d1");
  assert.equal(agg.active(2000), 3);
  assert.equal(agg.active(7000), 0);
});
test("solo: the single dancer's Rᵢ is the sync; unlock needs Rᵢ ≥ 0.6 for 2 blocks (16 bars)", () => {
  const agg = new LiveAggregator();
  let c = toCrowd(agg.finalize(0, 0));
  for (let b = 1; b <= 16; b++) {
    agg.add(pkt("me", b, { R: 0.7, e: 0.7 }), b * 1000);
    c = toCrowd(agg.finalize(b, b * 1000));
    if (b === 8) assert.ok(readiness(c) < 1 && readiness(c) >= 0.5);
  }
  assert.equal(c.n, 1);
  assert.equal(unlockRule(c.n).mode, "solo");
  assert.ok(Math.abs(c.sync - 0.7) < 1e-9);
  assert.equal(readiness(c), 1);
  agg.add(pkt("me", 17, { R: 0.3 }), 17000);
  assert.ok(readiness(toCrowd(agg.finalize(17, 17000))) < 0.6);
});
test("solo: one missing report (packet loss, late) pauses the streak instead of resetting it", () => {
  const agg = new LiveAggregator();
  let c = toCrowd(agg.finalize(0, 0));
  for (let b = 1; b <= 17; b++) {
    if (b !== 9) agg.add(pkt("me", b, { R: 0.7, e: 0.7 }), b * 1000);
    c = toCrowd(agg.finalize(b, b * 1000));
  }
  assert.equal(c.n, 1);
  assert.equal(readiness(c), 1);
});
test("light moment freezes E", () => {
  const agg = new LiveAggregator();
  barOf(5, () => ({ e: 0.5 }), 1, agg);
  agg.freezeE = 5;
  const g = barOf(5, () => ({ e: 1 }), 2, agg);
  assert.equal(g.E, 5);
  assert.equal(g.frozen, true);
});
test("sampling above the hub threshold: p = K/N and the estimates stay unbiased", () => {
  assert.equal(samplingP(100), 1);
  assert.ok(Math.abs(samplingP(1500) - 0.1) < 1e-9);
  const r = rng(9);
  const agg = new LiveAggregator();
  const N = 2000;
  const p = samplingP(N);
  for (let i = 0; i < N; i++) {
    agg.seen(`d${i}`, 0);
    if (r() < p) agg.add(pkt(`d${i}`, 5, { p, e: i % 2 ? 0.8 : 0.4, ph: (r() - 0.5) * 1.2 }), 0);
  }
  const g = agg.finalize(5, 0);
  assert.equal(g.n, N);
  assert.ok(g.m > 100 && g.m < 200, `m=${g.m}`);
  assert.ok(Math.abs(g.E - 6) < 0.6, `E=${g.E}`);
  assert.ok(g.S > 0.8);
});
test("aggregation cost is O(1) per packet: 100 000 packets in well under a second", () => {
  const agg = new LiveAggregator();
  const t0 = performance.now();
  for (let b = 0; b < 100; b++) {
    for (let i = 0; i < 1000; i++) agg.add(pkt(`d${i}`, b, { ph: i }), b);
    agg.finalize(b, b);
  }
  assert.ok(performance.now() - t0 < 1000);
});
test("clock sync: min-RTT sample wins; error ≤ RTT/2 even with jittery, asymmetric paths", () => {
  const r = rng(4);
  const trueOffset = 123456.7;
  const c = new ClockSync();
  for (let i = 0; i < 10; i++) {
    const t0 = 1000 * i;
    const up = 20 + r() * 200;
    const down = 20 + r() * 200;
    c.add({ t0, tm: t0 + up + trueOffset, t2: t0 + up + down });
  }
  assert.equal(c.count, 10);
  assert.ok(Math.abs(c.offset - trueOffset) <= c.error + 1e-9);
  assert.ok(c.error < 120);
  assert.ok(Math.abs(c.toLocal(c.toMaster(5)) - 5) < 1e-9);
});
test("crypto: AES-GCM round trip, wrong key or other session → null; codes readable", async () => {
  const k = newKey();
  const a = await Box.fromKey(k, "sess1");
  const msg = await a.seal({ t: "f", e: 0.5 });
  assert.deepEqual(await a.open(msg), { t: "f", e: 0.5 });
  assert.equal(await (await Box.fromKey(newKey(), "sess1")).open(msg), null);
  assert.equal(await (await Box.fromKey(k, "sess2")).open(msg), null);
  const code = randomCode(6);
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{6}$/);
  assert.equal(normCode(code.toLowerCase().slice(0, 3) + "-" + code.slice(3)), code);
  assert.notEqual(await codeTopic(code), code);
  const lobby = await Box.fromCode(code, "lobby");
  assert.deepEqual(await (await Box.fromCode(code, "lobby")).open(await lobby.seal({ s: 1 })), { s: 1 });
});
test("light moments: start with a build-up, end 8 bars after the drop, at most 4 per hour", async () => {
  const { lightStep, LM_SPACING_MS } = await import("../src/party.ts");
  let lm = { active: false, lastStart: -Infinity, endBar: -1 };
  let starts = 0;
  const bar = (index: number, section: string, sectionBar: number, buildBlock = 0, drop: string | null = null) => ({ index, section, sectionBar, buildBlock, drop });
  // A build-up every 6 minutes for an hour (more often than allowed).
  for (let k = 0; k < 10; k++) {
    const t = k * 6 * 60000;
    const was = lm.active;
    lm = lightStep(lm, bar(k * 200, "build", 0), t);
    if (lm.active && !was) starts++;
    lm = lightStep(lm, bar(k * 200 + 8, "groove", 0, 0, "freigeschaltet"), t + 15000);
    assert.equal(lm.endBar >= 0 || !lm.active, true);
    lm = lightStep(lm, bar(k * 200 + 16, "groove", 8), t + 30000);
    assert.equal(lm.active, false);
  }
  assert.ok(starts <= 4 && starts >= 3, `starts=${starts}`);
  assert.equal(LM_SPACING_MS, 15 * 60000);
});
