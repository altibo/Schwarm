// Web Audio mix graph + voices. Used by the live engine (AudioContext) and the offline render
// (OfflineAudioContext) alike, so the render is exactly what the app plays.
import type { Score, Ev } from "../arranger.ts";
import { type Library, nearestZone } from "./samples.ts";
import { rng } from "../rng.ts";

const DRUM_GAIN: Record<string, number> = {
  kick: 1, kickdeep: 1, snare: 0.9, snaredark: 1, clap: 1.1, hat: 0.75, openhat: 0.62, rim: 0.85,
  tom: 0.85, conga: 0.95, clave: 0.6, shaker: 0.7, ride: 0.5,
};
const midiHz = (n: number) => 440 * 2 ** ((n - 69) / 12);
const VOWELS: Record<string, number[]> = { a: [800, 1200, 2800], o: [450, 800, 2830], e: [420, 1900, 2600], i: [300, 2250, 3000], u: [330, 750, 2500] };
export interface Mix {
  ctx: BaseAudioContext;
  lib: Library;
  noise: AudioBuffer;
  musicIn: GainNode;
  kickIn: GainNode;
  fxIn: GainNode;
  revIn: GainNode;
  dlyIn: GainNode;
  lp: BiquadFilterNode;
  hp: BiquadFilterNode;
  duck: GainNode;
  rumbleDuck: GainNode;
  rumbleSend: GainNode;
  musicRev: GainNode;
  gap: GainNode;
  delay: DelayNode;
  driveWet: GainNode;
  driveDry: GainNode;
  /** Hard House kick bus (harder saturation than the techno kick). */
  hkickIn: GainNode;
  preMaster: GainNode;
  fb: GainNode;
  stage: PerfStage;
  output: AudioNode;
  sources: Set<AudioScheduledSourceNode>;
  voices: number;
}
function noiseBuffer(ctx: BaseAudioContext, seconds: number, seed: number) {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  const r = rng(seed);
  for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
  return b;
}
function impulse(ctx: BaseAudioContext, seconds: number, decay: number, seed: number, damp: number) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const r = rng(seed + ch);
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const u = i / len;
      const a = Math.min(0.95, damp * (0.2 + u)); // darker towards the tail
      lp = lp * a + (r() * 2 - 1) * (1 - a);
      d[i] = lp * (1 - u) ** decay * (i < 64 ? i / 64 : 1);
    }
  }
  return b;
}
const tanhCurve = (k: number, out = 1, size = 2049) => {
  const c = new Float32Array(size);
  for (let i = 0; i < size; i++) c[i] = (out * Math.tanh(((i / (size - 1)) * 2 - 1) * k)) / Math.tanh(k);
  return c;
};
/** Performance stage on the summed mix (after the pre-drop gap, before the master):
 * CRUSH → TAPE STOP → STUTTER. Ported from BoomStep: the stutter replays a captured slice with
 * seven gated delay taps instead of a feedback loop (exactly periodic, no 128-frame drift); the
 * tape stop is a delay line whose delay grows like t²/2T (speed ramps 1 → 0). */
export interface PerfStage {
  crushDry: GainNode;
  crushWet: GainNode;
  tapeDry: GainNode;
  tapeWet: GainNode;
  tapeDelay: DelayNode;
  stIn: GainNode;
  stDry: GainNode;
  taps: { delay: DelayNode; gain: GainNode }[];
}
export function crushCurve(bits: number, size = 4097) {
  const c = new Float32Array(size);
  const levels = 2 ** (bits - 1);
  for (let i = 0; i < size; i++) c[i] = Math.round(((i / (size - 1)) * 2 - 1) * levels) / levels;
  return c;
}
/** Delay-time curve for a linear speed ramp 1 → 0 over `seconds`: d(t) = t²/(2T). */
export function brakeCurve(seconds: number, points = 64) {
  const c = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const t = (i / (points - 1)) * seconds;
    c[i] = (t * t) / (2 * seconds);
  }
  return c;
}
function perfStage(ctx: BaseAudioContext, input: AudioNode, output: AudioNode): PerfStage {
  const g = (v: number) => {
    const n = ctx.createGain();
    n.gain.value = v;
    return n;
  };
  const crushDry = g(1), crushWet = g(0), crushOut = g(1);
  const crusher = ctx.createWaveShaper();
  crusher.curve = crushCurve(4);
  const crushLp = ctx.createBiquadFilter();
  crushLp.type = "lowpass";
  crushLp.frequency.value = 7000;
  input.connect(crushDry).connect(crushOut);
  input.connect(crusher).connect(crushLp).connect(crushWet).connect(crushOut);
  const tapeDry = g(1), tapeWet = g(0), tapeOut = g(1);
  const tapeDelay = ctx.createDelay(4);
  crushOut.connect(tapeDry).connect(tapeOut);
  crushOut.connect(tapeDelay).connect(tapeWet).connect(tapeOut);
  const stIn = g(0), stDry = g(1);
  tapeOut.connect(stDry).connect(output);
  tapeOut.connect(stIn);
  const taps = Array.from({ length: 7 }, () => {
    const delay = ctx.createDelay(4), gain = g(0);
    stIn.connect(delay).connect(gain).connect(output);
    return { delay, gain };
  });
  return { crushDry, crushWet, tapeDry, tapeWet, tapeDelay, stIn, stDry, taps };
}
export function createMix(ctx: BaseAudioContext, lib: Library, destination: AudioNode = ctx.destination): Mix {
  const g = (v = 1) => {
    const n = ctx.createGain();
    n.gain.value = v;
    return n;
  };
  const musicIn = g(), kickIn = g(), fxIn = g(), revIn = g(), dlyIn = g();
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 18000;
  lp.Q.value = 0.9;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 20;
  hp.Q.value = 0.8;
  const duck = g(), gap = g(), preMaster = g(0.72);
  musicIn.connect(lp).connect(hp).connect(duck).connect(gap);
  const stage = perfStage(ctx, gap, preMaster);
  // Kick: fixed saturation for harmonics, then straight to the master (never ducked).
  const kickSat = ctx.createWaveShaper();
  kickSat.curve = tanhCurve(1.8, 0.95);
  kickSat.oversample = "2x";
  kickIn.connect(kickSat).connect(gap);
  // Hard House kick: driven harder into its own shaper (distorted, short, punchy).
  const hkickIn = g(), hkSat = ctx.createWaveShaper(), hkOut = g(0.5);
  hkSat.curve = tanhCurve(3.2, 0.95);
  hkSat.oversample = "2x";
  hkickIn.connect(hkSat).connect(hkOut).connect(gap);
  // Rumble: kick → dark reverb → low-pass, ducked by the kick (classic dark techno).
  const rumbleSend = g(0), rumbleConv = ctx.createConvolver(), rumbleLp = ctx.createBiquadFilter(), rumbleDuck = g(), rumbleOut = g(0.4);
  rumbleConv.buffer = impulse(ctx, 1.3, 2.2, 101, 0.9);
  rumbleLp.type = "lowpass";
  rumbleLp.frequency.value = 130;
  kickIn.connect(rumbleSend).connect(rumbleConv).connect(rumbleLp).connect(rumbleDuck).connect(rumbleOut).connect(gap);
  // Sends: reverb (dark hall) and dotted-8th dub delay with filtered feedback.
  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, 2.6, 2.6, 202, 0.55);
  const revOut = g(0.55), musicRev = g(0.12);
  hp.connect(musicRev).connect(revIn);
  revIn.connect(reverb).connect(revOut).connect(preMaster);
  const delay = ctx.createDelay(2);
  delay.delayTime.value = 0.35;
  const fb = g(0.42), fbLp = ctx.createBiquadFilter(), dlyOut = g(0.5);
  fbLp.type = "lowpass";
  fbLp.frequency.value = 2600;
  dlyIn.connect(delay).connect(fbLp).connect(fb).connect(delay);
  fbLp.connect(dlyOut).connect(duck);
  fxIn.connect(gap);
  // Master: rumble filter, parallel drive, glue compressor, limiter, soft ceiling.
  const masterHp = ctx.createBiquadFilter();
  masterHp.type = "highpass";
  masterHp.frequency.value = 28;
  const driveDry = g(1), driveWet = g(0), shaper = ctx.createWaveShaper(), driveSum = g();
  shaper.curve = tanhCurve(3, 0.7);
  shaper.oversample = "2x";
  preMaster.connect(masterHp);
  masterHp.connect(driveDry).connect(driveSum);
  masterHp.connect(shaper).connect(driveWet).connect(driveSum);
  // Chromium adds automatic make-up gain to DynamicsCompressor, so only one limiter with a high
  // threshold is used (little make-up gain); the level ladder keeps its dynamics.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.08;
  limiter.knee.value = 0;
  const ceiling = ctx.createWaveShaper();
  ceiling.curve = tanhCurve(1.3, 0.88, 4097);
  driveSum.connect(limiter).connect(ceiling).connect(destination);
  return {
    ctx, lib, noise: noiseBuffer(ctx, 2, 303), musicIn, kickIn, fxIn, revIn, dlyIn, lp, hp, duck, rumbleDuck,
    rumbleSend, musicRev, gap, delay, driveWet, driveDry, hkickIn, preMaster, fb, stage, output: ceiling, sources: new Set(), voices: 0,
  };
}
/** Schedule one bar at absolute context time t0. Returns the number of voices started. */
export function scheduleBar(mix: Mix, score: Score, t0: number): number {
  const step = 15 / score.plan.bpm;
  const t1 = t0 + 16 * step;
  const a = score.auto;
  const ramp = (p: AudioParam, from: number, to: number) => {
    p.setValueAtTime(from, t0);
    p.linearRampToValueAtTime(to, t1);
  };
  ramp(mix.lp.frequency, a.lp[0], a.lp[1]);
  ramp(mix.hp.frequency, a.hp[0], a.hp[1]);
  mix.driveWet.gain.setValueAtTime(a.drive, t0);
  mix.driveDry.gain.setValueAtTime(1 - a.drive * 0.45, t0);
  mix.rumbleSend.gain.setValueAtTime(a.rumble * 0.5, t0);
  mix.musicRev.gain.setValueAtTime(Math.min(1, a.rev + (a.wash ?? 0)), t0);
  mix.delay.delayTime.setValueAtTime(3 * step, t0);
  mix.fb.gain.setValueAtTime(a.throwFb ?? 0.42, t0);
  mix.preMaster.gain.setValueAtTime(0.72 * (a.trim ?? 1), t0);
  stageBar(mix.stage, a, t0, t1, step);
  mix.gap.gain.setValueAtTime(1, t0);
  if (a.gapAt >= 0) {
    const tg = t0 + a.gapAt * step;
    mix.gap.gain.setValueAtTime(1, tg);
    mix.gap.gain.linearRampToValueAtTime(0, tg + 0.004);
    mix.gap.gain.setValueAtTime(0, t1 - 0.002);
    mix.gap.gain.linearRampToValueAtTime(1, t1);
  }
  let n = 0;
  for (const e of score.events) {
    const t = t0 + e.step * step;
    voice(mix, e, t, step, a.duck);
    n++;
  }
  mix.voices += n;
  return n;
}
/** Schedule the performance stage for one bar (all edges with 3 ms ramps, click-free). */
function stageBar(st: PerfStage, a: Score["auto"], t0: number, t1: number, step: number) {
  const F = 0.003;
  const set = (p: AudioParam, v: number, t: number) => p.setValueAtTime(v, t);
  const fadeTo = (p: AudioParam, from: number, to: number, t: number) => {
    p.setValueAtTime(from, t);
    p.linearRampToValueAtTime(to, t + F);
  };
  // defaults at the bar start: dry everywhere
  set(st.crushDry.gain, 1, t0);
  set(st.crushWet.gain, 0, t0);
  set(st.tapeDry.gain, 1, t0);
  set(st.tapeWet.gain, 0, t0);
  st.tapeDelay.delayTime.setValueAtTime(0, t0);
  set(st.stIn.gain, 0, t0);
  set(st.stDry.gain, 1, t0);
  for (const tap of st.taps) set(tap.gain.gain, 0, t0);
  if (a.crush) {
    const ta = t0 + a.crush.at * step, tb = Math.min(t1, ta + a.crush.len * step);
    fadeTo(st.crushWet.gain, 0, a.crush.mix, ta);
    fadeTo(st.crushDry.gain, 1, 1 - a.crush.mix * 0.95, ta);
    fadeTo(st.crushWet.gain, a.crush.mix, 0, tb - F);
    fadeTo(st.crushDry.gain, 1 - a.crush.mix * 0.95, 1, tb - F);
  }
  if (a.tape) {
    const ta = t0 + a.tape.at * step, T = Math.max(0.05, Math.min(t1 - ta - 0.004, a.tape.len * step));
    st.tapeDelay.delayTime.setValueAtTime(0, ta);
    st.tapeDelay.delayTime.setValueCurveAtTime(brakeCurve(T), ta, T);
    fadeTo(st.tapeWet.gain, 0, 1, ta);
    fadeTo(st.tapeDry.gain, 1, 0, ta);
    // the brake fades out over its last 40 %, then silence until the bar ends
    st.tapeWet.gain.setValueAtTime(1, ta + T * 0.6);
    st.tapeWet.gain.linearRampToValueAtTime(0, ta + T);
    st.tapeDelay.delayTime.setValueAtTime(0, t1 - 0.001);
    st.tapeDry.gain.setValueAtTime(0, t1 - F);
    st.tapeDry.gain.linearRampToValueAtTime(1, t1);
  }
  for (const w of a.stutter ?? []) {
    const slice = w.slice * step;
    const ta = t0 + w.at * step, tb = Math.min(t1, ta + w.len * step);
    // capture exactly one slice, then the taps replay it, each in its own window
    fadeTo(st.stIn.gain, 0, 1, ta);
    fadeTo(st.stIn.gain, 1, 0, ta + slice - F);
    fadeTo(st.stDry.gain, 1, 0, ta + slice - F);
    st.taps.forEach((tap, i) => {
      const k = i + 1;
      const on = ta + k * slice;
      if (on >= tb - 1e-6) return;
      tap.delay.delayTime.setValueAtTime(k * slice, ta);
      tap.gain.gain.setValueAtTime(0, on - F);
      tap.gain.gain.linearRampToValueAtTime(1, on);
      const off = Math.min(on + slice, tb);
      tap.gain.gain.setValueAtTime(1, off - F);
      tap.gain.gain.linearRampToValueAtTime(0, off);
    });
    fadeTo(st.stDry.gain, 0, 1, tb - F);
  }
}
function voice(mix: Mix, e: Ev, t: number, step: number, duck: number) {
  const c = mix.ctx;
  const nodes: AudioNode[] = [];
  const srcs: AudioScheduledSourceNode[] = [];
  const mk = <T extends AudioNode>(n: T) => (nodes.push(n), n);
  const gain = (v = 0) => {
    const n = mk(c.createGain());
    n.gain.value = v;
    return n;
  };
  const filt = (type: BiquadFilterType, f: number, q = 0.7) => {
    const n = mk(c.createBiquadFilter());
    n.type = type;
    n.frequency.value = f;
    n.Q.value = q;
    return n;
  };
  let lastStop = -1;
  let lastSrc: AudioScheduledSourceNode | null = null;
  const play = (s: AudioScheduledSourceNode, start: number, stop: number, offset?: number) => {
    if (s instanceof AudioBufferSourceNode && offset !== undefined) s.start(start, offset);
    else s.start(start);
    s.stop(stop);
    srcs.push(s);
    if (stop >= lastStop) {
      lastStop = stop;
      lastSrc = s;
    }
  };
  const noise = (loop = true) => {
    const s = c.createBufferSource();
    s.buffer = mix.noise;
    s.loop = loop;
    return s;
  };
  const dur = e.len * step;
  const out = gain(1);
  let dest: AudioNode = mix.musicIn;
  if (e.voice === "kick") dest = mix.kickIn;
  if (e.voice === "hkick") dest = mix.hkickIn;
  if (["riser", "crash", "impact", "downlifter", "revcrash"].includes(e.voice)) dest = mix.fxIn;
  if (e.pan) {
    const p = mk(c.createStereoPanner());
    p.pan.value = e.pan;
    out.connect(p).connect(dest);
  } else out.connect(dest);
  if (e.rev) out.connect(gain(e.rev)).connect(mix.revIn);
  if (e.dly) out.connect(gain(e.dly)).connect(mix.dlyIn);
  let end: number;
  switch (e.voice) {
    case "kick": {
      const tone = e.tone ?? 1;
      const osc = c.createOscillator();
      osc.frequency.setValueAtTime(210, t);
      osc.frequency.exponentialRampToValueAtTime(62, t + 0.035);
      osc.frequency.exponentialRampToValueAtTime(43.65, t + 0.2);
      const body = gain(0);
      body.gain.setValueAtTime(0, t);
      body.gain.linearRampToValueAtTime(e.vel * 0.28, t + 0.002);
      body.gain.setTargetAtTime(0, t + 0.07, 0.085 + (1 - tone) * 0.04);
      const tf = filt("lowpass", 260 + tone * 7000);
      osc.connect(body).connect(tf).connect(out);
      end = t + 0.65;
      play(osc, t, end);
      if (tone > 0.2) {
        const n = noise(false);
        const click = gain(0);
        click.gain.setValueAtTime(0.45 * e.vel * tone, t);
        click.gain.setTargetAtTime(0, t + 0.001, 0.004);
        n.connect(filt("highpass", 1800)).connect(click).connect(tf);
        play(n, t, t + 0.05, 0.3);
      }
      if (duck > 0 && e.vel > 0.6) {
        for (const p of [mix.duck.gain, mix.rumbleDuck.gain]) {
          p.setTargetAtTime(1 - duck, t, 0.003);
          p.setTargetAtTime(1, t + 0.045, 0.06);
        }
      }
      break;
    }
    case "drum": {
      const buf = mix.lib.drums[e.sample ?? "hat"];
      const s = c.createBufferSource();
      s.buffer = buf;
      const rate = e.rate ?? 1;
      s.playbackRate.value = rate;
      const amp = gain(e.vel * (DRUM_GAIN[e.sample ?? ""] ?? 0.5));
      s.connect(amp).connect(out);
      const natural = buf.duration / rate;
      end = t + natural + 0.02;
      if ((e.sample === "openhat" || e.sample === "ride") && dur < natural) {
        amp.gain.setValueAtTime(amp.gain.value, t + dur);
        amp.gain.setTargetAtTime(0, t + dur, 0.03);
        end = t + dur + 0.2;
      }
      play(s, t, end);
      break;
    }
    case "noisehat": {
      const s = noise();
      const amp = gain(0);
      amp.gain.setValueAtTime(e.vel * 0.6, t);
      amp.gain.setTargetAtTime(0, t + 0.002, 0.012 + e.len * 0.02);
      s.connect(filt("highpass", 7200, 0.9)).connect(filt("peaking", 10500, 1.2)).connect(amp).connect(out);
      end = t + 0.25;
      play(s, t, end, (e.step * 0.137) % 1.5);
      break;
    }
    case "sub":
    case "fm": {
      const zones = mix.lib.instruments[e.voice === "fm" ? "fmbass" : "sub"];
      const z = nearestZone(zones, e.note ?? 29);
      const s = c.createBufferSource();
      s.buffer = z.buffer;
      s.playbackRate.value = 2 ** (((e.note ?? 29) - z.root) / 12);
      const amp = gain(0);
      const peak = e.vel * (e.voice === "fm" ? 0.3 : 0.42);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(peak, t + 0.004);
      amp.gain.setValueAtTime(peak, t + dur);
      amp.gain.setTargetAtTime(0, t + dur, 0.025);
      s.connect(filt("lowpass", e.cutoff ?? 1200, 1.2)).connect(amp).connect(out);
      end = Math.min(t + dur + 0.2, t + z.buffer.duration / s.playbackRate.value);
      play(s, t, end);
      break;
    }
    case "saw": {
      const f0 = midiHz(e.note ?? 29);
      const lpf = filt("lowpass", 200, 4);
      lpf.frequency.setValueAtTime((e.cutoff ?? 900) * 2.6, t);
      lpf.frequency.setTargetAtTime(e.cutoff ?? 900, t, 0.04);
      const amp = gain(0);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(e.vel * 0.2, t + 0.003);
      amp.gain.setValueAtTime(e.vel * 0.2, t + dur);
      amp.gain.setTargetAtTime(0, t + dur, 0.02);
      end = t + dur + 0.15;
      for (const det of [-8, 8]) {
        const o = c.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = f0;
        o.detune.value = det;
        o.connect(lpf);
        play(o, t, end);
      }
      const sub = c.createOscillator();
      sub.frequency.value = f0;
      sub.connect(gain(1.6)).connect(amp);
      play(sub, t, end);
      lpf.connect(amp).connect(out);
      break;
    }
    case "acid": {
      const f = midiHz(e.note ?? 41);
      const o = c.createOscillator();
      o.type = "sawtooth";
      if (e.slideFrom !== undefined) {
        o.frequency.setValueAtTime(midiHz(e.slideFrom), t);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.055);
      } else o.frequency.setValueAtTime(f, t);
      const cut = e.cutoff ?? 800;
      const lpf = filt("lowpass", cut, e.accent ? 16 : 11);
      lpf.frequency.setValueAtTime(Math.min(12000, cut * (e.accent ? 4 : 2.4)), t);
      lpf.frequency.setTargetAtTime(cut, t + 0.004, e.accent ? 0.09 : 0.05);
      const amp = gain(0);
      const peak = e.vel * 0.18;
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(peak, t + 0.003);
      amp.gain.setValueAtTime(peak, t + dur);
      amp.gain.setTargetAtTime(0, t + dur, 0.012);
      o.connect(lpf).connect(amp).connect(out);
      end = t + dur + 0.1;
      play(o, t, end);
      break;
    }
    case "pad": {
      const notes = e.notes ?? [53];
      const lpf = filt("lowpass", 600, 1.5);
      lpf.frequency.setValueAtTime(600, t);
      lpf.frequency.linearRampToValueAtTime(1500, t + dur * 0.6);
      lpf.frequency.linearRampToValueAtTime(900, t + dur);
      const amp = gain(0);
      const peak = e.vel * 0.045;
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(peak, t + Math.min(0.9, dur * 0.3));
      amp.gain.setValueAtTime(peak, t + dur - 0.2);
      amp.gain.setTargetAtTime(0, t + dur - 0.2, 0.45);
      end = t + dur + 2;
      for (const n of notes)
        for (const det of [-11, 9]) {
          const o = c.createOscillator();
          o.type = "sawtooth";
          o.frequency.value = midiHz(n);
          o.detune.value = det;
          o.connect(lpf);
          play(o, t, end);
        }
      lpf.connect(amp).connect(out);
      // A breath of real choir at the start of the chord (CC0 sample, plays out naturally).
      const z = nearestZone(mix.lib.instruments.choir, notes[0]);
      const s = c.createBufferSource();
      s.buffer = z.buffer;
      s.playbackRate.value = 2 ** ((notes[0] - z.root) / 12);
      const ch = gain(0);
      ch.gain.setValueAtTime(0, t);
      ch.gain.linearRampToValueAtTime(e.vel * 0.22, t + 0.4);
      ch.gain.setTargetAtTime(0, t + Math.min(dur, 2.2), 0.4);
      s.connect(ch).connect(out);
      play(s, t, Math.min(end, t + z.buffer.duration / s.playbackRate.value));
      break;
    }
    case "stab":
    case "lead": {
      const inst = e.voice === "stab" ? "brass" : "fifths";
      const notes = e.notes ?? [e.note ?? 65];
      const lpf = filt("lowpass", e.voice === "stab" ? 2000 : 3200, 1);
      const amp = gain(0);
      const peak = e.vel * (e.voice === "stab" ? 0.26 : 0.55);
      const hold = Math.max(0.08, dur);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(peak, t + 0.006);
      amp.gain.setValueAtTime(peak, t + hold);
      amp.gain.setTargetAtTime(0, t + hold, e.voice === "stab" ? 0.05 : 0.12);
      end = t + hold + 0.6;
      for (const n of notes) {
        const z = nearestZone(mix.lib.instruments[inst], n);
        const s = c.createBufferSource();
        s.buffer = z.buffer;
        s.playbackRate.value = 2 ** ((n - z.root) / 12);
        s.connect(lpf);
        play(s, t, Math.min(end, t + z.buffer.duration / s.playbackRate.value));
      }
      lpf.connect(amp).connect(out);
      break;
    }
    case "riser": {
      const from = e.from ?? 0;
      const s = noise();
      const bp = filt("bandpass", 300, 2.2);
      bp.frequency.setValueAtTime(300 * (1 + from * 5), t);
      bp.frequency.exponentialRampToValueAtTime(9000, t + dur);
      const amp = gain(0);
      amp.gain.setValueAtTime(0.015 + from * 0.1 * e.vel, t);
      amp.gain.linearRampToValueAtTime(e.vel * 0.3, t + dur);
      amp.gain.setTargetAtTime(0, t + dur, 0.05);
      s.connect(bp).connect(amp).connect(out);
      const o = c.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(180 * (1 + from), t);
      o.frequency.exponentialRampToValueAtTime(1400, t + dur);
      o.connect(gain(0.15)).connect(amp);
      out.connect(gain(0.3)).connect(mix.revIn);
      end = t + dur + 0.3;
      play(s, t, end, 0.5);
      play(o, t, end);
      break;
    }
    case "crash": {
      const s = noise();
      const amp = gain(0);
      amp.gain.setValueAtTime(e.vel * 0.3, t);
      amp.gain.setTargetAtTime(0, t + 0.01, 0.5);
      s.connect(filt("highpass", 3800, 0.7)).connect(filt("peaking", 7000, 0.8)).connect(amp).connect(out);
      out.connect(gain(0.3)).connect(mix.revIn);
      end = t + Math.max(dur, 2.5);
      play(s, t, end, 1.1);
      break;
    }
    case "impact": {
      const o = c.createOscillator();
      o.frequency.setValueAtTime(75, t);
      o.frequency.exponentialRampToValueAtTime(31, t + 0.9);
      const amp = gain(0);
      amp.gain.setValueAtTime(e.vel * 0.7, t);
      amp.gain.setTargetAtTime(0, t + 0.02, 0.35);
      o.connect(amp).connect(out);
      end = t + 2;
      play(o, t, end);
      break;
    }
    case "downlifter": {
      const s = noise();
      const lpf = filt("lowpass", 9000, 1);
      lpf.frequency.setValueAtTime(9000, t);
      lpf.frequency.exponentialRampToValueAtTime(250, t + dur);
      const amp = gain(0);
      amp.gain.setValueAtTime(e.vel * 0.16, t);
      amp.gain.linearRampToValueAtTime(0, t + dur);
      s.connect(lpf).connect(amp).connect(out);
      play(s, t, t + dur + 0.05, 0.9);
      break;
    }
    case "hkick": {
      // Hard House kick: fast pitch drop, short punchy body, click; driven into its own shaper.
      const drive = e.tone ?? 0.6;
      const osc = c.createOscillator();
      osc.frequency.setValueAtTime(240, t);
      osc.frequency.exponentialRampToValueAtTime(62, t + 0.03);
      osc.frequency.exponentialRampToValueAtTime(47, t + 0.16);
      const body = gain(0);
      body.gain.setValueAtTime(0, t);
      body.gain.linearRampToValueAtTime(e.vel * (0.32 + drive * 0.38), t + 0.002);
      body.gain.setTargetAtTime(0, t + 0.06, 0.055 + (1 - drive) * 0.03);
      osc.connect(body).connect(out);
      const p = c.createOscillator();
      p.type = "triangle";
      p.frequency.setValueAtTime(130, t);
      p.frequency.exponentialRampToValueAtTime(50, t + 0.08);
      const pg = gain(0);
      pg.gain.setValueAtTime(e.vel * 0.12, t);
      pg.gain.setTargetAtTime(0, t + 0.01, 0.03);
      p.connect(pg).connect(out);
      const n = noise(false);
      const click = gain(0);
      click.gain.setValueAtTime(0.35 * e.vel, t);
      click.gain.setTargetAtTime(0, t + 0.001, 0.004);
      n.connect(filt("highpass", 2400)).connect(click).connect(out);
      end = t + 0.5;
      play(osc, t, end);
      play(p, t, t + 0.15);
      play(n, t, t + 0.04, 0.3);
      if (duck > 0 && e.vel > 0.6) {
        for (const q of [mix.duck.gain, mix.rumbleDuck.gain]) {
          q.setTargetAtTime(1 - duck, t, 0.003);
          q.setTargetAtTime(1, t + 0.04, 0.05);
        }
      }
      break;
    }
    case "hbass": {
      // Offbeat sub: sine + triangle with a short pitch "bounce" at the attack.
      const f = midiHz(e.note ?? 29);
      const amp = gain(0);
      const peak = e.vel * 0.36;
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(peak, t + 0.003);
      amp.gain.setValueAtTime(peak, t + dur * 0.7);
      amp.gain.setTargetAtTime(0, t + dur * 0.7, 0.03);
      const lpf = filt("lowpass", (e.cutoff ?? 900) * 1.4, 1.5);
      lpf.frequency.setTargetAtTime(e.cutoff ?? 900, t, 0.05);
      end = t + dur + 0.15;
      for (const [type, g0] of [["sine", 1], ["triangle", 0.45]] as const) {
        const o = c.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f * 1.5, t);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.018);
        o.connect(gain(g0)).connect(lpf);
        play(o, t, end);
      }
      lpf.connect(amp).connect(out);
      break;
    }
    case "donk": {
      // FM donk (BoomStep): carrier with a decaying 2:1 modulator and a pitch drop.
      const f = midiHz(e.note ?? 29);
      const lpf = filt("lowpass", 2400, 1);
      const amp = gain(0);
      const peak = e.vel * 0.3;
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(peak, t + 0.002);
      amp.gain.setValueAtTime(peak, t + dur * 0.25);
      amp.gain.setTargetAtTime(0, t + dur * 0.25, Math.max(0.02, dur * 0.3));
      const carrier = c.createOscillator();
      carrier.frequency.setValueAtTime(f * 1.6, t);
      carrier.frequency.exponentialRampToValueAtTime(f, t + 0.025);
      const mod = c.createOscillator();
      mod.frequency.value = f * 2;
      const mg = gain(0);
      mg.gain.setValueAtTime(f * 4, t);
      mg.gain.exponentialRampToValueAtTime(1, t + 0.11);
      mod.connect(mg).connect(carrier.frequency);
      carrier.connect(lpf);
      const tri = c.createOscillator();
      tri.type = "triangle";
      tri.frequency.value = f;
      tri.connect(gain(0.35)).connect(lpf);
      lpf.connect(amp).connect(out);
      end = t + dur + 0.25;
      play(carrier, t, end);
      play(mod, t, end);
      play(tri, t, end);
      break;
    }
    case "roll": {
      // Rolling 16th bass: saw through a resonant low-pass envelope + sine sub.
      const f = midiHz(e.note ?? 29);
      const cut = e.cutoff ?? 900;
      const lpf = filt("lowpass", cut, 3);
      lpf.frequency.setValueAtTime(cut * 2.2, t);
      lpf.frequency.setTargetAtTime(cut * 0.6, t + 0.003, 0.035);
      const amp = gain(0);
      const peak = e.vel * 0.24;
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(peak, t + 0.002);
      amp.gain.setTargetAtTime(0, t + dur * 0.6, 0.02);
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      const sub = c.createOscillator();
      sub.frequency.value = f;
      o.connect(lpf);
      sub.connect(gain(0.9)).connect(amp);
      lpf.connect(amp).connect(out);
      end = t + dur + 0.12;
      play(o, t, end);
      play(sub, t, end);
      break;
    }
    case "hoover": {
      // Hoover: four detuned saws with the classic downward pitch swoop (or a glide from the
      // previous note), a sub-octave saw, low-pass envelope.
      const f = midiHz(e.note ?? 53);
      const cut = e.cutoff ?? 4200;
      const lpf = filt("lowpass", cut, 1.3);
      lpf.frequency.setValueAtTime(cut, t);
      lpf.frequency.exponentialRampToValueAtTime(Math.max(300, cut * 0.35), t + dur + 0.1);
      const amp = gain(0);
      const peak = e.vel * 0.17;
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(peak, t + 0.012);
      amp.gain.setValueAtTime(peak, t + dur);
      amp.gain.setTargetAtTime(0, t + dur, 0.05);
      end = t + dur + 0.3;
      const from = e.slideFrom !== undefined ? midiHz(e.slideFrom) : f * 1.45;
      for (const det of [-17, -6, 6, 17]) {
        const o = c.createOscillator();
        o.type = "sawtooth";
        o.detune.value = det;
        o.frequency.setValueAtTime(from, t);
        o.frequency.exponentialRampToValueAtTime(f, t + (e.slideFrom !== undefined ? 0.06 : 0.045));
        o.connect(lpf);
        play(o, t, end);
      }
      const so = c.createOscillator();
      so.type = "square";
      so.frequency.setValueAtTime(from / 2, t);
      so.frequency.exponentialRampToValueAtTime(f / 2, t + 0.045);
      so.connect(gain(0.5)).connect(lpf);
      play(so, t, end);
      lpf.connect(amp).connect(out);
      break;
    }
    case "reese": {
      // Reese: two detuned saws + sine sub, dark low-pass breathing with a slow LFO.
      const f = midiHz(e.note ?? 41);
      const cut = e.cutoff ?? 420;
      const lpf = filt("lowpass", cut, 2);
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.35;
      lfo.connect(gain(cut * 0.45)).connect(lpf.frequency);
      const amp = gain(0);
      const peak = e.vel * 0.16;
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(peak, t + 0.25);
      amp.gain.setValueAtTime(peak, t + Math.max(0.3, dur - 0.3));
      amp.gain.linearRampToValueAtTime(0, t + dur);
      end = t + dur + 0.05;
      for (const det of [-14, 14]) {
        const o = c.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = f;
        o.detune.value = det;
        o.connect(lpf);
        play(o, t, end);
      }
      const sub = c.createOscillator();
      sub.frequency.value = f / 2;
      sub.connect(gain(0.5)).connect(amp);
      lpf.connect(amp).connect(out);
      play(sub, t, end);
      play(lfo, t, end);
      break;
    }
    case "rstab": {
      // Rave stab: per note two detuned saws, square an octave under the root, snappy low-pass.
      const notes = e.notes ?? [e.note ?? 60];
      const lpf = filt("lowpass", 4200, 1.6);
      lpf.frequency.setValueAtTime(4800, t);
      lpf.frequency.exponentialRampToValueAtTime(700, t + Math.max(0.12, dur) + 0.05);
      const amp = gain(0);
      const peak = e.vel * (0.24 / Math.sqrt(notes.length));
      const hold = Math.max(0.09, dur);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(peak, t + 0.003);
      amp.gain.setValueAtTime(peak, t + hold);
      amp.gain.setTargetAtTime(0, t + hold, 0.05);
      end = t + hold + 0.3;
      for (const n of notes)
        for (const det of [-7, 7]) {
          const o = c.createOscillator();
          o.type = "sawtooth";
          o.frequency.value = midiHz(n);
          o.detune.value = det;
          o.connect(lpf);
          play(o, t, end);
        }
      const sq = c.createOscillator();
      sq.type = "square";
      sq.frequency.value = midiHz(notes[0] - 12);
      sq.connect(gain(0.4)).connect(lpf);
      play(sq, t, end);
      lpf.connect(amp).connect(out);
      break;
    }
    case "chop": {
      // Synthesized vocal chop: pulse + saw through three formant band-passes gliding from one
      // vowel to another, an "h" breath at the start, slight pitch fall at the end. No samples.
      const f = midiHz(e.note ?? 60);
      const [va, vb] = e.word ?? ["e", "i"];
      const A = VOWELS[va] ?? VOWELS.a, B = VOWELS[vb] ?? VOWELS.a;
      const amp = gain(0);
      const peak = e.vel * 0.65;
      const hold = Math.max(0.1, dur * 0.8);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(peak, t + 0.008);
      amp.gain.setValueAtTime(peak, t + hold);
      amp.gain.setTargetAtTime(0, t + hold, 0.05);
      end = t + hold + 0.3;
      const src = gain(1);
      const o1 = c.createOscillator();
      o1.type = "sawtooth";
      const o2 = c.createOscillator();
      o2.type = "square";
      for (const o of [o1, o2]) {
        o.frequency.setValueAtTime(f, t);
        o.frequency.setValueAtTime(f, t + hold * 0.7);
        o.frequency.exponentialRampToValueAtTime(f * 0.94, t + hold + 0.1);
        o.connect(src);
        play(o, t, end);
      }
      o2.detune.value = 8;
      [1, 0.55, 0.28].forEach((w, i) => {
        const bp = filt("bandpass", A[i], 7 + i * 2);
        bp.frequency.setValueAtTime(A[i], t);
        bp.frequency.linearRampToValueAtTime(B[i], t + hold * 0.6);
        src.connect(bp).connect(gain(w)).connect(amp);
      });
      const h = noise(false);
      const hg = gain(0);
      hg.gain.setValueAtTime(e.vel * 0.18, t);
      hg.gain.setTargetAtTime(0, t + 0.005, 0.012);
      h.connect(filt("bandpass", 3200, 1)).connect(hg).connect(amp);
      play(h, t, t + 0.06, (e.step * 0.211) % 1.5);
      amp.connect(out);
      break;
    }
    case "pluck": {
      const f = midiHz(e.note ?? 65);
      const cut = e.cutoff ?? 3200;
      const lpf = filt("lowpass", cut, 2);
      lpf.frequency.setValueAtTime(cut, t);
      lpf.frequency.setTargetAtTime(Math.max(250, cut * 0.15), t + 0.002, 0.07);
      const amp = gain(0);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(e.vel * 0.2, t + 0.002);
      amp.gain.setTargetAtTime(0, t + 0.004, 0.09 + dur * 0.04);
      end = t + 0.6 + dur * 0.1;
      const o = c.createOscillator();
      o.type = "triangle";
      o.frequency.value = f;
      const s2 = c.createOscillator();
      s2.type = "sawtooth";
      s2.frequency.value = f;
      s2.detune.value = 5;
      o.connect(lpf);
      s2.connect(gain(0.45)).connect(lpf);
      lpf.connect(amp).connect(out);
      play(o, t, end);
      play(s2, t, end);
      break;
    }
    case "clapx": {
      // Synth clap layer: three quick noise bursts + short tail (BoomStep).
      const s = noise(false);
      const amp = gain(0);
      const pk = e.vel * 0.5;
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(pk, t + 0.001);
      for (const off of [0.011, 0.022, 0.034]) {
        amp.gain.linearRampToValueAtTime(pk * 0.15, t + off - 0.003);
        amp.gain.linearRampToValueAtTime(pk, t + off);
      }
      amp.gain.setTargetAtTime(0, t + 0.036, 0.04);
      s.connect(filt("bandpass", 1450, 0.8)).connect(filt("highpass", 650)).connect(amp).connect(out);
      end = t + 0.3;
      play(s, t, end, (e.step * 0.173) % 1.5);
      break;
    }
    case "revcrash": {
      // Reverse cymbal into the next downbeat: swells up, cuts at the end.
      const s = noise();
      const amp = gain(0);
      amp.gain.setValueAtTime(0.0005, t);
      amp.gain.exponentialRampToValueAtTime(e.vel * 0.3, t + dur - 0.005);
      amp.gain.linearRampToValueAtTime(0, t + dur);
      s.connect(filt("highpass", 3000, 0.7)).connect(filt("peaking", 8000, 0.8)).connect(amp).connect(out);
      out.connect(gain(0.25)).connect(mix.revIn);
      end = t + dur + 0.01;
      play(s, t, end, 0.7);
      break;
    }
    case "zap": {
      const f = midiHz(e.note ?? 60);
      const o = c.createOscillator();
      o.frequency.setValueAtTime(f * 12, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.5, t + dur * 0.85);
      const amp = gain(0);
      amp.gain.setValueAtTime(e.vel * 0.14, t);
      amp.gain.exponentialRampToValueAtTime(0.0005, t + dur);
      o.connect(filt("lowpass", 4500, 1.1)).connect(amp).connect(out);
      end = t + dur + 0.02;
      play(o, t, end);
      break;
    }
    case "atmos": {
      const s = noise();
      const bp = filt("bandpass", 500, 1.4);
      bp.frequency.setValueAtTime(450, t);
      bp.frequency.linearRampToValueAtTime(1300, t + dur * 0.5);
      bp.frequency.linearRampToValueAtTime(600, t + dur);
      const amp = gain(0);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(e.vel * 0.05, t + Math.min(2, dur / 3));
      amp.gain.setValueAtTime(e.vel * 0.05, t + dur - 1.5);
      amp.gain.linearRampToValueAtTime(0, t + dur);
      s.connect(bp).connect(amp).connect(out);
      play(s, t, t + dur + 0.05, 0.2);
      break;
    }
  }
  for (const s of srcs) mix.sources.add(s);
  const last = lastSrc as AudioScheduledSourceNode | null;
  if (last)
    last.onended = () => {
      for (const s of srcs) mix.sources.delete(s);
      for (const n of nodes) n.disconnect();
    };
}
