// Rule-based director (concept §8): follows the target curve with "measured + δ, capped by the
// curve", 16-bar phrases, energy ladder 1–10, fatigue model with mandatory breakdowns, build-ups
// in 8-bar blocks, drop on the one (unlocked, rescue or forced), small moves with an anchor
// fallback. Pure and deterministic: one call per bar, no wall clock, no per-person data.
import { type CurvePreset, type CurvePhase, sollAt, curvePhase, leadDelta, exploreRate } from "./curve.ts";
import { type CrowdInput, readiness, unlockRule, type UnlockMode } from "./crowd.ts";
import { srng, hash, clamp, pickFresh, type SRng } from "./rng.ts";
import { PACK } from "./pack/techno.ts";

export const PHRASE = 16;
export const BLOCK = 8;
export const MAX_BUILD_BLOCKS = 3;
export const BPM_MIN = 128;
export const BPM_MAX = 138;
/** Style of the music engine. Hard House is the default; Techno stays selectable. */
export type Genre = "hardhouse" | "techno";
export const GENRES: Record<Genre, { label: string; bpm: [number, number] }> = {
  hardhouse: { label: "Hard House", bpm: [140, 150] },
  techno: { label: "Techno", bpm: [BPM_MIN, BPM_MAX] },
};
export const DEFAULT_GENRE: Genre = "hardhouse";
/** Key centre per chapter, semitones relative to F (F, G, D, B♭, A♭, E♭). A chapter starts at
 * every breakdown and after six groove phrases without one: modulation on section boundaries. */
export const KEY_SHIFTS = [0, 2, -3, 5, 3, -2];
export const CHAPTER_PHRASES = 6;
export type Section = "groove" | "breakdown" | "build";
export type DropType = "freigeschaltet" | "rettung" | "erzwungen";
export type MoveType = "hats" | "bass" | "swing" | "perc" | "filter" | "stab" | "fill" | "acid";
export const MOVES: MoveType[] = ["hats", "bass", "swing", "perc", "filter", "stab", "fill", "acid"];
export const MOVE_LABEL: Record<MoveType, string> = {
  hats: "Hi-Hat-Variante",
  bass: "Bass-Variante",
  swing: "Swing",
  perc: "Percussion",
  filter: "Filterfahrt",
  stab: "Akkord-Stab",
  fill: "Fill",
  acid: "Acid-Linie",
};
export interface Variation {
  kick: number;
  bass: number;
  hats: number;
  clap: number;
  stab: number;
  perc: { k: number; rot: number; voice: number; rate: number };
  perc2: { k: number; rot: number; voice: number; rate: number };
  progression: number;
  acidSeed: number;
  swing: number;
  filterMove: number;
  stabOn: boolean;
  acidOn: boolean;
}
export interface BarPlan {
  index: number;
  /** Start of the bar in seconds from the start of the set. */
  time: number;
  minute: number;
  bpm: number;
  level: number;
  soll: number;
  crowd: CrowdInput;
  readiness: number;
  unlockMode: UnlockMode;
  section: Section;
  curvePhase: CurvePhase;
  /** Label for the UI: Warm-up / Aufbau / Peak / Ausklang / Breakdown / Build-up / Drop. */
  phaseName: string;
  phraseIndex: number;
  phraseBar: number;
  /** Position inside the current breakdown or build block. */
  sectionBar: number;
  buildBlock: number;
  /** The last two bars of a build that resolves into the drop on the next one. */
  preDrop: boolean;
  drop: DropType | null;
  /** Bars since the last drop (0 = the drop bar itself). */
  sinceDrop: number;
  fill: "none" | "small" | "big" | "kickout";
  hymn: boolean;
  anchor: boolean;
  move: MoveType | null;
  variation: Variation;
  fatigue: number;
  dropQueued: boolean;
  /** Type of the decided drop while a pre-drop runs (for the light command one bar ahead). */
  nextDrop: DropType | null;
  seed: number;
  genre: Genre;
  /** Seed of the whole night (motif of the night is derived from it). */
  nightSeed: number;
  /** Chapter of the night (changes at breakdowns / every few phrases) and its key shift. */
  chapter: number;
  chapterPhrase: number;
  key: number;
  /** Number of drops so far (the drop bar itself included). */
  drops: number;
}
export interface DirectorEvent {
  bar: number;
  time: number;
  kind: "breakdown" | "build" | "drop" | "move" | "move-ok" | "move-fail" | "anchor" | "level" | "key";
  detail: string;
}
export interface DirectorSnapshot {
  v: 1;
  preset: string;
  rng: number;
  state: Record<string, unknown>;
}
export const barSeconds = (bpm: number) => (240 / bpm);
export const levelBpm = (level: number, genre: Genre = "techno") => {
  const [lo, hi] = GENRES[genre].bpm;
  return lo + ((level - 1) * (hi - lo)) / 9;
};
export const KEY_NAMES = ["F", "F♯", "G", "A♭", "A", "B♭", "H", "C", "D♭", "D", "E♭", "E"];
export const keyName = (shift: number) => `${KEY_NAMES[((shift % 12) + 12) % 12]}-Moll`;

export class Director {
  readonly preset: CurvePreset;
  readonly seed: number;
  genre: Genre = DEFAULT_GENRE;
  private r: SRng;
  bar = 0;
  time = 0;
  bpm = BPM_MIN;
  level = 1;
  fatigue = 0;
  section: Section = "groove";
  private phraseBar = 0;
  private phraseIndex = 0;
  private sectionBar = 0;
  private buildBlock = 0;
  private preDropFrom = -1;
  private pendingDrop: DropType | null = null;
  private lastDropBar = -1000;
  private hyst = 0;
  private highMinutes = 0;
  private nextMandatory: number;
  private lastBreakdownMinute = 0;
  private enteredPeakWave = false;
  private forceQueued = false;
  private move: { type: MoveType; phrase: number; energy: number } | null = null;
  private lastMovePhrase = -10;
  private failures = 0;
  private anchorUntil = -1;
  private anchorIndex = 0;
  private recentBass: number[] = [];
  private recentHats: number[] = [];
  private recentProg: number[] = [];
  private v: Variation;
  private fill: BarPlan["fill"] = "none";
  private hymnPhrase = false;
  private preBreakLevel = 1;
  chapter = 0;
  private chapterPhrase = 0;
  private drops = 0;
  events: DirectorEvent[] = [];
  constructor(preset: CurvePreset, seed = 1, genre: Genre = DEFAULT_GENRE) {
    this.preset = preset;
    this.seed = seed;
    this.genre = genre;
    this.bpm = GENRES[genre].bpm[0];
    this.r = srng(hash("director", seed));
    this.nextMandatory = 15 + this.r() * 10;
    this.v = this.anchorVariation(0);
    this.level = Math.max(1, Math.floor(sollAt(preset, 0) - 1));
  }
  get minute() {
    return this.time / 60;
  }
  get finished() {
    return this.minute >= this.preset.minutes;
  }
  /** Plain-data copy of the whole state (JSON-safe) – persisted so a master reload can resume. */
  snapshot(): DirectorSnapshot {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this)) if (k !== "preset" && k !== "r") o[k] = v;
    return JSON.parse(JSON.stringify({ v: 1, preset: this.preset.id, rng: this.r.state, state: o })) as DirectorSnapshot;
  }
  /** Continue exactly where a snapshot left off (same preset/seed → identical continuation). */
  static restore(snap: DirectorSnapshot, preset: CurvePreset): Director {
    // Snapshots from before genres existed were Techno.
    const d = new Director(preset, Number(snap.state.seed) || 1, (snap.state.genre as Genre) ?? "techno");
    Object.assign(d, JSON.parse(JSON.stringify(snap.state)));
    d.r.state = snap.rng >>> 0;
    return d;
  }
  /** "Drop jetzt erzwingen": a one-bar pre-drop fill, then the drop on the next one. */
  forceDrop() {
    this.forceQueued = true;
  }
  private log(kind: DirectorEvent["kind"], detail: string) {
    this.events.push({ bar: this.bar, time: this.time, kind, detail });
    if (this.events.length > 400) this.events.shift();
  }
  private anchorVariation(i: number): Variation {
    const a = PACK.anchors[i % PACK.anchors.length];
    return { ...a, perc: { ...a.perc }, perc2: { ...a.perc2 }, acidSeed: hash(this.seed, "anchor", i) };
  }
  private next(crowd: CrowdInput): BarPlan {
    const minute = this.minute;
    const soll = sollAt(this.preset, minute + barSeconds(this.bpm) / 120);
    const phase = curvePhase(this.preset, minute);
    const ready = readiness(crowd);
    let drop: DropType | null = null;

    if (this.pendingDrop) {
      drop = this.pendingDrop;
      this.pendingDrop = null;
      this.startDrop(drop, soll);
    } else if (this.forceQueued && this.preDropFrom < 0) {
      // "Drop jetzt erzwingen": one pre-drop bar, then the drop on the next one.
      this.forceQueued = false;
      if (this.section === "groove") this.preBreakLevel = this.level;
      if (this.section !== "build") this.buildBlock = 0;
      this.section = "build";
      this.sectionBar = BLOCK - 1;
      this.preDropFrom = this.bar;
      this.pendingType = "erzwungen";
      this.log("build", "Drop erzwungen");
    } else if (this.section === "groove" && this.phraseBar === PHRASE) {
      this.phraseBar = 0;
      this.phraseIndex++;
      this.onPhrase(crowd, soll, phase, minute);
    } else if (this.section === "breakdown" && this.sectionBar === PHRASE) {
      this.section = "build";
      this.sectionBar = 0;
      this.buildBlock = 0;
      this.log("build", "Build-up Block 1");
    } else if (this.section === "build") {
      if (this.sectionBar === BLOCK) {
        this.sectionBar = 0;
        this.buildBlock++;
        this.log("build", `Build-up Block ${this.buildBlock + 1} (wartet auf Freigabe)`);
      }
      // Decide two bars before the block ends whether the next one is the drop.
      if (this.sectionBar === BLOCK - 2 && this.preDropFrom < 0) {
        // Phones-up share U ≥ 50 % during the light moment shortens the build by one block.
        const maxBlocks = MAX_BUILD_BLOCKS - (crowd.phonesUp !== undefined && crowd.phonesUp >= 0.5 ? 1 : 0);
        if (ready >= 1 || this.buildBlock + 1 >= maxBlocks) {
          this.preDropFrom = this.bar;
          this.pendingType = ready >= 1 ? "freigeschaltet" : "rettung";
        }
      }
    }

    const bpm = this.bpm;
    const inPreDrop = this.preDropFrom >= 0;
    const sinceDrop = this.bar - this.lastDropBar;
    const plan: BarPlan = {
      index: this.bar,
      time: this.time,
      minute,
      bpm,
      level: this.level,
      soll,
      crowd,
      readiness: ready,
      unlockMode: unlockRule(crowd.n).mode,
      section: this.section,
      curvePhase: phase,
      phaseName:
        this.section === "breakdown"
          ? "Breakdown"
          : this.section === "build"
            ? "Build-up"
            : sinceDrop < 8
              ? "Drop"
              : phase,
      phraseIndex: this.phraseIndex,
      phraseBar: this.section === "groove" ? this.phraseBar : this.sectionBar,
      sectionBar: this.sectionBar,
      buildBlock: this.buildBlock,
      preDrop: inPreDrop,
      drop,
      sinceDrop,
      fill: this.section === "groove" ? this.fillFor(this.phraseBar) : "none",
      hymn: this.hymnPhrase || this.section === "breakdown",
      anchor: this.phraseIndex < this.anchorUntil,
      move: this.move && this.move.phrase === this.phraseIndex ? this.move.type : null,
      variation: { ...this.v, perc: { ...this.v.perc }, perc2: { ...this.v.perc2 } },
      fatigue: this.fatigue,
      dropQueued: this.forceQueued || this.pendingType !== null,
      nextDrop: inPreDrop ? this.pendingType : null,
      seed: hash(this.seed, "bar", this.bar),
      genre: this.genre,
      nightSeed: this.seed,
      chapter: this.chapter,
      chapterPhrase: this.chapterPhrase,
      key: KEY_SHIFTS[this.chapter % KEY_SHIFTS.length],
      drops: this.drops,
    };
    // Advance.
    this.time += barSeconds(bpm);
    this.bar++;
    if (this.section === "groove") this.phraseBar++;
    else this.sectionBar++;
    return plan;
  }
  private pendingType: DropType | null = null;
  /** Called by next() before planning: turns a decided build end into the drop bar. */
  private startDrop(type: DropType, soll: number) {
    this.section = "groove";
    this.phraseBar = 0;
    this.phraseIndex++;
    this.sectionBar = 0;
    this.preDropFrom = -1;
    this.lastDropBar = this.bar;
    this.drops++;
    this.chapterPhrase = 0;
    // Return at least to the pre-breakdown level, one step more if the curve allows.
    const cap = Math.max(1, Math.floor(soll + 0.25));
    this.level = clamp(Math.max(this.preBreakLevel, Math.min(this.preBreakLevel + 1, cap)), 1, 10);
    this.hyst = 0;
    this.hymnPhrase = this.level >= 8;
    this.v = this.freshVariation(2);
    this.log("drop", `Drop (${type}) auf Stufe ${this.level}`);
  }
  private newChapter(why: string) {
    this.chapter++;
    this.chapterPhrase = 0;
    this.log("key", `Tonart → ${keyName(KEY_SHIFTS[this.chapter % KEY_SHIFTS.length])} (${why})`);
  }
  private fillFor(phraseBar: number): BarPlan["fill"] {
    if (phraseBar === PHRASE - 1) return this.fill;
    if (phraseBar === 7) return "small";
    return "none";
  }
  private freshVariation(changes: number): Variation {
    const v: Variation = { ...this.v, perc: { ...this.v.perc }, perc2: { ...this.v.perc2 } };
    const layers = ["bass", "hats", "perc", "clap", "kick", "stab", "prog", "perc2", "acid"] as const;
    for (let i = 0; i < changes; i++) {
      const layer = layers[Math.floor(this.r() * layers.length)];
      this.mutate(v, layer);
    }
    return v;
  }
  private mutate(v: Variation, layer: string) {
    const r = this.r;
    switch (layer) {
      case "bass":
        v.bass = pickFresh(r, PACK.bass.length, this.recentBass);
        this.recentBass = [v.bass, ...this.recentBass].slice(0, 3);
        break;
      case "hats":
        v.hats = pickFresh(r, PACK.hats.length, this.recentHats);
        this.recentHats = [v.hats, ...this.recentHats].slice(0, 3);
        break;
      case "perc":
        v.perc = { k: 3 + Math.floor(r() * 5), rot: Math.floor(r() * 16), voice: Math.floor(r() * PACK.percVoices.length), rate: 0.85 + r() * 0.35 };
        break;
      case "perc2":
        v.perc2 = { k: 2 + Math.floor(r() * 4), rot: Math.floor(r() * 16), voice: Math.floor(r() * PACK.percVoices.length), rate: 0.9 + r() * 0.3 };
        break;
      case "clap":
        v.clap = Math.floor(r() * PACK.claps.length);
        break;
      case "kick":
        v.kick = Math.floor(r() * PACK.kicks.length);
        break;
      case "stab":
        v.stab = Math.floor(r() * PACK.stabs.length);
        v.stabOn = r() < 0.7;
        break;
      case "prog":
        v.progression = pickFresh(r, PACK.progressions.length, this.recentProg);
        this.recentProg = [v.progression, ...this.recentProg].slice(0, 3);
        break;
      case "acid":
        v.acidSeed = hash(this.seed, "acid", this.bar);
        v.acidOn = r() < 0.75;
        break;
      case "swing":
        v.swing = v.swing > 0.04 ? 0 : 0.06 + r() * 0.06;
        break;
      case "filter":
        v.filterMove = 1 + Math.floor(r() * 3);
        break;
    }
  }
  private onPhrase(measured: CrowdInput, soll: number, phase: CurvePhase, minute: number) {
    // Nobody counts (no guests, network down, master not dancing): follow the curve only.
    const crowd = measured.n > 0 ? measured : { ...measured, energy: Math.max(0, soll - leadDelta(phase)) };
    // Without measurement a move cannot be judged: it simply ends (no success, no failure).
    if (measured.n <= 0 && this.move && this.phraseIndex - this.move.phrase >= 2) this.move = null;
    const phraseMin = (PHRASE * barSeconds(this.bpm)) / 60;
    // Fatigue: rises for every phrase above level 6, slowly recovers at low levels.
    if (this.level > 6) {
      this.fatigue += 0.02 * (this.level - 6);
      this.highMinutes += phraseMin;
    } else if (this.level <= 4) this.fatigue = Math.max(0, this.fatigue - 0.05);
    // Evaluate a running move after two phrases.
    if (this.move && this.phraseIndex - this.move.phrase >= 2) {
      const gain = crowd.energy - this.move.energy;
      if (gain >= 0.35) {
        this.failures = 0;
        this.log("move-ok", `${MOVE_LABEL[this.move.type]} hat gewirkt (+${gain.toFixed(1)})`);
      } else {
        this.failures++;
        this.log("move-fail", `${MOVE_LABEL[this.move.type]} ohne Wirkung`);
        if (this.failures >= 2) {
          this.failures = 0;
          this.anchorUntil = this.phraseIndex + 2;
          this.anchorIndex = (this.anchorIndex + 1) % PACK.anchors.length;
          const keepAcid = this.v.acidSeed;
          this.v = this.anchorVariation(this.anchorIndex);
          this.v.acidSeed = keepAcid;
          this.log("anchor", `Anker-Groove ${this.anchorIndex + 1} für 2 Phrasen`);
        }
      }
      this.move = null;
    }
    // Transition: breakdown if fatigue is high, the mandatory window is reached, the curve is
    // about to enter its peak, or (for variety) a long build stretch had no break.
    const sinceBreak = minute - this.lastBreakdownMinute;
    let enteringPeak = !this.enteredPeakWave && soll >= 8.2 && this.level >= 6;
    if (enteringPeak && sinceBreak < 4) {
      // A drop just happened: it already counts as the entry into this wave's peak.
      this.enteredPeakWave = true;
      enteringPeak = false;
    }
    if (soll < 7) this.enteredPeakWave = false;
    const mandatory = this.level >= 7 && this.highMinutes >= this.nextMandatory;
    const tired = this.fatigue > 1 && this.level >= 6;
    const variety = this.level >= 5 && sinceBreak >= 9 && phase !== "Ausklang";
    const remaining = this.preset.minutes - minute;
    if ((mandatory || tired || enteringPeak || variety) && remaining > 2.5 && this.phraseIndex > 3) {
      if (enteringPeak) this.enteredPeakWave = true;
      this.section = "breakdown";
      this.sectionBar = 0;
      this.preBreakLevel = this.level;
      this.fatigue = Math.max(0, this.fatigue - 0.9);
      this.highMinutes = 0;
      this.nextMandatory = 15 + this.r() * 10;
      this.lastBreakdownMinute = minute;
      this.hymnPhrase = true;
      this.newChapter("Breakdown");
      this.v = this.freshVariation(2);
      this.log("breakdown", mandatory ? "Pflicht-Breakdown" : tired ? "Breakdown (Müdigkeit)" : enteringPeak ? "Breakdown vor dem Peak" : "Breakdown (Abwechslung)");
      return;
    }
    // Level: L_ziel = clamp(Ist + δ, Soll − 2, Soll); hysteresis 0.75 over two phrases; ≤ 1 step.
    const target = clamp(crowd.energy + leadDelta(phase), Math.max(1, soll - 2), Math.max(1, soll));
    const dev = target - this.level;
    if (Math.abs(dev) < 0.75) this.hyst = 0;
    else this.hyst = Math.sign(dev) === Math.sign(this.hyst) ? this.hyst + Math.sign(dev) : Math.sign(dev);
    if (Math.abs(this.hyst) >= 2) {
      const before = this.level;
      this.level = clamp(this.level + Math.sign(this.hyst), 1, 10);
      if (this.level !== before) this.log("level", `Stufe ${before} → ${this.level}`);
    }
    // A long groove stretch without breakdown modulates on its phrase boundary.
    this.chapterPhrase++;
    if (this.chapterPhrase >= CHAPTER_PHRASES) this.newChapter("Phrase");
    // Tempo: towards the level's tempo, at most ±1 BPM per phrase.
    const goal = levelBpm(this.level, this.genre);
    this.bpm = Math.round((this.bpm + clamp(goal - this.bpm, -1, 1)) * 100) / 100;
    // Variation (always) + moves (exploration rules) + hymn of the night.
    const anchored = this.phraseIndex < this.anchorUntil;
    this.hymnPhrase = this.level >= 8 && this.phraseIndex % 2 === 0;
    this.fill = (["big", "big", "kickout", "small"] as const)[Math.floor(this.r() * 4)];
    if (!anchored) {
      this.v = this.freshVariation(this.phraseIndex % 2 === 0 ? 2 : 1);
      if (this.phraseIndex % 4 === 0) this.mutate(this.v, "prog");
      this.v.stabOn = this.v.stabOn || this.level >= 6;
      const lag = soll - crowd.energy;
      const eligible = this.phraseIndex - this.lastMovePhrase >= 2 && phase !== "Peak";
      const explore = this.r() < exploreRate(phase);
      if (eligible && (lag >= 1 || explore)) {
        const type = MOVES[Math.floor(this.r() * MOVES.length)];
        this.mutate(this.v, type === "fill" ? "perc" : type);
        if (type === "fill") this.fill = "big";
        if (type === "stab") this.v.stabOn = true;
        if (type === "acid") this.v.acidOn = true;
        this.move = { type, phrase: this.phraseIndex, energy: crowd.energy };
        this.lastMovePhrase = this.phraseIndex;
        this.log("move", `Move: ${MOVE_LABEL[type]}${lag >= 1 ? " (Fläche folgt nicht)" : " (Erkunden)"}`);
      }
    }
  }
  /** Must be called at the top of next(): converts a decided build end into the drop. */
  private settle() {
    if (this.section === "build" && this.preDropFrom >= 0 && this.pendingType && this.sectionBar === BLOCK) {
      this.pendingDrop = this.pendingType;
      this.pendingType = null;
    }
  }
  /** Plan the next bar. `crowd` is the latest measured aggregate (or the simulation). */
  step(crowd: CrowdInput): BarPlan {
    this.settle();
    return this.next(crowd);
  }
}
