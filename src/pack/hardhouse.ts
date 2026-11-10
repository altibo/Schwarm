// Style pack "Hard House · Krass" (default): 140–150 BPM, offbeat/rolling/hoover basses, pitched
// rave stabs, claps, ride + open hats, reese, synthesized formant "vocal" chops and a hook of the
// night (see music/motif.ts). Own compositions and synthesis; ANUUK/Berlin hard bouncy techno is
// a style direction only (no copied melodies, samples or vocals).
import type { Progression } from "../music/motif.ts";
export interface HLevel {
  kick: number;
  kickDrive: number; // 0 soft … 1 hard distorted
  bass: number;
  bassPool: number[]; // bass styles allowed at this level (index into BASS)
  roll: number; // rolling 16th ghost bass under the main bass
  reese: number;
  hats: number;
  hat16: number; // share of 16th hats
  openhat: number;
  ride: number;
  clap: number;
  snare: number; // ghost snares
  perc: number;
  perc2: number;
  stab: number;
  chop: number;
  hook: number;
  hookVoice: "pluck" | "rstab" | "hoover";
  answerVoice: "pluck" | "rstab" | "chop" | "hoover";
  pad: number;
  atmos: number;
  drive: number;
  lp: number;
  fx: number; // how often the arranger uses stutter / crush / tape / throws (0–1)
}
const L = (o: Partial<HLevel>): HLevel => ({
  kick: 1, kickDrive: 0.6, bass: 0, bassPool: [0], roll: 0, reese: 0, hats: 0, hat16: 0, openhat: 0, ride: 0, clap: 0, snare: 0,
  perc: 0, perc2: 0, stab: 0, chop: 0, hook: 0, hookVoice: "pluck", answerVoice: "pluck", pad: 0, atmos: 0, drive: 0.12, lp: 18000, fx: 0, ...o,
});
export const BASS = ["Sub-Offbeat", "Donk", "Rollend", "Hoover-Bass", "Galopp", "Oktav-Bounce"] as const;
export const HH = {
  id: "hardhouse-krass",
  name: "Hard House · Krass",
  levels: [
    L({ kick: 0.75, kickDrive: 0.25, bass: 0.65, bassPool: [0], hats: 0.5, perc: 0.5, pad: 0.45, atmos: 0.7, hook: 0.45, hookVoice: "pluck", answerVoice: "pluck", lp: 2600 }),
    L({ kick: 0.85, kickDrive: 0.35, bass: 0.75, bassPool: [0, 1], hats: 0.6, ride: 0.3, clap: 0.45, perc: 0.55, chop: 0.35, pad: 0.35, atmos: 0.55, hook: 0.5, answerVoice: "chop", lp: 4200, fx: 0.1 }),
    L({ kick: 0.92, kickDrive: 0.45, bass: 0.85, bassPool: [1, 0, 4], hats: 0.7, openhat: 0.35, ride: 0.4, clap: 0.8, perc: 0.6, stab: 0.4, chop: 0.45, pad: 0.25, atmos: 0.4, hook: 0.55, answerVoice: "chop", lp: 6500, fx: 0.15 }),
    L({ kick: 1, kickDrive: 0.55, bass: 0.9, bassPool: [1, 4, 2], roll: 0.35, hats: 0.75, hat16: 0.2, openhat: 0.5, ride: 0.5, clap: 0.9, perc: 0.65, perc2: 0.4, stab: 0.55, chop: 0.55, pad: 0.2, atmos: 0.3, hook: 0.6, hookVoice: "rstab", answerVoice: "chop", lp: 9000, fx: 0.25, drive: 0.15 }),
    L({ kick: 1, kickDrive: 0.65, bass: 1, bassPool: [3, 1, 2], roll: 0.45, hats: 0.8, hat16: 0.3, openhat: 0.7, ride: 0.55, clap: 1, perc: 0.7, perc2: 0.5, stab: 0.7, chop: 0.6, pad: 0.15, atmos: 0.25, hook: 0.7, hookVoice: "rstab", answerVoice: "chop", lp: 12000, fx: 0.35, drive: 0.2 }),
    L({ kick: 1, kickDrive: 0.72, bass: 1, bassPool: [3, 2, 5, 1], roll: 0.5, hats: 0.85, hat16: 0.4, openhat: 0.8, ride: 0.6, clap: 1, snare: 0.3, perc: 0.75, perc2: 0.6, stab: 0.75, chop: 0.7, pad: 0.12, atmos: 0.2, hook: 0.75, hookVoice: "rstab", answerVoice: "chop", lp: 14500, fx: 0.45, drive: 0.24 }),
    L({ kick: 1, kickDrive: 0.8, bass: 1, bassPool: [3, 2, 4, 5], roll: 0.55, reese: 0.45, hats: 0.9, hat16: 0.5, openhat: 0.85, ride: 0.7, clap: 1, snare: 0.4, perc: 0.8, perc2: 0.7, stab: 0.8, chop: 0.75, pad: 0.1, atmos: 0.2, hook: 0.85, hookVoice: "hoover", answerVoice: "rstab", lp: 16000, fx: 0.55, drive: 0.3 }),
    L({ kick: 1, kickDrive: 0.86, bass: 1, bassPool: [2, 3, 5, 1], roll: 0.6, reese: 0.55, hats: 0.95, hat16: 0.65, openhat: 0.9, ride: 0.8, clap: 1, snare: 0.5, perc: 0.85, perc2: 0.8, stab: 0.85, chop: 0.8, pad: 0.1, atmos: 0.2, hook: 0.9, hookVoice: "hoover", answerVoice: "chop", lp: 18000, fx: 0.65, drive: 0.36 }),
    L({ kick: 1, kickDrive: 0.92, bass: 1, bassPool: [3, 2, 5, 4], roll: 0.65, reese: 0.6, hats: 1, hat16: 0.8, openhat: 0.95, ride: 0.9, clap: 1, snare: 0.6, perc: 0.9, perc2: 0.9, stab: 0.9, chop: 0.85, pad: 0.1, atmos: 0.2, hook: 0.95, hookVoice: "hoover", answerVoice: "rstab", lp: 18000, fx: 0.75, drive: 0.42 }),
    L({ kick: 1, kickDrive: 1, bass: 1, bassPool: [3, 2, 5, 1], roll: 0.7, reese: 0.65, hats: 1, hat16: 1, openhat: 1, ride: 1, clap: 1, snare: 0.7, perc: 1, perc2: 1, stab: 1, chop: 0.9, pad: 0.1, atmos: 0.2, hook: 1, hookVoice: "hoover", answerVoice: "chop", lp: 18000, fx: 0.85, drive: 0.48 }),
  ] as HLevel[],
  // One chord per 4 bars (per 2 bars from level 9). Degrees of F natural minor; V may be major.
  progressions: [
    { name: "i–i–VI–VII", chords: [{ deg: 0 }, { deg: 0 }, { deg: 5 }, { deg: 6 }] },
    { name: "i–VI–III–VII", chords: [{ deg: 0 }, { deg: 5 }, { deg: 2 }, { deg: 6 }] },
    { name: "i–iv–VI–V", chords: [{ deg: 0 }, { deg: 3 }, { deg: 5 }, { deg: 4, major: true }] },
    { name: "i–VII–VI–VII", chords: [{ deg: 0 }, { deg: 6 }, { deg: 5 }, { deg: 6 }] },
    { name: "VI–VII–i–i", chords: [{ deg: 5 }, { deg: 6 }, { deg: 0 }, { deg: 0 }] },
    { name: "i–III–iv–VI", chords: [{ deg: 0 }, { deg: 2 }, { deg: 3 }, { deg: 5 }] },
    { name: "i–i–iv–iv", chords: [{ deg: 0 }, { deg: 0 }, { deg: 3 }, { deg: 3 }] },
  ] as Progression[],
  breakdownProgressions: [
    { name: "VI–VII–i–v", chords: [{ deg: 5 }, { deg: 6 }, { deg: 0 }, { deg: 4 }] },
    { name: "i–VI–iv–V", chords: [{ deg: 0 }, { deg: 5 }, { deg: 3 }, { deg: 4, major: true }] },
    { name: "iv–VI–VII–i", chords: [{ deg: 3 }, { deg: 5 }, { deg: 6 }, { deg: 0 }] },
  ] as Progression[],
  // Vowels for the formant chops: [F1, F2, F3] in Hz. Chop words: vowel glides.
  vowels: { a: [800, 1200, 2800], o: [450, 800, 2830], e: [420, 1900, 2600], i: [300, 2250, 3000], u: [330, 750, 2500] } as Record<string, number[]>,
  words: [["e", "i"], ["o", "o"], ["i", "a"], ["a", "a"], ["u", "a"], ["a", "i"]] as [string, string][],
  percVoices: [
    { sample: "rim", gain: 0.7, pan: -0.35 },
    { sample: "conga", gain: 0.75, pan: 0.3 },
    { sample: "clave", gain: 0.45, pan: 0.45 },
    { sample: "tom", gain: 0.55, pan: -0.25 },
    { sample: "shaker", gain: 0.6, pan: 0.2 },
  ],
};
