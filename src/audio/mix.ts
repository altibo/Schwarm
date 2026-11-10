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
  musicIn.connect(lp).connect(hp).connect(duck).connect(gap).connect(preMaster);
  // Kick: fixed saturation for harmonics, then straight to the master (never ducked).
  const kickSat = ctx.createWaveShaper();
  kickSat.curve = tanhCurve(1.8, 0.95);
  kickSat.oversample = "2x";
  kickIn.connect(kickSat).connect(gap);
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
  ceiling.curve = tanhCurve(1.3, 0.93, 4097);
  driveSum.connect(limiter).connect(ceiling).connect(destination);
  return {
    ctx, lib, noise: noiseBuffer(ctx, 2, 303), musicIn, kickIn, fxIn, revIn, dlyIn, lp, hp, duck, rumbleDuck,
    rumbleSend, musicRev, gap, delay, driveWet, driveDry, output: ceiling, sources: new Set(), voices: 0,
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
  mix.musicRev.gain.setValueAtTime(a.rev, t0);
  mix.delay.delayTime.setValueAtTime(3 * step, t0);
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
  if (["riser", "crash", "impact", "downlifter"].includes(e.voice)) dest = mix.fxIn;
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
