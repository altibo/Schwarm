// Live engine: AudioContext + look-ahead scheduler. Decisions are made one bar ahead, every
// event is placed on the audio clock (sample-accurate), never on timers.
import { SetRunner, type SetOptions } from "./set.ts";
import type { Score } from "./arranger.ts";
import { loadLibrary } from "./audio/samples.ts";
import { createMix, scheduleBar, type Mix } from "./audio/mix.ts";
import { loadProfile } from "./profile.ts";
export class LiveEngine {
  ctx: AudioContext | null = null;
  mix: Mix | null = null;
  runner: SetRunner;
  analyser: AnalyserNode | null = null;
  private master: GainNode | null = null;
  private startAt = 0;
  private timer = 0;
  private scheduled: { at: number; score: Score }[] = [];
  /** Bars that already started playing (for the UI history). */
  played: Score[] = [];
  lateBars = 0;
  running = false;
  ended = false;
  onBar: (s: Score) => void = () => {};
  /** A bar was scheduled; `heard` is when it will be heard, on the shared wall clock (ms). */
  onSchedule: (s: Score, heard: number) => void = () => {};
  /** Speaker latency correction from the tap calibration (ms, + = later). */
  latencyMs = loadProfile().speakerMs;
  onEnd: () => void = () => {};
  private lock: { release(): Promise<void> } | null = null;
  constructor(opts: SetOptions) {
    this.runner = new SetRunner(opts);
  }
  reset(opts: SetOptions) {
    this.stop();
    this.runner = new SetRunner(opts);
    this.played = [];
    this.scheduled = [];
    this.ended = false;
  }
  /** Create/resume the AudioContext synchronously inside a user gesture (iOS needs that). */
  prime(): AudioContext {
    if (!this.ctx) {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new C({ latencyHint: "playback" });
    }
    void this.ctx.resume();
    return this.ctx;
  }
  /** Must be called from a user gesture (tap) so mobile browsers allow audio. */
  async start() {
    if (this.running) return;
    const ctx = this.prime();
    const lib = await loadLibrary(ctx, import.meta.env.BASE_URL);
    this.master = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.master.connect(this.analyser);
    this.master.connect(ctx.destination);
    this.mix = createMix(ctx, lib, this.master);
    await ctx.resume();
    // Continue where the set was stopped: the director state is kept, the clock restarts.
    const resumeAt = this.runnerTime();
    this.startAt = ctx.currentTime + 0.12 - resumeAt;
    this.running = true;
    this.timer = window.setInterval(() => this.tick(), 25);
    this.tick();
    try {
      const wl = (navigator as unknown as { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock;
      this.lock = wl ? await wl.request("screen") : null;
    } catch {
      this.lock = null;
    }
  }
  private runnerTime() {
    return this.runner.director.time;
  }
  private tick() {
    const ctx = this.ctx;
    if (!ctx || !this.mix || !this.running) return;
    const ahead = document.hidden ? 1.6 : 0.3;
    while (!this.runner.finished && this.startAt + this.runnerTime() < ctx.currentTime + ahead) {
      const score = this.runner.next();
      const at = this.startAt + score.plan.time;
      if (at < ctx.currentTime) this.lateBars++;
      scheduleBar(this.mix, score, Math.max(at, ctx.currentTime + 0.005));
      this.scheduled.push({ at, score });
      this.onSchedule(score, this.ctxToWall(at));
    }
    while (this.scheduled.length && this.scheduled[0].at <= ctx.currentTime) {
      const s = this.scheduled.shift()!;
      this.played.push(s.score);
      this.onBar(s.score);
    }
    if (this.runner.finished && !this.scheduled.length && !this.ended) {
      this.ended = true;
      window.setTimeout(() => {
        this.stop();
        this.onEnd();
      }, 4000);
    }
  }
  /** Audio-context time → wall clock (performance.timeOrigin + performance.now domain, ms) of the
   * moment it leaves the speaker, incl. reported output latency and the tap calibration. */
  ctxToWall(t: number) {
    const ctx = this.ctx;
    if (!ctx) return NaN;
    const ts = ctx.getOutputTimestamp?.();
    let perf: number;
    if (ts && ts.performanceTime && ts.contextTime) perf = ts.performanceTime + (t - ts.contextTime) * 1000;
    else perf = performance.now() + (t - ctx.currentTime) * 1000 + ((ctx.outputLatency || 0) + (ctx.baseLatency || 0)) * 1000;
    return performance.timeOrigin + perf + this.latencyMs;
  }
  /** Seconds into the set that are audible right now. */
  get position() {
    if (!this.ctx || !this.running) return this.played.length ? this.played[this.played.length - 1].plan.time : 0;
    return Math.max(0, this.ctx.currentTime - this.startAt);
  }
  get current(): Score | undefined {
    return this.played[this.played.length - 1];
  }
  /** Beat phase 0–1 of the audible beat (for glow pulses). */
  get beatPhase() {
    const s = this.current;
    if (!s || !this.running) return 0;
    const beat = 60 / s.plan.bpm;
    return (((this.position - s.plan.time) % beat) + beat) % beat / beat;
  }
  stop() {
    if (!this.running) return;
    this.running = false;
    window.clearInterval(this.timer);
    const ctx = this.ctx;
    if (ctx && this.master && this.mix) {
      const t = ctx.currentTime;
      this.master.gain.setTargetAtTime(0, t, 0.03);
      for (const s of this.mix.sources) {
        try {
          s.stop(t + 0.15);
        } catch {
          /* already stopped */
        }
      }
      const m = this.master;
      window.setTimeout(() => m.disconnect(), 400);
    }
    // Bars that were planned but not heard are dropped; the director continues from the last
    // planned bar (≤ 0.3 s ahead), which is fine for a test tool.
    this.scheduled = [];
    void this.lock?.release().catch(() => {});
    this.lock = null;
  }
}
