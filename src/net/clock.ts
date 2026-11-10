// NTP-style clock sync (concept §4): ping-pong, the sample with the smallest round trip wins.
// offset = masterTime − localTime. The error is bounded by RTT/2 (path asymmetry).
export interface ClockSample {
  /** Local send time (ms). */
  t0: number;
  /** Master time when it answered (ms). */
  tm: number;
  /** Local receive time (ms). */
  t2: number;
}
export class ClockSync {
  private samples: (ClockSample & { at: number })[] = [];
  /** Keep the best of the last `window` samples so a drifting clock or a new route is followed. */
  private window: number;
  constructor(window = 24) {
    this.window = window;
  }
  add(s: ClockSample) {
    if (!(s.t2 >= s.t0)) return;
    this.samples.push({ ...s, at: s.t2 });
    if (this.samples.length > this.window) this.samples.shift();
  }
  get count() {
    return this.samples.length;
  }
  private best() {
    let b: ClockSample | null = null;
    for (const s of this.samples) if (!b || s.t2 - s.t0 < b.t2 - b.t0) b = s;
    return b;
  }
  /** masterTime − localTime in ms (0 until the first sample). */
  get offset() {
    const b = this.best();
    return b ? b.tm - (b.t0 + b.t2) / 2 : 0;
  }
  get rtt() {
    const b = this.best();
    return b ? b.t2 - b.t0 : Infinity;
  }
  /** Worst-case error of the offset (half the best round trip). */
  get error() {
    return this.rtt / 2;
  }
  toMaster(local: number) {
    return local + this.offset;
  }
  toLocal(master: number) {
    return master - this.offset;
  }
}
/** Shared high-resolution wall clock (ms since epoch, monotonic within a page). */
export const now = () => performance.timeOrigin + performance.now();
