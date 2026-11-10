// Style pack "Techno · Dark Bounce" (concept §5): energy ladder with 10 levels, pattern variants
// per layer, 3 anchor grooves, chord progressions in F minor, fills, risers and a hymn motif.
// All note data is original; all sounds are CC0 samples or own synthesis (see CREDITS.md).
export const KEY_ROOT = 29; // F1
export const SCALE = [0, 2, 3, 5, 7, 8, 10]; // natural minor
export type Hit = [step: number, vel: number];
export type BassNote = [step: number, len: number, semis: number, vel: number];
export interface Chord {
  root: number; // semitones above F
  minor: boolean;
}
const c = (root: number, minor: boolean): Chord => ({ root, minor });
export interface Level {
  kick: number;
  kickTone: number; // 0 = soft/lowpassed, 1 = full
  rumble: number;
  bass: number;
  hats: number;
  ghost: number; // probability of generative ghost hats
  openhat: number;
  clap: number;
  perc: number;
  perc2: number;
  ride: number;
  stab: number;
  pad: number;
  acid: number;
  lead: number;
  atmos: number;
  drive: number;
  lp: number; // music-bus low-pass in Hz
}
const L = (o: Partial<Level>): Level => ({
  kick: 0, kickTone: 1, rumble: 0, bass: 0, hats: 0, ghost: 0, openhat: 0, clap: 0, perc: 0, perc2: 0,
  ride: 0, stab: 0, pad: 0, acid: 0, lead: 0, atmos: 0, drive: 0.1, lp: 18000, ...o,
});
export const PACK = {
  id: "techno-dark-bounce",
  name: "Techno · Dark Bounce",
  levels: [
    L({ kick: 0.45, kickTone: 0, pad: 1, perc: 0.35, atmos: 1, lp: 1400 }),
    L({ kick: 0.6, kickTone: 0.35, rumble: 0.45, hats: 0.45, pad: 0.85, perc: 0.45, atmos: 0.8, lp: 2400 }),
    L({ kick: 0.8, kickTone: 0.7, rumble: 0.6, bass: 0.75, hats: 0.6, ghost: 0.08, pad: 0.6, perc: 0.55, atmos: 0.6, lp: 3800 }),
    L({ kick: 0.9, rumble: 0.7, bass: 0.85, hats: 0.75, ghost: 0.12, clap: 0.45, pad: 0.45, perc: 0.7, atmos: 0.45, lp: 5500 }),
    L({ kick: 1, rumble: 0.75, bass: 0.95, hats: 0.8, ghost: 0.16, clap: 0.85, perc: 0.75, perc2: 0.45, pad: 0.35, atmos: 0.35, lp: 7500, drive: 0.15 }),
    L({ kick: 1, rumble: 0.75, bass: 1, hats: 0.85, ghost: 0.2, openhat: 0.6, clap: 0.9, perc: 0.8, perc2: 0.6, stab: 0.6, pad: 0.25, atmos: 0.3, lp: 10000, drive: 0.2 }),
    L({ kick: 1, rumble: 0.7, bass: 1, hats: 0.9, ghost: 0.24, openhat: 0.7, clap: 0.95, perc: 0.85, perc2: 0.7, ride: 0.45, stab: 0.7, acid: 0.6, pad: 0.2, atmos: 0.25, lp: 13000, drive: 0.25 }),
    L({ kick: 1, rumble: 0.65, bass: 1, hats: 0.95, ghost: 0.3, openhat: 0.8, clap: 1, perc: 0.9, perc2: 0.8, ride: 0.55, stab: 0.75, acid: 0.75, lead: 0.7, pad: 0.2, atmos: 0.2, lp: 16000, drive: 0.32 }),
    L({ kick: 1, rumble: 0.6, bass: 1, hats: 1, ghost: 0.36, openhat: 0.85, clap: 1, perc: 0.95, perc2: 0.9, ride: 0.65, stab: 0.8, acid: 0.9, lead: 0.85, pad: 0.15, atmos: 0.2, lp: 18000, drive: 0.4 }),
    L({ kick: 1, rumble: 0.55, bass: 1, hats: 1, ghost: 0.42, openhat: 0.9, clap: 1, perc: 1, perc2: 1, ride: 0.75, stab: 0.85, acid: 1, lead: 1, pad: 0.15, atmos: 0.2, lp: 18000, drive: 0.48 }),
  ] as Level[],
  kicks: [
    { hits: [[0, 1], [4, 1], [8, 1], [12, 1]] as Hit[], name: "4/4" },
    { hits: [[0, 1], [4, 1], [8, 1], [12, 1], [14, 0.42]] as Hit[], name: "4/4 + Bounce" },
    { hits: [[0, 1], [4, 1], [8, 1], [11, 0.35], [12, 1]] as Hit[], name: "4/4 + Ghost" },
    { hits: [[0, 1], [4, 1], [8, 1], [12, 1], [15, 0.3]] as Hit[], name: "4/4 + Pickup" },
  ],
  bass: [
    { name: "Offbeat", voice: "sub", notes: [[2, 1.6, 0, 1], [6, 1.6, 0, 0.95], [10, 1.6, 0, 1], [14, 1.6, 0, 0.95]] as BassNote[] },
    { name: "Rollend", voice: "fm", notes: [[1, 0.8, 0, 0.6], [2, 0.8, 0, 1], [3, 0.8, 0, 0.7], [5, 0.8, 0, 0.6], [6, 0.8, 0, 1], [7, 0.8, 12, 0.7], [9, 0.8, 0, 0.6], [10, 0.8, 0, 1], [11, 0.8, 0, 0.7], [13, 0.8, 0, 0.6], [14, 0.8, 0, 1], [15, 0.8, 7, 0.7]] as BassNote[] },
    { name: "Galopp", voice: "sub", notes: [[2, 0.9, 0, 1], [3, 0.9, 0, 0.7], [6, 0.9, 0, 1], [7, 0.9, 0, 0.7], [10, 0.9, 0, 1], [11, 0.9, 0, 0.7], [14, 0.9, 0, 1], [15, 0.9, 12, 0.7]] as BassNote[] },
    { name: "Synkope", voice: "fm", notes: [[3, 2, 0, 1], [6, 1, 0, 0.8], [10, 2, 0, 1], [13, 1, 12, 0.75], [14, 1.5, 0, 0.9]] as BassNote[] },
    { name: "Oktav-Bounce", voice: "sub", notes: [[2, 1, 0, 1], [3, 0.8, 12, 0.65], [6, 1, 0, 1], [7, 0.8, 12, 0.65], [10, 1, 0, 1], [11, 0.8, 12, 0.65], [14, 1, 0, 1], [15, 0.8, 10, 0.65]] as BassNote[] },
    { name: "Säge-Drive", voice: "saw", notes: [[1, 0.7, 0, 0.7], [2, 0.7, 0, 0.9], [3, 0.7, 0, 0.7], [5, 0.7, 0, 0.7], [6, 0.7, 0, 0.9], [7, 0.7, 0, 0.7], [9, 0.7, 0, 0.7], [10, 0.7, 0, 0.9], [11, 0.7, 3, 0.7], [13, 0.7, 0, 0.7], [14, 0.7, 0, 0.9], [15, 0.7, -2, 0.7]] as BassNote[] },
    { name: "Minimal", voice: "sub", notes: [[2, 3, 0, 1], [10, 3, 0, 1]] as BassNote[] },
  ],
  hats: [
    { name: "Offbeat", hits: [[2, 0.9], [6, 0.85], [10, 0.9], [14, 0.85]] as Hit[] },
    { name: "Sechzehntel", hits: Array.from({ length: 16 }, (_, i) => [i, i % 4 === 2 ? 0.9 : i % 2 ? 0.45 : 0.6]) as Hit[] },
    { name: "Ohne Eins", hits: [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15].map((i) => [i, i % 4 === 2 ? 0.9 : 0.5]) as Hit[] },
    { name: "Shuffle", hits: [[0, 0.5], [2, 0.9], [3, 0.55], [6, 0.9], [8, 0.5], [10, 0.9], [11, 0.55], [14, 0.9]] as Hit[] },
    { name: "Tsch-Tsch", hits: [[2, 0.9], [3, 0.6], [6, 0.9], [7, 0.6], [10, 0.9], [11, 0.6], [14, 0.9], [15, 0.6]] as Hit[] },
  ],
  claps: [
    { name: "2 & 4", hits: [[4, 1], [12, 1]] as Hit[], snare: false },
    { name: "2 & 4 + Ghost", hits: [[4, 1], [12, 1], [15, 0.35]] as Hit[], snare: false },
    { name: "Clap + Snare", hits: [[4, 1], [12, 1]] as Hit[], snare: true },
    { name: "Nur 4 + Rim", hits: [[12, 1], [7, 0.3]] as Hit[], snare: false },
  ],
  stabs: [
    { name: "Dub 1", hits: [[3, 0.9], [10, 0.8]] as Hit[] },
    { name: "Dub 2", hits: [[2, 0.85], [7, 0.75], [11, 0.8]] as Hit[] },
    { name: "Offbeat", hits: [[6, 0.85], [14, 0.85]] as Hit[] },
    { name: "Stotter", hits: [[3, 0.8], [6, 0.7], [11, 0.8], [14, 0.7]] as Hit[] },
  ],
  percVoices: [
    { sample: "rim", gain: 0.7, pan: -0.35 },
    { sample: "conga", gain: 0.8, pan: 0.3 },
    { sample: "clave", gain: 0.45, pan: 0.45 },
    { sample: "tom", gain: 0.6, pan: -0.25 },
    { sample: "shaker", gain: 0.55, pan: 0.2 },
  ],
  // Each progression: one chord per 4 bars of a 16-bar phrase (F minor).
  progressions: [
    { name: "i (Drone)", chords: [c(0, true), c(0, true), c(0, true), c(0, true)] },
    { name: "i–VI", chords: [c(0, true), c(0, true), c(8, false), c(8, false)] },
    { name: "i–VII–VI–VII", chords: [c(0, true), c(10, false), c(8, false), c(10, false)] },
    { name: "i–iv", chords: [c(0, true), c(5, true), c(0, true), c(5, true)] },
    { name: "i–III–VII–iv", chords: [c(0, true), c(3, false), c(10, false), c(5, true)] },
    { name: "i–♭II (phrygisch)", chords: [c(0, true), c(1, false), c(0, true), c(1, false)] },
    { name: "i–v–VI", chords: [c(0, true), c(0, true), c(7, true), c(8, false)] },
  ],
  // Hymn of the night: a 2-bar motif that returns in every wave (concept §5). [step 0–31, midi, len]
  hymn: [[0, 65, 3], [3, 68, 3], [6, 72, 2], [8, 70, 4], [14, 68, 2], [16, 65, 3], [19, 68, 3], [22, 75, 2], [24, 72, 6]] as [number, number, number][],
  // Three anchor grooves: plain, proven-style combinations the director falls back to.
  anchors: [
    { kick: 0, bass: 0, hats: 0, clap: 0, stab: 0, perc: { k: 5, rot: 3, voice: 0, rate: 1 }, perc2: { k: 3, rot: 2, voice: 4, rate: 1 }, progression: 0, swing: 0, filterMove: 0, stabOn: false, acidOn: false },
    { kick: 1, bass: 4, hats: 4, clap: 1, stab: 2, perc: { k: 7, rot: 1, voice: 1, rate: 1 }, perc2: { k: 4, rot: 2, voice: 2, rate: 1 }, progression: 1, swing: 0.06, filterMove: 0, stabOn: true, acidOn: false },
    { kick: 0, bass: 2, hats: 1, clap: 2, stab: 1, perc: { k: 5, rot: 0, voice: 3, rate: 0.9 }, perc2: { k: 3, rot: 5, voice: 0, rate: 1.1 }, progression: 3, swing: 0, filterMove: 0, stabOn: false, acidOn: true },
  ],
};
export const chordTones = (ch: Chord) => [0, ch.minor ? 3 : 4, 7, ch.minor ? 10 : 11];
