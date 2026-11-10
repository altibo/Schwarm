// Master-side streaming aggregation of the guests' per-bar feature packets (concept §7).
// Every packet is folded into fixed-size per-bar accumulators in O(1): weighted sums, the
// resultant vector of the phases and two 20-bin histograms (trimmed mean of eᵢ, median of Rᵢ).
// The director only ever sees the resulting CrowdInput, never a list of people.
import type { CrowdInput } from "./crowd.ts";
import type { Pose } from "./sense.ts";
import { REST_E } from "./sense.ts";
export interface FeaturePacket {
  /** Random per-session device id. */
  id: string;
  /** Master bar index the features belong to. */
  bar: number;
  e: number;
  ph: number;
  R: number;
  q: number;
  pose: Pose;
  /** Sampling probability the guest used for this report (1 = everyone reports). */
  p?: number;
}
const BINS = 20;
class BarAcc {
  ids = new Set<string>();
  m = 0;
  w = 0;
  c = 0;
  s = 0;
  active = 0;
  up = 0;
  eW = new Float64Array(BINS);
  eWE = new Float64Array(BINS);
  rCount = new Float64Array(BINS);
  rSum = new Float64Array(BINS);
  bestR = 0;
}
export interface BarAggregate {
  bar: number;
  /** Active devices (heartbeat in the window, page visible, not lying on a table). */
  n: number;
  /** Devices that sent a report for this bar. */
  m: number;
  /** Joined devices (incl. currently inactive). */
  joined: number;
  /** Crowd energy 0–10 (trimmed, q-weighted mean of eᵢ ×10). */
  E: number;
  /** Mean resultant length of the phases. */
  R: number;
  /** Chance-corrected sync S = √max(0, (m·R² − 1)/(m − 1)). */
  S: number;
  /** Rayleigh statistic Z = m·R² (p < 0.05 ⇔ Z ≥ 3). */
  Z: number;
  /** Share of reporting devices above the rest threshold. */
  P: number;
  /** Share of reporting devices in pose "up". */
  U: number;
  /** Median of the devices' own stability Rᵢ. */
  medR: number;
  /** Solo: consecutive bars with Rᵢ ≥ 0.6. */
  streak: number;
  frozen: boolean;
}
export interface PresenceOpts {
  /** A device is active while it was heard from within this window (ms). */
  windowMs?: number;
}
export class LiveAggregator {
  private bars = new Map<number, BarAcc>();
  private seenAt = new Map<string, { t: number; visible: boolean; still: boolean }>();
  private streak = 0;
  private lastFinal = -1;
  /** Light moment: crowd energy is frozen (concept §3). */
  freezeE: number | null = null;
  private lastE = 0;
  windowMs: number;
  constructor(o: PresenceOpts = {}) {
    this.windowMs = o.windowMs ?? 5000;
  }
  /** Heartbeat or any message from a device. */
  seen(id: string, t: number, visible = true, still = false) {
    this.seenAt.set(id, { t, visible, still });
  }
  leave(id: string) {
    this.seenAt.delete(id);
  }
  get joined() {
    return this.seenAt.size;
  }
  /** Active devices now. Hidden pages and dropped connections leave the denominator – they are
   * not counted as tired. Amortised O(1) per device and bar. */
  active(t: number) {
    let n = 0;
    for (const [id, s] of this.seenAt) {
      if (t - s.t > 10 * 60000) this.seenAt.delete(id);
      else if (t - s.t <= this.windowMs && s.visible && !s.still) n++;
    }
    return n;
  }
  /** O(1) per packet. Duplicates (same device, same bar) are ignored. */
  add(f: FeaturePacket, t: number, still = false) {
    this.seen(f.id, t, true, still);
    if (still || f.bar <= this.lastFinal) return;
    let a = this.bars.get(f.bar);
    if (!a) {
      a = new BarAcc();
      this.bars.set(f.bar, a);
      if (this.bars.size > 16) this.bars.delete(Math.min(...this.bars.keys()));
    }
    if (a.ids.has(f.id)) return;
    a.ids.add(f.id);
    const w = Math.max(0, Math.min(1, f.q)) / Math.max(0.001, f.p ?? 1);
    const e = Math.max(0, Math.min(1, f.e));
    const R = Math.max(0, Math.min(1, f.R));
    a.m++;
    a.w += w;
    a.c += w * Math.cos(f.ph);
    a.s += w * Math.sin(f.ph);
    if (e >= REST_E) a.active += 1;
    if (f.pose === "up") a.up += 1;
    const eb = Math.min(BINS - 1, Math.floor(e * BINS));
    a.eW[eb] += w;
    a.eWE[eb] += w * e;
    const rb = Math.min(BINS - 1, Math.floor(R * BINS));
    a.rCount[rb] += 1;
    a.rSum[rb] += R;
    a.bestR = R;
  }
  /** Close bar `bar` and summarise it. */
  finalize(bar: number, t: number): BarAggregate {
    const a = this.bars.get(bar) ?? new BarAcc();
    this.bars.delete(bar);
    this.lastFinal = Math.max(this.lastFinal, bar);
    for (const k of this.bars.keys()) if (k < bar) this.bars.delete(k);
    const n = Math.max(this.active(t), a.m > 0 ? 1 : 0);
    const m = a.m;
    const R = a.w > 0 ? Math.hypot(a.c, a.s) / a.w : 0;
    const S = m > 1 ? Math.sqrt(Math.max(0, (m * R * R - 1) / (m - 1))) : 0;
    const E = m ? trimmedMean(a.eW, a.eWE, 0.1) * 10 : 0;
    const medR = m ? median(a.rCount, a.rSum) : 0;
    if (n === 1 && m === 1) this.streak = a.bestR >= 0.6 ? this.streak + 1 : 0;
    else if (m !== 1) this.streak = 0;
    if (m) this.lastE = E;
    return {
      bar,
      n,
      m,
      joined: this.joined,
      E: this.freezeE ?? (m ? E : this.lastE),
      R,
      S,
      Z: m * R * R,
      P: m ? a.active / m : 0,
      U: m ? a.up / m : 0,
      medR,
      streak: this.streak,
      frozen: this.freezeE !== null,
    };
  }
}
/** The aggregate as director input. Solo: the dancer's own Rᵢ is the sync. */
export function toCrowd(g: BarAggregate): CrowdInput {
  const solo = g.n <= 1;
  return {
    energy: g.E,
    sync: solo ? g.medR : g.S,
    participation: g.P,
    n: g.n,
    reports: g.m,
    stability: g.medR,
    streak: g.streak,
    phonesUp: g.U,
  };
}
function trimmedMean(w: Float64Array, we: Float64Array, cut: number) {
  let total = 0;
  for (const x of w) total += x;
  if (total <= 0) return 0;
  let lo = total * cut;
  let hi = total * cut;
  const keepW = Float64Array.from(w);
  const keepWE = Float64Array.from(we);
  for (let i = 0; i < BINS && lo > 0; i++) {
    const take = Math.min(lo, keepW[i]);
    if (keepW[i] > 0) keepWE[i] *= 1 - take / keepW[i];
    keepW[i] -= take;
    lo -= take;
  }
  for (let i = BINS - 1; i >= 0 && hi > 0; i--) {
    const take = Math.min(hi, keepW[i]);
    if (keepW[i] > 0) keepWE[i] *= 1 - take / keepW[i];
    keepW[i] -= take;
    hi -= take;
  }
  let sw = 0;
  let swe = 0;
  for (let i = 0; i < BINS; i++) {
    sw += keepW[i];
    swe += keepWE[i];
  }
  return sw > 0 ? swe / sw : 0;
}
function median(count: Float64Array, sum: Float64Array) {
  let total = 0;
  for (const x of count) total += x;
  let acc = 0;
  for (let i = 0; i < BINS; i++) {
    acc += count[i];
    if (acc >= total / 2 && count[i] > 0) return sum[i] / count[i];
  }
  return 0;
}
/** Guest-side sampling above the hub's capacity: report with probability p, master rescales. */
export const SAMPLE_TARGET = 150;
export const samplingP = (nActive: number, target = SAMPLE_TARGET) => (nActive <= target ? 1 : target / nActive);
