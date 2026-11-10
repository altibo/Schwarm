// Hard House arranger: turns one bar plan into notes + bus automation. Pure and deterministic.
// Musical identity: a hook of the night (music/motif.ts) in call and response between two
// instruments, chord progressions per chapter key, qualitatively different energy levels, fills
// every 4/8/16 bars and arranged bus effects (stutter, tape stop, crush, delay throws, washes).
import type { BarPlan } from "./director.ts";
import type { Ev, Auto, Score } from "./arranger.ts";
import { HH, type HLevel } from "./pack/hardhouse.ts";
import { chordNotes, bassRootOf, phraseMotif, response, motifBar, degSemis, foldKey, type ChordDef, type Motif } from "./music/motif.ts";
import { rng, hash, euclid, clamp, type Rng } from "./rng.ts";

type HookVoice = HLevel["answerVoice"];
const pick = <T>(r: Rng, a: readonly T[]) => a[Math.floor(r() * a.length)];
const human = (r: Rng, v: number, amt = 0.08) => clamp(v * (1 - amt / 2 + r() * amt), 0, 1);

export function arrangeHH(plan: BarPlan): Score {
  const lv = HH.levels[plan.level - 1];
  const v = plan.variation;
  const r = rng(plan.seed);
  const ev: Ev[] = [];
  const add = (e: Ev) => ev.push(e);
  const key = plan.key;
  const groove = plan.section === "groove";
  const pb = plan.phraseBar;
  const prog = plan.section === "breakdown" ? HH.breakdownProgressions[(v.progression + plan.chapter) % HH.breakdownProgressions.length] : HH.progressions[(v.progression + plan.chapter) % HH.progressions.length];
  const fast = groove && plan.level >= 9;
  const chord: ChordDef = prog.chords[(fast ? Math.floor(pb / 2) : Math.floor(pb / 4)) % 4];
  const bassRoot = bassRootOf(chord, key);
  const pure = plan.hymn && (plan.sinceDrop < 16 || plan.level >= 8);
  const motif = phraseMotif(plan.nightSeed, plan.chapter, plan.chapterPhrase, pure);
  // Per-phrase decisions (same for all bars of a phrase / build block).
  const pr = rng(hash(plan.nightSeed, "hh", plan.phraseIndex, plan.section, plan.buildBlock, plan.chapter));
  const hookPlan = pure ? "full" : pick(pr, ["full", "full", "late", "sparse", "answers"] as const);
  const word = pick(pr, HH.words);
  const fill7 = pick(pr, ["snare", "throw", "stutter", "kickgap", "crush", "zap"] as const);
  const sw = v.swing * 0.5;
  const swing = (s: number) => (Math.floor(s) % 2 === 1 && s % 1 === 0 ? s + sw * 2 : s);
  const auto: Auto = { lp: [lv.lp, lv.lp], hp: [20, 20], drive: lv.drive, rumble: 0, rev: 0.1, duck: 0.5, gapAt: -1, trim: 0.74 };
  const stutter = (at: number, len: number, slice: number) => (auto.stutter ??= []).push({ at, len, slice });
  const hookBase = (voice: HookVoice) => (voice === "hoover" ? 53 : voice === "chop" ? 60 : voice === "rstab" ? 60 : 65);
  const hookNote = (deg: number, voice: HookVoice) => hookBase(voice) + foldKey(key) + degSemis(chord.deg + deg) + (chord.major && ((deg % 7) + 7) % 7 === 2 ? 1 : 0);
  /** Play one bar of a motif on a voice. `stretch` 2 = half time over two bars (`part` 0/1). */
  const playMotif = (m: Motif, half: number, voice: HookVoice, vel: number, o: { up?: number; oct?: number; rev?: number; dly?: number; cutoff?: number; stretch?: number; part?: number; layer?: string; until?: number } = {}) => {
    const stretch = o.stretch ?? 1;
    const notes = motifBar(m, half)
      .map((n) => ({ ...n, step: n.step * stretch - (o.part ?? 0) * 16, len: n.len * stretch }))
      .filter((n) => n.step >= 0 && n.step < (o.until ?? 16));
    let prev: number | undefined;
    notes.forEach((n, i) => {
      const note = hookNote(n.deg + (o.up ?? 0), voice) + (o.oct ?? 0);
      const legato = voice === "hoover" && prev !== undefined && i > 0 && notes[i - 1].step + notes[i - 1].len >= n.step;
      const e: Ev = { layer: o.layer ?? "hook", voice, step: swing(n.step), len: n.len * (voice === "rstab" ? 0.6 : voice === "chop" ? 0.9 : 1), vel: vel * n.acc, note, rev: o.rev ?? 0.15, dly: o.dly ?? 0.12, cutoff: o.cutoff, slideFrom: legato ? prev : undefined };
      if (voice === "rstab") e.notes = [note, note + 3, note + 7];
      if (voice === "chop") e.word = HH.words[(i + plan.chapter) % HH.words.length];
      add(e);
      prev = note;
    });
    return notes.length;
  };
  const chop = (step: number, vel: number, o: Partial<Ev> = {}) => add({ layer: "chop", voice: "chop", step, len: 1.6, vel, note: 60 + foldKey(key) + degSemis(chord.deg + 4), word, rev: 0.3, dly: 0.25, ...o });
  const kick = (s: number, vel: number) => add({ layer: "kick", voice: "hkick", step: s, len: 4, vel, tone: lv.kickDrive });
  const pad = (len: number, vel: number, seventh = true) => add({ layer: "pad", voice: "pad", step: 0, len, vel, notes: chordNotes(chord, key, 53, seventh), rev: 0.55 });

  if (groove) {
    const kickout = plan.fill === "kickout";
    // Kick: four on the floor, ghost/pickup variants from level 5.
    if (!(kickout && pb === 15)) {
      for (const s of [0, 4, 8, 12]) if (!(pb === 7 && fill7 === "kickgap" && s === 12 && lv.fx > 0.2)) kick(s, lv.kick);
      if (plan.level >= 5 && v.kick % 3 === 1) kick(14, 0.38);
      if (plan.level >= 5 && v.kick % 3 === 2 && pb % 2 === 1) kick(15, 0.32);
    } else for (const s of [0, 4]) kick(s, lv.kick);
    if (plan.drop) {
      add({ layer: "fx", voice: "crash", step: 0, len: 32, vel: 0.9 });
      add({ layer: "fx", voice: "impact", step: 0, len: 16, vel: 1 });
      chop(0, 0.9, { rev: 0.7, dly: 0.5, len: 3 });
      auto.wash = 0.35;
      auto.throwFb = 0.6;
    } else if (pb === 0 && plan.level >= 4) add({ layer: "fx", voice: "crash", step: 0, len: 24, vel: 0.4 });
    // Bass.
    const style = lv.bassPool[v.bass % lv.bassPool.length];
    const answer = pb % 4 === 3;
    const bassOff = kickout && pb === 15 ? 8 : 16;
    const bn = (s: number, semis: number, len: number, vel: number, voice: Ev["voice"] = "hbass") => {
      if (s >= bassOff) return;
      add({ layer: "bass", voice, step: swing(s), len, vel: human(r, vel * lv.bass, 0.05), note: bassRoot + semis, cutoff: 500 + plan.level * 150 });
    };
    const last = answer ? (pb % 8 === 7 ? 12 : 7) : 0;
    if (style === 0) for (const s of [2, 6, 10, 14]) bn(s, s === 14 ? last : 0, 1.5, 1);
    else if (style === 1) for (const s of [2, 6, 10, 14]) bn(s, s === 14 ? last || 12 * (pb % 2) : 0, 1.1, 1, "donk");
    else if (style === 2) {
      for (let s = 1; s < 16; s++) if (s % 4) bn(s, s === 15 ? last : s === 7 && pb % 2 ? 12 : 0, 0.8, s % 4 === 2 ? 1 : 0.62, "roll");
    }
    else if (style === 3) {
      for (const s of [2, 6, 10, 14]) {
        bn(s, (s === 14 ? last : 0) + 12, 1.6, 0.85, "hoover");
        bn(s, s === 14 ? last : 0, 1.4, 0.75);
      }
    } else if (style === 4) for (const s of [2, 3, 6, 7, 10, 11, 14, 15]) bn(s, s === 15 ? last : 0, 0.9, s % 2 ? 0.7 : 1);
    else for (const s of [2, 3, 6, 7, 10, 11, 14, 15]) bn(s, s % 2 ? (s === 15 ? last || 10 : 12) : 0, 0.8, s % 2 ? 0.65 : 1, "donk");
    if (lv.roll > 0 && style !== 2 && style !== 4 && style !== 5) for (const s of [3, 7, 11, 15]) bn(s, 0, 0.6, 0.38 * lv.roll, "roll");
    if (lv.reese > 0 && (fast ? pb % 2 === 0 : pb % 4 === 0) && !(kickout && pb === 15)) add({ layer: "reese", voice: "reese", step: 0, len: fast ? 32 : 64, vel: 0.5 * lv.reese, note: bassRoot + 12, cutoff: 380 + plan.level * 40 });
    // Hats, ride, claps, percussion.
    if (lv.hats > 0) {
      const g = rng(hash(plan.nightSeed, plan.phraseIndex, Math.floor(pb / 2), "hat"));
      for (let s = 0; s < 16; s++) {
        const off = s % 4 === 2;
        if (off && lv.openhat > 0) add({ layer: "openhat", voice: "drum", sample: "openhat", step: swing(s), len: 1.6, vel: human(r, 0.62 * lv.openhat), pan: -0.08 });
        else if (off) add({ layer: "hats", voice: "drum", sample: "hat", step: swing(s), len: 1, vel: human(r, 0.75 * lv.hats), pan: 0.1 });
        else if (s % 2 === 1 ? g() < lv.hat16 : g() < lv.hat16 * 0.6) add({ layer: "hats", voice: "noisehat", step: swing(s), len: 0.5, vel: 0.18 + g() * 0.18 * lv.hats, pan: s % 4 === 1 ? -0.2 : 0.2 });
      }
    }
    if (lv.ride > 0) {
      for (const s of [2, 6, 10, 14]) add({ layer: "ride", voice: "drum", sample: "ride", step: swing(s), len: 4, vel: 0.34 * lv.ride, pan: 0.25 });
      if (lv.ride >= 0.9) for (const s of [0, 4, 8, 12]) add({ layer: "ride", voice: "drum", sample: "ride", step: s, len: 2, vel: 0.16, pan: 0.3 });
    }
    if (lv.clap > 0) {
      for (const s of [4, 12]) {
        add({ layer: "clap", voice: "drum", sample: "clap", step: s, len: 2, vel: 0.75 * lv.clap, rev: 0.22 });
        if (plan.level >= 3) add({ layer: "clap", voice: "clapx", step: s, len: 2, vel: 0.7 * lv.clap, rev: 0.15 });
      }
      const c = v.clap % 4;
      if (c === 1) add({ layer: "clap", voice: "drum", sample: "clap", step: 15, len: 1, vel: 0.3 * lv.clap });
      if (c === 2) for (const s of [4, 12]) add({ layer: "clap", voice: "drum", sample: "snaredark", step: s, len: 2, vel: 0.5 * lv.clap });
      if (c === 3 && pb % 2 === 1) add({ layer: "clap", voice: "clapx", step: 14, len: 1, vel: 0.45 * lv.clap });
    }
    if (lv.snare > 0) for (const s of [7, 13]) if (rng(hash(plan.seed, s))() < lv.snare) add({ layer: "snare", voice: "drum", sample: "snare", step: swing(s), len: 1, vel: 0.22, pan: -0.1 });
    const percLayer = (name: string, p: typeof v.perc, amount: number, shift: number) => {
      if (amount <= 0) return;
      const pv = HH.percVoices[(p.voice + shift) % HH.percVoices.length];
      for (const s of euclid(p.k, 16, p.rot)) add({ layer: name, voice: "drum", sample: pv.sample, step: swing(s), len: 1, vel: human(r, pv.gain * amount * (s % 4 === 2 ? 0.85 : 0.6), 0.15), rate: p.rate, pan: pv.pan, dly: name === "perc2" ? 0.22 : 0.06 });
    };
    percLayer("perc", v.perc, lv.perc, 0);
    percLayer("perc2", v.perc2, lv.perc2, v.perc2.voice === v.perc.voice ? 1 : 0);
    // Hook of the night: call (bars 1–2 of 4) and response (bars 3–4) on two instruments.
    const g4 = pb % 4;
    const call = g4 < 2;
    const half = pb % 2;
    let hookNotes = 0;
    const hookOn =
      lv.hook > 0 &&
      (plan.level <= 2 ? call && pb % 8 < 2 : hookPlan === "full" || (hookPlan === "late" && pb >= 8) || (hookPlan === "sparse" && Math.floor(pb / 4) % 2 === 0) || (hookPlan === "answers" && !call));
    if (hookOn) {
      const up = Math.floor(pb / 4) % 2 === 1 && plan.level >= 6 && call ? 2 : 0; // sequence up in bars 5–8
      const m = call ? motif : response(motif, plan.phraseIndex);
      // Every other chapter the mid levels swap who calls and who answers (new colour, same hook).
      const swap = plan.chapter % 2 === 1 && plan.level >= 3 && plan.level <= 6;
      const voice = call !== swap ? lv.hookVoice : lv.answerVoice;
      const lp = plan.level <= 2 ? 900 + pb * 60 : undefined;
      hookNotes = playMotif(m, half, voice, (voice === "chop" ? 0.75 : 0.7) * lv.hook, { up, rev: voice === "pluck" ? 0.3 : 0.18, dly: voice === "pluck" ? 0.35 : 0.15, cutoff: lp });
      if (plan.level >= 9 && call) playMotif(m, half, "hoover", 0.35 * lv.hook, { up, oct: 12, layer: "hook2" });
      if (plan.level >= 10 && !call) playMotif(m, half, "rstab", 0.3, { oct: -12, layer: "hook2" });
    }
    // Rave stabs fill the bars without hook; chop answers every 4 bars.
    if (lv.stab > 0 && !hookNotes) {
      const pats = [[3, 10], [2, 7, 11], [6, 14], [3, 6, 11, 14]];
      for (const s of pats[v.stab % 4]) {
        const n = chordNotes(chord, key, 60);
        add({ layer: "stab", voice: "rstab", step: swing(s), len: 0.7, vel: 0.55 * lv.stab, notes: n, dly: 0.35, rev: 0.2 });
      }
    }
    if (lv.chop > 0 && g4 === 3 && !(hookOn && lv.answerVoice === "chop")) chop(14, 0.6 * lv.chop, { dly: pb % 8 === 7 ? 0.75 : 0.3 });
    if (lv.chop > 0 && pb % 8 === 7) auto.throwFb = 0.66;
    if (lv.pad > 0 && (fast ? pb % 2 === 0 : pb % 4 === 0)) pad(fast ? 32 : 64, 0.45 * lv.pad);
    if (lv.atmos > 0 && pb % 8 === 0) add({ layer: "atmos", voice: "atmos", step: 0, len: 128, vel: 0.5 * lv.atmos, rev: 0.4 });
    // Transitions every 4 / 8 / 16 bars.
    if (pb % 4 === 3 && pb !== 7 && pb !== 15 && plan.level >= 3) add({ layer: "openhat", voice: "drum", sample: "openhat", step: 15, len: 1, vel: 0.5 });
    if (pb === 7) {
      const f = lv.fx < 0.35 && (fill7 === "stutter" || fill7 === "crush") ? "snare" : fill7;
      if (f === "snare") for (let s = 12; s < 16; s++) add({ layer: "fill", voice: "drum", sample: "snare", step: s, len: 1, vel: 0.3 + (s - 12) * 0.12, rev: 0.2 });
      if (f === "throw") {
        chop(12, 0.75, { dly: 0.9, rev: 0.4 });
        auto.throwFb = 0.72;
      }
      if (f === "stutter") stutter(12, 4, plan.level >= 8 ? 0.5 : 1);
      if (f === "kickgap") add({ layer: "fx", voice: "revcrash", step: 8, len: 8, vel: 0.55 });
      if (f === "crush") auto.crush = { at: 8, len: 8, mix: 0.45 + lv.fx * 0.3 };
      if (f === "zap") add({ layer: "fx", voice: "zap", step: 14, len: 2, vel: 0.5, note: 60 + foldKey(key), dly: 0.5 });
    }
    if (plan.level >= 9 && pb === 11) auto.crush = { at: 12, len: 4, mix: 0.35 };
    if (pb === 15) {
      if (plan.fill === "big") {
        for (const s of [8, 10]) add({ layer: "fill", voice: "drum", sample: "snare", step: s, len: 2, vel: 0.45 });
        for (let s = 12; s < 14; s += 0.5) add({ layer: "fill", voice: "drum", sample: "snare", step: s, len: 0.5, vel: 0.5 + (s - 12) * 0.08 });
        for (let s = 14; s < 16; s += 0.25) add({ layer: "fill", voice: "drum", sample: "snare", step: s, len: 0.25, vel: 0.6 + (s - 14) * 0.1, rate: 1 + (s - 14) * 0.1 });
        for (const [s, rate] of [[13, 1.25], [14, 1], [15, 0.8]] as const) add({ layer: "fill", voice: "drum", sample: "tom", step: s, len: 2, vel: 0.55, rate });
        add({ layer: "fx", voice: "revcrash", step: 0, len: 16, vel: 0.45 });
        if (lv.fx >= 0.5) stutter(14, 2, 0.5);
      } else if (kickout) {
        add({ layer: "fx", voice: "riser", step: 0, len: 16, vel: 0.5, from: 0.4 });
        auto.hp = [20, 700];
        if (lv.fx >= 0.45) auto.tape = { at: 12, len: 4 };
        else auto.gapAt = 14;
      } else if (plan.fill === "small") {
        for (const s of [12, 13.5, 14.5]) add({ layer: "fill", voice: "clapx", step: s, len: 1, vel: 0.55 });
        chop(14, 0.7, { rev: 0.8, dly: 0.6 });
        auto.wash = 0.25;
      }
    }
    // Filter moves (director's "Filterfahrt").
    const base = lv.lp;
    const f = (b: number) => (v.filterMove === 1 ? base * (0.3 + 0.7 * Math.abs(Math.cos((Math.PI * b) / 16))) : v.filterMove === 2 ? base * (0.25 + 0.75 * Math.min(1, b / 12)) : base);
    if (auto.hp[1] <= 20) auto.lp = [f(pb), f(pb + 1)];
    if (v.filterMove === 3 && pb >= 12) auto.hp = [20 + (pb - 12) * 70, 20 + (pb - 11) * 70];
  } else if (plan.section === "breakdown") {
    const b = plan.sectionBar;
    auto.duck = 0;
    auto.rev = 0.35;
    auto.lp = [1200 + b * 380, 1200 + (b + 1) * 380];
    auto.drive = 0.05;
    if (b % 4 === 0) {
      pad(64, 0.75);
      add({ layer: "reese", voice: "reese", step: 0, len: 62, vel: 0.42, note: bassRoot + 12, cutoff: 300 + b * 20 });
    }
    if (b % 8 === 0) add({ layer: "atmos", voice: "atmos", step: 0, len: 128, vel: 0.7, rev: 0.5 });
    if (b === 0) {
      add({ layer: "fx", voice: "crash", step: 0, len: 32, vel: 0.5 });
      add({ layer: "fx", voice: "downlifter", step: 0, len: 32, vel: 0.5 });
      chop(0, 0.75, { rev: 0.9, dly: 0.6, len: 4 });
      auto.wash = 0.5;
      auto.throwFb = 0.65;
    }
    const g4 = b % 4;
    if (b < 8) {
      // the hook, half time on a pluck with long delay: the theme in the new key
      const m = g4 < 2 ? motif : response(motif, plan.phraseIndex);
      playMotif(m, 0, "pluck", 0.55, { stretch: 2, part: g4 % 2, rev: 0.6, dly: 0.45 });
    } else {
      const m = g4 < 2 ? motif : response(motif, plan.phraseIndex);
      playMotif(m, b % 2, "hoover", 0.35 + (b - 8) * 0.04, { cutoff: 700 + (b - 8) * 260, rev: 0.45, dly: 0.25 });
      for (const s of [2, 6, 10, 14]) add({ layer: "hats", voice: "drum", sample: "shaker", step: s, len: 1, vel: 0.22 + (b - 8) * 0.03, pan: 0.3 });
      if (b >= 12) for (const s of [4, 12]) add({ layer: "clap", voice: "clapx", step: s, len: 2, vel: 0.3 + (b - 12) * 0.08, rev: 0.5 });
    }
    if (b % 4 === 3) {
      chop(14, 0.5, { rev: 0.7, dly: 0.7 });
      auto.throwFb = 0.7;
    }
    if (b === 15) {
      add({ layer: "fx", voice: "revcrash", step: 0, len: 16, vel: 0.5 });
      auto.wash = 0.4;
    }
  } else {
    // Build-up: 8-bar blocks. Accelerating snare roll, kick roll, riser, high-pass sweep,
    // the hook gets louder and moves from stab to hoover; the last bar stutters into a gap or
    // a tape stop, the drop lands on the next one.
    const b = plan.sectionBar;
    const blk = plan.buildBlock;
    const t = (b + 1) / 8;
    auto.duck = 0.35;
    auto.rev = 0.22 + t * 0.2;
    const hpStart = 30 + blk * 60;
    auto.hp = [hpStart + (b / 8) * (420 + blk * 60), hpStart + ((b + 1) / 8) * (420 + blk * 60)];
    auto.lp = [8000 + b * 800, 8800 + b * 800];
    auto.drive = 0.18 + t * 0.1;
    const final = plan.preDrop && b === 7;
    if (b === 0) add({ layer: "fx", voice: "riser", step: 0, len: 128, vel: 0.55 + blk * 0.1, from: Math.min(0.5, blk * 0.2) });
    const kickEnd = final ? 12 : 16;
    const kick8 = b >= 6 || (blk > 0 && b >= 4);
    for (let s = 0; s < kickEnd; s += kick8 ? 2 : 4) kick(s, s % 4 ? 0.6 : 0.85);
    if (b % 4 === 0) pad(64, 0.45, false);
    const g4 = b % 4;
    const m = g4 < 2 ? motif : response(motif, plan.phraseIndex);
    playMotif(m, b % 2, blk === 0 && b < 4 ? "rstab" : "hoover", 0.4 + t * 0.3, { cutoff: 900 + t * 3000 + blk * 800, rev: 0.25, dly: 0.2, until: final ? 12 : 16 });
    if (blk === 0 && b < 4) for (const s of [2, 6, 10, 14]) add({ layer: "bass", voice: "hbass", step: s, len: 1.2, vel: 0.6, note: bassRoot, cutoff: 900 });
    const level = blk + (b >= 2 ? 1 : 0) + (b >= 4 ? 1 : 0) + (b >= 6 ? 1 : 0);
    const division = final ? 0.5 : [4, 2, 1, 1, 0.5, 0.5][Math.min(5, level)];
    const end = final ? 12 : 16;
    for (let s = 0; s < end; s += division)
      add({ layer: "fill", voice: "drum", sample: "snare", step: s, len: division, vel: clamp(0.28 + t * 0.5 + (s / 16) * 0.12), rate: 1 + (blk * 8 + b) * 0.025, rev: 0.2 });
    for (let s = 2; s < end; s += 4) add({ layer: "openhat", voice: "drum", sample: "openhat", step: s, len: 1, vel: 0.3 + t * 0.3 });
    if (b % 2 === 1 && !final) chop(14, 0.45 + t * 0.3, { dly: 0.5 });
    if (final) chop(6, 0.7, { dly: 0.6, rev: 0.5 });
    if (final) {
      stutter(8, 4, 1);
      stutter(12, 2, 0.5);
      add({ layer: "fx", voice: "riser", step: 0, len: 14, vel: 0.5, from: 0.6 });
      auto.hp = [auto.hp[0], 900];
      if (plan.drops % 2 === 1) auto.tape = { at: 14, len: 2 };
      else auto.gapAt = 14;
    }
  }
  ev.sort((a, b) => a.step - b.step);
  return { plan, events: ev, auto };
}
