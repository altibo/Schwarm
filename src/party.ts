// Master-side party controller: session hub + streaming aggregation + light moments.
// Each scheduled bar is announced to all guests (heard grid, phase, crowd stats, light command);
// guest feature packets are folded into the aggregator; finished bars become the director's
// live crowd input. The master itself can dance along with its own motion sensor.
import { MasterHub, loadOrCreateSession, type BarMsg, type UpMsg } from "./net/session.ts";
import { LiveAggregator, toCrowd, samplingP, type BarAggregate } from "./aggregate.ts";
import { MotionFeatures, type BarFeatures } from "./sense.ts";
import { readiness, unlockRule, type CrowdInput } from "./crowd.ts";
import { BLOCK } from "./director.ts";
import { now } from "./net/clock.ts";
import type { LiveEngine } from "./live.ts";
import type { Score } from "./arranger.ts";
import type { NetChoice } from "./net/transport.ts";
/** Light moments (phones up) at most every 15 min → ≤ 4 per hour (concept §2). */
export const LM_SPACING_MS = 15 * 60000;
const SETTLE_MS = 700;
export class Party {
  hub: MasterHub;
  agg = new LiveAggregator();
  private engine: LiveEngine;
  private grid = new Map<number, { at: number; dur: number; bpm: number }>();
  latest: BarAggregate | null = null;
  crowd: CrowdInput = { energy: 0, sync: 0, participation: 0, n: 0 };
  private lm = { active: false, lastStart: -Infinity, endBar: -1 };
  dropAt: number | null = null;
  dropType: string | null = null;
  /** Wall-clock times (ms) when the master screen flashes (heard drop). */
  flashes: number[] = [];
  phonesUp = false;
  // --- master dances along ("Ich tanze mit") ---
  selfOn = false;
  selfFeat = new MotionFeatures();
  selfLast: BarFeatures | null = null;
  private timer = 0;
  presetId = "1h";
  onChange: () => void = () => {};
  started = false;
  constructor(engine: LiveEngine, net: NetChoice = "auto", fresh = false) {
    this.engine = engine;
    this.hub = new MasterHub(loadOrCreateSession(fresh), net);
    this.hub.onUp = (m, t) => this.up(m, t);
    this.hub.onState = () => this.onChange();
  }
  async start() {
    const res = await this.hub.start();
    this.started = true;
    this.timer = setInterval(() => this.tick(), 100) as unknown as number;
    return res;
  }
  private up(m: UpMsg, t: number) {
    if (m.t === "hello") this.agg.hello(m.id, t);
    else if (m.t === "hb") this.agg.seen(m.id, t, m.vis, !!m.still, !m.watch);
    else if (m.t === "f") this.agg.add(m, t, !!m.still);
    else if (m.t === "bye") this.agg.leave(m.id);
  }
  /** Called by the engine for every scheduled bar (≈0.3 s before it is heard). */
  onScheduled(s: Score, heard: number) {
    const p = s.plan;
    const dur = 240000 / p.bpm;
    this.grid.set(p.index, { at: heard, dur, bpm: p.bpm });
    if (this.grid.size > 64) this.grid.delete(Math.min(...this.grid.keys()));
    const t = now();
    const was = this.lm.active;
    this.lm = lightStep(this.lm, p, t);
    if (this.lm.active && !was) this.agg.freezeE = this.latest?.E ?? 0;
    if (!this.lm.active && was) this.agg.freezeE = null;
    // Light command one (or two) bars ahead: the drop lands on the one after the pre-drop.
    if (p.preDrop && p.nextDrop) {
      this.dropAt = heard + (BLOCK - p.sectionBar) * dur;
      this.dropType = p.nextDrop;
      if (!this.flashes.includes(this.dropAt)) this.flashes.push(this.dropAt);
    }
    if (p.drop) {
      this.dropAt = heard;
      this.dropType = p.drop;
      if (!this.flashes.some((f) => Math.abs(f - heard) < 50)) this.flashes.push(heard);
    }
    this.flashes = this.flashes.filter((f) => f > t - 5000);
    this.phonesUp = this.lm.active && !p.drop && p.sinceDrop > 0 && (p.preDrop || p.readiness >= 0.75);
    const c = this.crowd;
    const msg: BarMsg = {
      t: "bar",
      ep: this.hub.ep,
      i: p.index,
      at: Math.round(heard * 10) / 10,
      bpm: p.bpm,
      lvl: p.level,
      sec: p.section,
      phase: p.phaseName,
      min: Math.round(p.minute * 100) / 100,
      preset: this.presetId,
      soll: Math.round(p.soll * 100) / 100,
      pre: p.preDrop,
      drop: p.drop,
      dropAt: p.preDrop || p.drop ? this.dropAt : null,
      dropType: p.preDrop || p.drop ? this.dropType : null,
      lm: this.lm.active,
      up: this.phonesUp,
      p: samplingP(this.latest?.n ?? 0),
      crowd: {
        n: c.n,
        m: this.latest?.m ?? 0,
        joined: this.agg.joined,
        E: r2(c.energy),
        S: r2(c.n <= 1 ? c.sync : (this.latest?.S ?? 0)),
        P: r2(c.participation),
        U: r2(this.latest?.U ?? 0),
        medR: r2(this.latest?.medR ?? 0),
        ready: r2(c.n ? readiness(c) : 0),
        mode: unlockRule(c.n).mode,
        rule: c.n ? unlockRule(c.n).text : "Niemand zählt gerade – der Drop kommt nach Plan.",
      },
    };
    if (this.started) void this.hub.broadcast(msg);
  }
  /** Close bars whose reports are in (heard end + 0.7 s) and update the director's input. */
  private tick() {
    const t = now();
    const due = [...this.grid.entries()].filter(([, g]) => g.at + g.dur + SETTLE_MS < t).sort((a, b) => a[0] - b[0]);
    for (const [i, g] of due) {
      this.grid.delete(i);
      if (this.selfOn) {
        const f = this.selfFeat.bar(g.at - performance.timeOrigin, g.at + g.dur - performance.timeOrigin, 60000 / g.bpm, { pocket: false });
        this.selfLast = f;
        if (f.n > 0) this.agg.add({ id: "master", bar: i, e: f.e, ph: f.ph, R: f.R, q: f.q, pose: f.pose }, t, f.still);
      }
      const p = samplingP(this.latest?.n ?? 0);
      this.agg.windowMs = p < 1 ? 20000 : 5000;
      this.latest = this.agg.finalize(i, t);
      const c = toCrowd(this.latest);
      // Phones-up share only counts inside a light moment.
      this.crowd = this.lm.active ? c : { ...c, phonesUp: undefined };
      this.engine.runner.live = this.crowd;
      this.onChange();
    }
  }
  setSelf(on: boolean) {
    this.selfOn = on;
    if (!on) this.agg.leave("master");
  }
  get lightMoment() {
    return this.lm.active;
  }
  /** Test/demo hook: start a light moment now (as if a build-up had begun). */
  startLightMoment() {
    this.lm = { active: true, lastStart: now(), endBar: -1 };
    this.agg.freezeE = this.latest?.E ?? 0;
  }
  close() {
    clearInterval(this.timer);
    this.hub.close();
  }
}
const r2 = (x: number) => Math.round(x * 100) / 100;
export interface LightState {
  active: boolean;
  lastStart: number;
  endBar: number;
}
/** Light moment rule (pure): starts with a build-up (≥ 15 min after the last one, so at most
 * 4 per hour), ends 8 bars after the drop. */
export function lightStep(lm: LightState, p: { section: string; sectionBar: number; buildBlock: number; drop: string | null; index: number }, t: number): LightState {
  let s = { ...lm };
  if (p.section === "build" && p.sectionBar === 0 && p.buildBlock === 0 && !s.active && t - s.lastStart >= LM_SPACING_MS) s = { active: true, lastStart: t, endBar: -1 };
  if (p.drop && s.active) s.endBar = p.index + 8;
  if (s.active && s.endBar >= 0 && p.index >= s.endBar) s.active = false;
  return s;
}
