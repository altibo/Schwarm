import { test } from "node:test";
import assert from "node:assert/strict";
import { MotionFeatures, type BarFeatures } from "../src/sense.ts";
import { rng } from "../src/rng.ts";
const BEAT = 60000 / 128;
const BAR = 4 * BEAT;
const TAU = Math.PI * 2;
/** Feed `bars` bars of a synthetic dancer (vertical acceleration f(t)) and return the last bar's features. */
function dance(f: (t: number) => number, o: { bars?: number; fallback?: boolean; noise?: number; tilt?: number; pocket?: boolean; flat?: boolean } = {}): BarFeatures {
  const m = new MotionFeatures();
  const r = rng(11);
  const noise = o.noise ?? 0.3;
  const bars = o.bars ?? 8;
  let last: BarFeatures | null = null;
  const gy = o.flat ? 0 : 9.81 * (o.tilt ?? 0.7);
  const gz = o.flat ? 9.81 : 9.81 * Math.sqrt(Math.max(0, 1 - (o.tilt ?? 0.7) ** 2));
  for (let t = 0; t < bars * BAR; t += 1000 / 60) {
    const v = f(t) + (r() - 0.5) * noise;
    const lin = { x: (r() - 0.5) * noise, y: (v * gy) / 9.81, z: (v * gz) / 9.81 };
    m.push({ t, acc: o.fallback ? null : lin, accG: { x: lin.x, y: gy + lin.y, z: gz + lin.z } });
    const b = Math.floor(t / BAR);
    if (Math.floor((t + 1000 / 60) / BAR) > b) last = m.bar(b * BAR, (b + 1) * BAR, BEAT, { pocket: o.pocket });
  }
  return last!;
}
test("on-beat bouncing: high Rᵢ, period 1 beat, phase ≈ 0, energy scales with RMS", () => {
  const f = dance((t) => 3 * Math.cos((TAU * t) / BEAT));
  assert.ok(f.R > 0.9, `R=${f.R}`);
  assert.equal(f.period, 1);
  assert.ok(Math.abs(f.ph) < 0.2);
  const soft = dance((t) => 1 * Math.cos((TAU * t) / BEAT));
  assert.ok(soft.e < f.e && f.e <= 1);
});
test("half-time and eighth bouncing still count as in time (period ½ and 2 beats)", () => {
  assert.equal(dance((t) => 3 * Math.cos((TAU * t) / (2 * BEAT))).period, 2);
  const eighths = dance((t) => 2 * Math.cos((TAU * t) / (BEAT / 2)));
  assert.equal(eighths.period, 0.5);
  assert.ok(eighths.R > 0.9);
});
test("a quarter beat late shows as phase ≈ π/2, Rᵢ stays high (no offset needed for Rᵢ)", () => {
  const f = dance((t) => 3 * Math.cos((TAU * t) / BEAT - Math.PI / 2));
  assert.ok(Math.abs(f.ph - Math.PI / 2) < 0.2);
  assert.ok(f.R > 0.9);
});
test("off-tempo movement and random wobble have low Rᵢ (anti-cheat: shaking lifts E, not R)", () => {
  assert.ok(dance((t) => 3 * Math.cos((TAU * t) / (60000 / 117))).R < 0.3);
  const r = rng(5);
  let v = 0;
  const wobble = dance(() => (v = v * 0.9 + (r() - 0.5) * 3));
  assert.ok(wobble.R < 0.45, `R=${wobble.R}`);
  const shake = dance(() => (r() - 0.5) * 30);
  assert.ok(shake.e > 0.9 && shake.R < 0.45);
});
test("standing still: energy ≈ 0; flat on a table for 60 s → pose table, does not count", () => {
  const still = dance(() => 0, { noise: 0.02 });
  assert.ok(still.e < 0.02);
  const table = dance(() => 0, { noise: 0.02, flat: true, bars: 36 });
  assert.equal(table.pose, "table");
  assert.equal(table.still, true);
});
test("pose: upright = up, tilted = hand, pocket mode = pocket", () => {
  assert.equal(dance((t) => 2 * Math.cos((TAU * t) / BEAT), { tilt: 0.97 }).pose, "up");
  assert.equal(dance((t) => 2 * Math.cos((TAU * t) / BEAT), { tilt: 0.7 }).pose, "hand");
  assert.equal(dance((t) => 2 * Math.cos((TAU * t) / BEAT), { pocket: true }).pose, "pocket");
});
test("devices without `acceleration`: high-pass fallback still finds the beat, lower quality qᵢ", () => {
  const f = dance((t) => 3 * Math.cos((TAU * t) / BEAT), { fallback: true });
  assert.ok(f.R > 0.9);
  assert.ok(f.q <= 0.7 && f.q > 0.5);
  assert.ok(dance((t) => 3 * Math.cos((TAU * t) / BEAT)).q > 0.95);
});
test("personal adaptation stays within ±30 % and only learns from clear dancing", () => {
  const m = new MotionFeatures();
  let t = 0;
  const feed = (amp: number, bpmMs: number, bars: number) => {
    for (const end = t + bars * BAR; t < end; t += 1000 / 60) {
      const v = amp * Math.cos((TAU * t) / bpmMs);
      m.push({ t, acc: { x: 0, y: v, z: 0 }, accG: { x: 0, y: 9.81 * 0.7 + v, z: 6.9 } });
      const b = Math.floor(t / BAR);
      if (Math.floor((t + 1000 / 60) / BAR) > b) m.bar(b * BAR, (b + 1) * BAR, BEAT);
    }
  };
  feed(12, 60000 / 117, 200); // strong but off tempo: no learning
  assert.ok(Math.abs(m.adapt - 1) < 0.005, `adapt=${m.adapt}`);
  feed(12, BEAT, 3000); // strong and on the beat for ~90 min: adapts, capped at 1.3
  assert.ok(m.adapt > 1.2 && m.adapt <= 1.3, `adapt=${m.adapt}`);
});
