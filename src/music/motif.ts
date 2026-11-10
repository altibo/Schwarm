// Musical identity for a night: a theme (2-bar hook) derived from the night seed, developed
// chapter by chapter (cumulative mutation, occasional new rhythm with the old contour) and
// phrase by phrase (one more small mutation per phrase), played as call and response.
// Pure and deterministic; degrees are diatonic (natural minor) relative to the current chord.
import { rng, hash } from "../rng.ts";

export const SCALE = [0, 2, 3, 5, 7, 8, 10];
const mod = (a: number, n: number) => ((a % n) + n) % n;
/** Semitones of a diatonic degree (0 = tonic, 7 = octave). */
export const degSemis = (d: number) => 12 * Math.floor(d / 7) + SCALE[mod(d, 7)];
/** Fold a key shift into −5…+6 so registers stay put when the key wanders. */
export const foldKey = (k: number) => mod(k + 5, 12) - 5;

export interface ChordDef {
  deg: number;
  /** Raised third (harmonic-minor V). */
  major?: boolean;
}
export interface Progression {
  name: string;
  chords: ChordDef[];
}
/** Chord tones (midi) in close voicing from `base` (+ key), optional seventh. */
export function chordNotes(ch: ChordDef, key: number, base: number, seventh = false): number[] {
  const degs = seventh ? [0, 2, 4, 6] : [0, 2, 4];
  const root = base + foldKey(key);
  return degs.map((x, i) => {
    let n = root + degSemis(ch.deg + x);
    if (i === 1 && ch.major) n += 1;
    while (n > base + 14) n -= 12;
    return n;
  });
}
/** Bass root of a chord (midi), folded into F1…E2 around 29. */
export function bassRootOf(ch: ChordDef, key: number) {
  const s = mod(foldKey(key) + degSemis(ch.deg), 12);
  return 29 + (s > 7 ? s - 12 : s);
}
export interface MNote {
  step: number; // 0–31 (two bars)
  deg: number;
  len: number;
  acc: number;
}
export interface Motif {
  notes: MNote[];
  rhythm: number;
}
export const RHYTHMS: number[][] = [
  [0, 3, 6, 10, 12, 14, 16, 19, 22, 26, 28],
  [2, 6, 10, 11, 14, 18, 22, 26, 27, 30],
  [0, 3, 6, 8, 11, 14, 16, 19, 22, 24, 27, 30],
  [0, 2, 4, 7, 10, 12, 16, 18, 20, 23, 26, 28, 30],
  [3, 6, 11, 14, 19, 22, 24, 27, 30],
  [0, 3, 7, 10, 14, 16, 19, 23, 24, 26],
];
const withLens = (steps: number[], degs: number[], accs?: number[]): MNote[] =>
  steps.map((s, i) => {
    const nx = i + 1 < steps.length ? steps[i + 1] : 32;
    return { step: s, deg: degs[i % degs.length], len: Math.max(1, Math.min(3, nx - s)), acc: accs ? accs[i % accs.length] : s % 4 === 0 ? 1 : 0.8 };
  });
/** The theme of the night: rhythm cell + a singable contour (bar 2 repeats bar 1's start). */
export function theme(seed: number): Motif {
  const r = rng(hash(seed, "theme"));
  const rhythm = Math.floor(r() * RHYTHMS.length);
  const steps = RHYTHMS[rhythm];
  const firstBar = steps.filter((s) => s < 16).length;
  const degs: number[] = [];
  let d = [0, 2, 4][Math.floor(r() * 3)];
  for (let i = 0; i < steps.length; i++) {
    if (i >= firstBar && i < firstBar + Math.ceil(firstBar / 2)) {
      degs.push(degs[i - firstBar]); // repetition makes it a hook
      continue;
    }
    if (i > 0) {
      const leap = r();
      d += leap < 0.45 ? (r() < 0.5 ? 1 : -1) : leap < 0.8 ? (r() < 0.5 ? 2 : -2) : leap < 0.92 ? 0 : r() < 0.5 ? 4 : -3;
      d = Math.max(-2, Math.min(9, d));
    }
    degs.push(d);
  }
  degs[firstBar - 1] = r() < 0.5 ? 4 : 1; // call bar 1 ends open
  degs[steps.length - 1] = [4, 2, 1][Math.floor(r() * 3)]; // and the whole call too
  return { notes: withLens(steps, degs), rhythm };
}
/** Apply `k` small edits (cumulative: mutate(m, k+1) = mutate(m, k) + one more edit). */
export function mutate(m: Motif, k: number, seed: number): Motif {
  const notes = m.notes.map((n) => ({ ...n }));
  for (let i = 0; i < k; i++) {
    const r = rng(hash(seed, "mut", i));
    const op = Math.floor(r() * 6);
    const j = Math.floor(r() * notes.length);
    const n = notes[j];
    if (op === 0) n.deg += r() < 0.5 ? 1 : -1;
    else if (op === 1) {
      const to = n.step + (r() < 0.5 ? 1 : -1);
      if (to >= 0 && to < 32 && Math.floor(to / 16) === Math.floor(n.step / 16) && !notes.some((x) => x.step === to)) n.step = to;
    } else if (op === 2 && notes.length > 6) notes.splice(j, 1);
    else if (op === 3) {
      const free = Array.from({ length: 32 }, (_, s) => s).filter((s) => !notes.some((x) => x.step === s) && s % 2 === 0);
      if (free.length) {
        const s = free[Math.floor(r() * free.length)];
        const near = notes.reduce((a, b) => (Math.abs(b.step - s) < Math.abs(a.step - s) ? b : a));
        notes.push({ step: s, deg: near.deg + (r() < 0.5 ? 1 : -1), len: 1, acc: 0.7 });
      }
    } else if (op === 4) n.deg = n.deg < 5 ? n.deg + 7 : n.deg - 7;
    else if (op === 5 && j + 1 < notes.length) [n.deg, notes[j + 1].deg] = [notes[j + 1].deg, n.deg];
  }
  notes.sort((a, b) => a.step - b.step);
  for (let i = 0; i < notes.length; i++) {
    const nx = i + 1 < notes.length ? notes[i + 1].step : 32;
    notes[i].len = Math.max(0.75, Math.min(notes[i].len, nx - notes[i].step));
  }
  return { notes, rhythm: m.rhythm };
}
/** Motif of a chapter: the theme, developed further with every chapter; every third chapter
 * the contour moves onto a new rhythm cell (same melody, new groove). */
export function chapterMotif(nightSeed: number, chapter: number): Motif {
  let m = theme(nightSeed);
  for (let c = 1; c <= chapter; c++) {
    if (c % 3 === 2) {
      const rhythm = (m.rhythm + 1 + (hash(nightSeed, "rh", c) % (RHYTHMS.length - 1))) % RHYTHMS.length;
      const degs = m.notes.map((n) => n.deg);
      m = { notes: withLens(RHYTHMS[rhythm], degs), rhythm };
    }
    m = mutate(m, 2, hash(nightSeed, "chapter", c));
  }
  return m;
}
/** Motif for one phrase: chapter motif + one more edit per phrase (capped), the pure chapter
 * motif when the hymn returns (peaks, right after drops). */
export function phraseMotif(nightSeed: number, chapter: number, chapterPhrase: number, pure: boolean): Motif {
  const m = chapterMotif(nightSeed, chapter);
  return pure ? m : mutate(m, Math.min(5, chapterPhrase), hash(nightSeed, "phrase", chapter));
}
/** The answer: same start, second bar resolves (to the tonic) or sequences down. */
export function response(m: Motif, variant: number): Motif {
  const notes = m.notes.map((n) => ({ ...n }));
  const second = notes.filter((n) => n.step >= 16);
  if (variant % 2 === 0) {
    second.forEach((n, i) => {
      if (i >= second.length - 2) n.deg = i === second.length - 1 ? 0 : n.deg > 2 ? 2 : -1;
    });
  } else for (const n of second) n.deg -= 2;
  return { notes, rhythm: m.rhythm };
}
/** Notes of a motif inside one bar (`half` 0/1) as [step, degree, len, acc]. */
export const motifBar = (m: Motif, half: number) => m.notes.filter((n) => Math.floor(n.step / 16) === half).map((n) => ({ ...n, step: n.step - half * 16 }));
