// Turns one bar plan into concrete note events + automation. Pure and deterministic.
import type { BarPlan } from "./director.ts";
import { PACK, KEY_ROOT, chordTones, type Hit, type Chord } from "./pack/techno.ts";
import { rng, hash, euclid, clamp, type Rng } from "./rng.ts";

export type Voice =
  | "kick" | "drum" | "noisehat" | "sub" | "fm" | "saw" | "acid" | "pad" | "stab" | "lead"
  | "riser" | "crash" | "impact" | "downlifter" | "atmos";
export interface Ev {
  layer: string;
  voice: Voice;
  /** Position in 16th steps from the start of the bar (fractional for swing / 32nds). */
  step: number;
  /** Length in 16th steps (may exceed the bar). */
  len: number;
  vel: number;
  note?: number;
  notes?: number[];
  sample?: string;
  rate?: number;
  pan?: number;
  rev?: number;
  dly?: number;
  tone?: number;
  cutoff?: number;
  accent?: boolean;
  slideFrom?: number;
  from?: number;
}
export interface Auto {
  lp: [number, number];
  hp: [number, number];
  drive: number;
  rumble: number;
  rev: number;
  duck: number;
  /** Step from which everything except reverb tails is silent until the bar ends (pre-drop gap). */
  gapAt: number;
}
export interface Score {
  plan: BarPlan;
  events: Ev[];
  auto: Auto;
}
const tones = (ch: Chord, base: number) => chordTones(ch).map((t) => base + ((ch.root + t) % 12));
const swingAt = (step: number, swing: number) => (step % 2 === 1 ? step + swing * 2 : step);
const human = (r: Rng, v: number, amt = 0.08) => clamp(v * (1 - amt / 2 + r() * amt), 0, 1);

/** Acid line for a seed; `mutation` changes 1–2 steps per 4-bar group so it evolves. */
export function acidLine(seed: number, mutation: number) {
  const r = rng(seed);
  const pool = [0, 0, 0, 12, 3, 7, 10, -2, 5, 0, 12];
  const steps = Array.from({ length: 16 }, (_, i) => ({
    on: i % 4 === 0 ? r() < 0.35 : r() < 0.62,
    semis: pool[Math.floor(r() * pool.length)],
    accent: r() < 0.3,
    slide: r() < 0.18,
  }));
  const m = rng(hash(seed, "mut", mutation));
  for (let k = 0; k < (mutation ? 1 + Math.floor(m() * 2) : 0); k++) {
    const i = Math.floor(m() * 16);
    steps[i] = { ...steps[i], on: !steps[i].on || m() < 0.5, semis: pool[Math.floor(m() * pool.length)] };
  }
  return steps;
}

export function arrange(plan: BarPlan): Score {
  const lv = PACK.levels[plan.level - 1];
  const v = plan.variation;
  const r = rng(plan.seed);
  const ev: Ev[] = [];
  const add = (e: Ev) => ev.push(e);
  const prog = PACK.progressions[v.progression];
  const chord = prog.chords[Math.floor(plan.phraseBar / 4) % 4];
  const bassRoot = KEY_ROOT + chord.root;
  const sw = v.swing;
  const auto: Auto = { lp: [lv.lp, lv.lp], hp: [20, 20], drive: lv.drive, rumble: lv.rumble, rev: 0.12, duck: plan.level >= 3 ? 0.55 : 0.3, gapAt: -1 };
  const hits = (layer: string, list: Hit[], mk: (step: number, vel: number) => Ev | null) => {
    for (const [s, vel] of list) {
      const e = mk(s, vel);
      if (e) add({ ...e, layer });
    }
  };

  if (plan.section === "groove") {
    const pb = plan.phraseBar;
    const kickout = plan.fill === "kickout";
    // Kick
    if (lv.kick > 0 && !kickout) {
      const pat = PACK.kicks[plan.level >= 4 ? v.kick : 0].hits;
      hits("kick", pat, (s, vel) => ({ layer: "kick", voice: "kick", step: s, len: 4, vel: vel * lv.kick, tone: lv.kickTone, sample: undefined }));
    }
    if (plan.drop) {
      add({ layer: "fx", voice: "crash", step: 0, len: 32, vel: 0.9 });
      add({ layer: "fx", voice: "impact", step: 0, len: 16, vel: 1 });
      add({ layer: "fx", voice: "downlifter", step: 0, len: 32, vel: 0.6 });
      add({ layer: "drum", voice: "drum", sample: "ride", step: 0, len: 16, vel: 0.5, pan: 0.2 });
    } else if (pb === 0 && plan.level >= 5 && r() < 0.5) add({ layer: "fx", voice: "crash", step: 0, len: 24, vel: 0.45 });
    // Bass
    if (lv.bass > 0) {
      const pool = plan.level < 5 ? [0, 6, 2] : null;
      const pat = PACK.bass[pool ? pool[v.bass % 3] : v.bass];
      const answer = pb % 4 === 3;
      pat.notes.forEach(([s, len, semis, vel], i) => {
        if (kickout && s >= 8) return;
        let n = bassRoot + semis;
        if (answer && i === pat.notes.length - 1) n = bassRoot + (r() < 0.5 ? 7 : 12);
        const voice = pat.voice === "saw" ? "saw" : pat.voice === "fm" ? "fm" : "sub";
        add({ layer: "bass", voice, step: swingAt(s, sw), len, vel: human(r, vel * lv.bass, 0.06), note: n, cutoff: 500 + plan.level * 120 });
      });
    }
    // Acid line
    if (v.acidOn && lv.acid > 0) {
      const line = acidLine(v.acidSeed, Math.floor(pb / 4));
      let prev: number | undefined;
      line.forEach((st, i) => {
        if (!st.on) return (prev = undefined);
        const note = KEY_ROOT + 12 + chord.root + st.semis;
        const open = 0.25 + 0.75 * ((pb % 8) / 7);
        add({ layer: "acid", voice: "acid", step: swingAt(i, sw), len: st.slide ? 1.05 : 0.6, vel: (st.accent ? 1 : 0.7) * lv.acid, note, accent: st.accent, slideFrom: st.slide ? prev : undefined, cutoff: 350 + open * (900 + plan.level * 220) });
        prev = note;
      });
    }
    // Hats: pattern + generative ghosts (re-seeded every 2 bars so the groove repeats briefly)
    if (lv.hats > 0) {
      const pat = PACK.hats[plan.level < 4 ? 0 : v.hats].hits;
      const g = rng(hash(v.acidSeed, plan.phraseIndex, Math.floor(pb / 2)));
      const taken = new Set(pat.map(([s]) => s));
      hits("hats", pat, (s, vel) => ({ layer: "hats", voice: "drum", sample: "hat", step: swingAt(s, sw), len: 1, vel: human(r, vel * lv.hats * 0.75), pan: 0.12 }));
      for (let s = 0; s < 16; s++)
        if (!taken.has(s) && g() < lv.ghost) add({ layer: "hats", voice: "noisehat", step: swingAt(s, sw), len: 0.5, vel: 0.2 + g() * 0.2, pan: -0.15 });
      if (plan.level >= 9 && pb % 2 === 1) add({ layer: "hats", voice: "noisehat", step: 15.5, len: 0.5, vel: 0.35, pan: 0.2 });
    }
    if (lv.openhat > 0) {
      const steps = v.hats % 2 ? [6, 14] : [2, 6, 10, 14];
      for (const s of steps) add({ layer: "openhat", voice: "drum", sample: "openhat", step: swingAt(s, sw), len: 2, vel: human(r, 0.55 * lv.openhat), pan: -0.1 });
    }
    // Clap / snare
    if (lv.clap > 0) {
      const cl = PACK.claps[v.clap];
      hits("clap", cl.hits, (s, vel) => ({ layer: "clap", voice: "drum", sample: vel < 0.5 && s === 7 ? "rim" : "clap", step: s, len: 2, vel: vel * lv.clap * 0.8, rev: 0.25 }));
      if (cl.snare || plan.level >= 9) for (const s of [4, 12]) add({ layer: "clap", voice: "drum", sample: "snaredark", step: s, len: 2, vel: 0.55 * lv.clap });
    }
    // Percussion: two euclidean layers
    const percLayer = (name: string, p: typeof v.perc, amount: number, shift: number) => {
      if (amount <= 0) return;
      const voice = PACK.percVoices[(p.voice + shift) % PACK.percVoices.length];
      for (const s of euclid(p.k, 16, p.rot)) add({ layer: name, voice: "drum", sample: voice.sample, step: swingAt(s, sw), len: 1, vel: human(r, voice.gain * amount * (s % 4 === 2 ? 0.9 : 0.65), 0.15), rate: p.rate, pan: voice.pan, dly: name === "perc2" ? 0.25 : 0.08 });
    };
    percLayer("perc", v.perc, lv.perc, 0);
    percLayer("perc2", v.perc2, lv.perc2, v.perc2.voice === v.perc.voice ? 1 : 0);
    if (lv.ride > 0) for (const s of [2, 6, 10, 14]) add({ layer: "ride", voice: "drum", sample: "ride", step: s, len: 4, vel: 0.32 * lv.ride, pan: 0.25 });
    // Chord stab (dub-techno style with delay)
    if (v.stabOn && lv.stab > 0) {
      const pat = PACK.stabs[v.stab].hits.filter((_, i) => pb % 4 !== 3 || i !== 0);
      hits("stab", pat, (s, vel) => ({ layer: "stab", voice: "stab", step: swingAt(s, sw), len: 1, vel: vel * lv.stab * 0.7, notes: tones(chord, 53), dly: 0.45, rev: 0.2 }));
    }
    if (lv.pad > 0 && pb % 4 === 0) add({ layer: "pad", voice: "pad", step: 0, len: 64, vel: 0.5 * lv.pad, notes: tones(chord, 53), rev: 0.5 });
    if (lv.atmos > 0 && pb % 8 === 0) add({ layer: "atmos", voice: "atmos", step: 0, len: 128, vel: 0.5 * lv.atmos, rev: 0.4 });
    if (plan.hymn && lv.lead > 0 && pb >= 8) hymnBar(add, pb % 2, 0.55 * lv.lead, 0.3);
    // Fills
    if (plan.fill === "small") for (let s = 12; s < 16; s++) add({ layer: "fill", voice: "drum", sample: "snare", step: s, len: 1, vel: 0.35 + (s - 12) * 0.12, rev: 0.2 });
    if (plan.fill === "big") {
      for (let s = 8; s < 12; s++) add({ layer: "fill", voice: "drum", sample: "snare", step: s, len: 1, vel: 0.35 + (s - 8) * 0.06 });
      for (let s = 12; s < 16; s += 0.5) add({ layer: "fill", voice: "drum", sample: "snare", step: s, len: 0.5, vel: 0.5 + (s - 12) * 0.08 });
      for (const [s, rate] of [[13, 1.2], [14, 1], [15, 0.85]] as const) add({ layer: "fill", voice: "drum", sample: "tom", step: s, len: 2, vel: 0.6, rate });
    }
    if (kickout) add({ layer: "fx", voice: "riser", step: 0, len: 16, vel: 0.5, from: 0.4 });
    // Filter automation (moves)
    const base = lv.lp;
    const f = (b: number) => {
      if (v.filterMove === 1) return base * (0.3 + 0.7 * Math.abs(Math.cos((Math.PI * b) / 16)));
      if (v.filterMove === 2) return base * (0.25 + 0.75 * Math.min(1, b / 12));
      return base;
    };
    auto.lp = [f(pb), f(pb + 1)];
    if (v.filterMove === 3 && pb >= 12) auto.hp = [20 + (pb - 12) * 60, 20 + (pb - 11) * 60];
    if (plan.sinceDrop < 1) auto.rev = 0.2;
  } else if (plan.section === "breakdown") {
    const b = plan.sectionBar;
    auto.rumble = 0;
    auto.duck = 0;
    auto.rev = 0.35;
    auto.lp = [1600 + b * 260, 1600 + (b + 1) * 260];
    auto.drive = 0.05;
    if (b % 4 === 0) {
      add({ layer: "pad", voice: "pad", step: 0, len: 64, vel: 0.75, notes: tones(chord, 53), rev: 0.6 });
      add({ layer: "bass", voice: "sub", step: 0, len: 60, vel: 0.45, note: bassRoot });
    }
    if (b % 8 === 0) add({ layer: "atmos", voice: "atmos", step: 0, len: 128, vel: 0.7, rev: 0.5 });
    if (b >= 4) hymnBar(add, b % 2, 0.6, 0.6);
    if (b % 2 === 1) add({ layer: "stab", voice: "stab", step: 3, len: 1, vel: 0.45, notes: tones(chord, 53), dly: 0.6, rev: 0.4 });
    if (b >= 8) for (const s of [2, 6, 10, 14]) add({ layer: "hats", voice: "drum", sample: "shaker", step: s, len: 1, vel: 0.25 + (b - 8) * 0.03, pan: 0.3 });
    if (b === 0) add({ layer: "fx", voice: "crash", step: 0, len: 32, vel: 0.5 });
  } else {
    // Build-up: 8-bar blocks with a rising roll, riser and high-pass; drop on the next one.
    const b = plan.sectionBar;
    const blk = plan.buildBlock;
    const t = (b + 1) / 8;
    auto.rumble = 0;
    auto.duck = 0.35;
    auto.rev = 0.25 + t * 0.2;
    const hpStart = 30 + blk * 60;
    auto.hp = [hpStart + (b / 8) * (380 + blk * 40), hpStart + ((b + 1) / 8) * (380 + blk * 40)];
    auto.lp = [9000, 12000];
    auto.drive = 0.15;
    if (b === 0) add({ layer: "fx", voice: "riser", step: 0, len: 128, vel: 0.55 + blk * 0.1, from: Math.min(0.5, blk * 0.2) });
    for (const s of [0, 4, 8, 12]) add({ layer: "kick", voice: "kick", step: s, len: 4, vel: 0.85, tone: 0.3 + blk * 0.2 });
    if (b % 4 === 0) add({ layer: "pad", voice: "pad", step: 0, len: 64, vel: 0.55, notes: tones(chord, 53), rev: 0.5 });
    if (b < 4 && blk === 0) hymnBar(add, b % 2, 0.4, 0.5);
    const finalBars = plan.preDrop;
    const division = finalBars && b === 7 ? 0.5 : b >= 4 || blk > 0 ? 1 : b >= 2 ? 2 : 4;
    const end = finalBars && b === 7 ? 14 : 16;
    for (let s = 0; s < end; s += division)
      add({ layer: "fill", voice: "drum", sample: "snare", step: s, len: division, vel: clamp(0.3 + t * 0.5 + (s / 16) * 0.1), rate: 1 + t * 0.25, rev: 0.2 });
    for (let s = 2; s < end; s += 4) add({ layer: "hats", voice: "noisehat", step: s, len: 0.5, vel: 0.3 + t * 0.3 });
    if (finalBars && b === 7) {
      add({ layer: "fx", voice: "riser", step: 0, len: 14, vel: 0.5, from: 0.6 });
      auto.gapAt = 14;
      auto.hp = [auto.hp[0], 900];
    }
  }
  ev.sort((a, b) => a.step - b.step);
  return { plan, events: ev, auto };
}
function hymnBar(add: (e: Ev) => void, half: number, vel: number, rev: number) {
  for (const [s, note, len] of PACK.hymn) {
    const local = s - half * 16;
    if (local >= 0 && local < 16) add({ layer: "lead", voice: "lead", step: local, len, vel, note, rev, dly: 0.3 });
  }
}
/** Symbolic fingerprint of a bar. "exact" includes velocities (humanised per bar) and filter
 * values; "structure" only which sounds play which notes on which steps, so velocity jitter
 * alone never counts as a new variant. */
export function fingerprint(score: Score, mode: "exact" | "structure" = "structure"): string {
  const body = score.events
    .map((e) => `${e.layer}:${e.voice}:${e.sample ?? ""}:${e.step.toFixed(3)}:${e.note ?? (e.notes ?? []).join("/")}` + (mode === "exact" ? `:${e.vel.toFixed(2)}:${(e.rate ?? 1).toFixed(2)}` : ""))
    .join("|");
  return mode === "exact" ? `${body}#${score.auto.lp.map(Math.round).join("-")}:${score.auto.hp.map(Math.round).join("-")}:${score.auto.gapAt}` : body;
}
