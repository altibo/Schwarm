// Dev-only page for the offline render tool (tools/render.ts). Not part of the deployed app.
import { SetRunner, summary } from "./set.ts";
import type { Genre } from "./director.ts";
import type { Score } from "./arranger.ts";
import { fingerprint } from "./arranger.ts";
import { loadLibrary } from "./audio/samples.ts";
import { createMix, scheduleBar } from "./audio/mix.ts";
let scores: Score[] = [];
const PRE = 20;
const w = window as unknown as Record<string, unknown>;
w.schwarm = {
  prepare(preset: string, seed: number, genre?: Genre) {
    const run = new SetRunner({ preset, seed, crowd: "sim", genre });
    scores = [];
    while (!run.finished) scores.push(run.next());
    const last = scores[scores.length - 1].plan;
    return {
      total: last.time + 240 / last.bpm,
      bars: scores.map((s) => ({ ...summary(s), fp: fingerprint(s, "structure"), fpx: fingerprint(s, "exact") })),
      director: run.director.events,
      kicks: scores.flatMap((s) => s.events.filter((e) => (e.voice === "kick" || e.voice === "hkick") && e.vel > 0.6).map((e) => s.plan.time + (e.step * 15) / s.plan.bpm)),
    };
  },
  async renderChunk(start: number, end: number, sr: number) {
    const tPre = Math.max(0, Math.floor((start - PRE) * sr) / sr);
    const frames = Math.round((end - tPre) * sr);
    const ctx = new OfflineAudioContext(2, frames, sr);
    const lib = await loadLibrary(ctx, import.meta.env.BASE_URL);
    const mix = createMix(ctx, lib);
    let voices = 0;
    // Schedule incrementally (suspend every second, 2 s look-ahead) like the live engine does.
    // Scheduling 80 s of voices up front keeps thousands of idle nodes connected and makes the
    // render several times slower.
    const skip = (window as unknown as { __skip?: string[] }).__skip ?? [];
    const todo = scores.filter((s) => s.plan.time >= tPre && s.plan.time < end);
    let k = 0;
    const feed = (until: number) => {
      while (k < todo.length && todo[k].plan.time - tPre < until) {
        const s = todo[k++];
        const sc = skip.length
          ? { ...s, events: s.events.filter((e) => !skip.includes(e.voice) && !skip.includes(e.layer)), auto: { ...s.auto, rumble: skip.includes("rumble") ? 0 : s.auto.rumble } }
          : s;
        voices += scheduleBar(mix, sc, s.plan.time - tPre);
      }
    };
    feed(2);
    const len = frames / sr;
    for (let t = 1; t < len - 0.01; t += 1) {
      const at = Math.round(t * sr / 128) * 128 / sr;
      void ctx.suspend(at).then(() => {
        feed(at + 2);
        void ctx.resume();
      });
    }
    const buf = await ctx.startRendering();
    const from = Math.round(start * sr) - Math.round(tPre * sr);
    const to = Math.round(end * sr) - Math.round(tPre * sr);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const out = new Int16Array((to - from) * 2);
    let peak = 0, clipped = 0, sq = 0;
    for (let i = from, j = 0; i < to; i++, j += 2) {
      const l = L[i], r = R[i];
      const al = Math.abs(l), ar = Math.abs(r);
      if (al > peak) peak = al;
      if (ar > peak) peak = ar;
      if (al >= 1 || ar >= 1) clipped++;
      sq += l * l + r * r;
      out[j] = Math.max(-32768, Math.min(32767, Math.round(l * 32767)));
      out[j + 1] = Math.max(-32768, Math.min(32767, Math.round(r * 32767)));
    }
    const bytes = new Uint8Array(out.buffer);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { b64: (window as unknown as { __nob64?: boolean }).__nob64 ? "" : btoa(bin), peak, clipped, voices, rmsDb: 10 * Math.log10(sq / (2 * (to - from)) + 1e-12) };
  },
};
document.body.textContent = "render ready";
