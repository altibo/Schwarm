// One running set: director + crowd source (simulation or manual sliders) → bar scores.
import { Director, type BarPlan } from "./director.ts";
import { CrowdSim, type CrowdInput } from "./crowd.ts";
import { arrange, type Score } from "./arranger.ts";
import { presetById } from "./curve.ts";
import { hash, rng } from "./rng.ts";
export const BLIND_TEST_SEED = 2026;
export interface SetOptions {
  preset: string;
  seed: number;
  /** "sim": the crowd follows the music (model). "manual": sliders set the aggregate. */
  crowd: "sim" | "manual";
  n?: number;
}
export class SetRunner {
  readonly director: Director;
  readonly sim: CrowdSim;
  mode: "sim" | "manual";
  manual: CrowdInput = { energy: 3, sync: 0.3, participation: 0.8, n: 12 };
  private last: CrowdInput;
  private boost = 0;
  private boostBars = 0;
  private coin;
  constructor(o: SetOptions) {
    this.director = new Director(presetById(o.preset), o.seed);
    this.sim = new CrowdSim(o.seed, o.n ?? 12);
    this.mode = o.crowd;
    this.manual.n = o.n ?? 12;
    this.coin = rng(hash("moves", o.seed));
    this.last = this.sim.step(1, "groove", 0);
  }
  get finished() {
    return this.director.finished;
  }
  next(): Score {
    const crowd = this.mode === "manual" ? { ...this.manual } : this.last;
    const plan = this.director.step(crowd);
    this.afterBar(plan);
    return arrange(plan);
  }
  private afterBar(plan: BarPlan) {
    // In the simulation, a move works with probability 0.5 and then lifts the floor for 2 phrases.
    if (plan.move && plan.phraseBar === 0) {
      this.boost = this.coin() < 0.5 ? 0.9 : 0;
      this.boostBars = 32;
    }
    if (this.boostBars > 0) this.boostBars--;
    else this.boost = 0;
    this.sim.n = this.mode === "manual" ? this.manual.n : this.sim.n;
    this.last = this.sim.step(plan.level, plan.section, plan.minute, this.boost);
  }
}
/** Light summary of a bar for logs, UI and the render report. */
export const summary = (s: Score) => ({
  i: s.plan.index,
  t: Math.round(s.plan.time * 1000) / 1000,
  bpm: s.plan.bpm,
  level: s.plan.level,
  soll: Math.round(s.plan.soll * 100) / 100,
  ist: Math.round(s.plan.crowd.energy * 100) / 100,
  sync: Math.round(s.plan.crowd.sync * 100) / 100,
  ready: Math.round(s.plan.readiness * 100) / 100,
  section: s.plan.section,
  phase: s.plan.phaseName,
  phraseBar: s.plan.phraseBar,
  drop: s.plan.drop,
  preDrop: s.plan.preDrop,
  fill: s.plan.fill,
  move: s.plan.move,
  anchor: s.plan.anchor,
  fatigue: Math.round(s.plan.fatigue * 100) / 100,
  events: s.events.length,
});
