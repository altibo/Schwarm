// Guest engine without UI: session link + clock + motion features + per-bar reporting.
// Used by guest.html and by the swarm harness (many guests in one page for load tests).
import { GuestLink, type BarMsg } from "./net/session.ts";
import { MotionFeatures, type BarFeatures, type MotionSample } from "./sense.ts";
import { now } from "./net/clock.ts";
import type { NetChoice } from "./net/transport.ts";
export interface GuestOpts {
  sid: string;
  key: string;
  net?: NetChoice;
  id?: string;
  /** Measure and report (false = watch only, never counted). */
  sensing?: boolean;
  random?: () => number;
}
export class GuestCore {
  readonly link: GuestLink;
  readonly feat = new MotionFeatures();
  sensing: boolean;
  pocket = false;
  visible = true;
  my: BarFeatures | null = null;
  /** Last processed bar index. */
  private done = -1;
  private lastHb = -1;
  private rand: () => number;
  private timer = 0;
  joinedAt = 0;
  joinMs = 0;
  reports = 0;
  onBar: (m: BarMsg) => void = () => {};
  onFeatures: (f: BarFeatures, bar: number) => void = () => {};
  constructor(o: GuestOpts) {
    this.link = new GuestLink(o.sid, o.key, o.net ?? "auto", o.id);
    this.sensing = o.sensing ?? true;
    this.rand = o.random ?? Math.random;
    this.link.onBar = (m) => this.onBar(m);
  }
  connect() {
    return this.link.connect();
  }
  /** Join (after consent). `t0` = when the guest opened the page, for the join-time metric. */
  async start(t0 = now()) {
    await this.link.join();
    this.joinMs = now() - t0;
    this.joinedAt = now();
    this.timer = setInterval(() => void this.tick(), 50) as unknown as number;
  }
  push(s: MotionSample) {
    if (this.sensing && this.visible) this.feat.push(s);
  }
  setVisible(v: boolean) {
    if (v === this.visible) return;
    this.visible = v;
    // Hidden pages leave the denominator right away (not counted as tired).
    void this.link.send({ t: "hb", id: this.link.id, vis: v, watch: !this.sensing || undefined });
  }
  /** Close every finished bar of the master grid: features → report (with probability p). */
  private async tick() {
    const g = this.link.last;
    if (!g || this.link.clock.count < 3) return;
    const cur = this.link.barAt(now());
    if (!Number.isFinite(cur)) return;
    if (this.done < 0) this.done = cur - 1;
    while (this.done < cur - 1) {
      const bar = ++this.done;
      if (!this.visible) continue;
      const start = this.link.barStartLocal(bar) - performance.timeOrigin;
      const end = this.link.barStartLocal(bar + 1) - performance.timeOrigin;
      if (!this.sensing) {
        if (bar - this.lastHb >= 8) this.heartbeat(bar, false);
        continue;
      }
      const f = this.feat.bar(start, end, 60000 / g.bpm, { pocket: this.pocket });
      this.my = f;
      this.onFeatures(f, bar);
      const p = g.p ?? 1;
      if (this.rand() < p) {
        this.reports++;
        this.lastHb = bar;
        await this.link.send({ t: "f", id: this.link.id, bar, e: r3(f.e), ph: r3(f.ph), R: r3(f.R), q: r3(f.q), pose: f.pose, p, still: f.still || undefined });
      } else if (bar - this.lastHb >= 8) this.heartbeat(bar, f.still);
    }
  }
  private heartbeat(bar: number, still: boolean) {
    this.lastHb = bar;
    void this.link.send({ t: "hb", id: this.link.id, vis: this.visible, still: still || undefined, watch: !this.sensing || undefined });
  }
  async leave() {
    clearInterval(this.timer);
    await this.link.leave();
  }
}
const r3 = (x: number) => Math.round(x * 1000) / 1000;
