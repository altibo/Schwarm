// Guest-side sensing (concept §6/§7). Raw DeviceMotion samples stay on the phone; once per bar
// this turns them into a handful of numbers: energy eᵢ, beat phase φᵢ′ for the detected movement
// period (½, 1 or 2 beats), phase stability Rᵢ over 4 bars, data quality qᵢ and the pose.
// Pure (no DOM): the same code runs in the browser, in unit tests and in the swarm harness.
import { clamp } from "./rng.ts";
export type Pose = "pocket" | "hand" | "up" | "table";
export interface Vec {
  x: number;
  y: number;
  z: number;
}
export interface MotionSample {
  /** Local time in ms. */
  t: number;
  /** Acceleration without gravity (m/s²); null on devices that do not provide it. */
  acc: Vec | null;
  /** Acceleration including gravity (m/s²). */
  accG: Vec | null;
}
/** Lab reference "is dancing" per pose: RMS of linear acceleration in m/s². Placeholders until
 * the lab study (concept §6); the personal adaptation can move them by at most ±30 %. */
export const POSE_REF: Record<Pose, number> = { pocket: 3.5, hand: 2.6, up: 2.0, table: 2.6 };
/** Lab prior of the phase offset φ_kal per pose (rad). Refined only in clear dancing windows. */
export const PHASE_PRIOR: Record<Pose, number> = { pocket: 0, hand: 0, up: 0, table: 0 };
export const REST_E = 0.15;
export const PERIODS = [0.5, 1, 2] as const;
export interface BarFeatures {
  /** Energy 0–1: min(RMS ÷ (Ref_pose · adaptation), 1.5) ÷ 1.5. */
  e: number;
  /** Phase of the movement peaks against the heard beat, for `period`, minus φ_kal (rad). */
  ph: number;
  /** Detected movement period in beats. */
  period: number;
  /** Phase stability over the last 4 bars, chance-corrected (0–1). */
  R: number;
  /** Data quality 0–1 (sensor fallback, sample rate). */
  q: number;
  pose: Pose;
  /** RMS of the linear acceleration in this bar (m/s²) – kept on the phone for the UI. */
  rms: number;
  /** Samples in this bar. */
  n: number;
  /** True if this device should not count (lying still on a table). */
  still: boolean;
}
const TAU = Math.PI * 2;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
interface Row {
  t: number;
  v: number;
  m: number;
}
export class MotionFeatures {
  private rows: Row[] = [];
  private g: Vec | null = null;
  private hp: Vec | null = null;
  private lastAccG: Vec | null = null;
  private lastT = 0;
  private fallback = false;
  private nativeSeen = 0;
  /** Personal adaptation of the energy reference, 0.7–1.3 (×Ref). */
  adapt = 1;
  /** Phase calibration per pose (rad), starts at the lab prior. */
  phaseCal: Record<Pose, number> = { ...PHASE_PRIOR };
  private stillSince = -1;
  pose: Pose = "hand";
  push(s: MotionSample) {
    const dt = this.lastT ? clamp((s.t - this.lastT) / 1000, 0.001, 0.2) : 1 / 60;
    this.lastT = s.t;
    // Gravity direction: low-pass of accelerationIncludingGravity (pose + vertical axis).
    if (s.accG) {
      const a = 1 - Math.exp(-TAU * 0.5 * dt);
      this.g = this.g ? { x: this.g.x + (s.accG.x - this.g.x) * a, y: this.g.y + (s.accG.y - this.g.y) * a, z: this.g.z + (s.accG.z - this.g.z) * a } : { ...s.accG };
    }
    let lin: Vec | null = null;
    const native = s.acc && Number.isFinite(s.acc.x) && (s.acc.x !== 0 || s.acc.y !== 0 || s.acc.z !== 0);
    if (native) {
      this.nativeSeen++;
      lin = s.acc;
    } else if (s.accG) {
      // Fallback (no gyroscope): high-pass ~0.3 Hz on accelerationIncludingGravity.
      if (this.nativeSeen < 5) this.fallback = true;
      const rc = 1 / (TAU * 0.3);
      const k = rc / (rc + dt);
      const p = this.lastAccG ?? s.accG;
      const hp = this.hp ?? { x: 0, y: 0, z: 0 };
      this.hp = { x: k * (hp.x + s.accG.x - p.x), y: k * (hp.y + s.accG.y - p.y), z: k * (hp.z + s.accG.z - p.z) };
      lin = this.hp;
    }
    if (s.accG) this.lastAccG = { ...s.accG };
    if (!lin) return;
    const m = Math.hypot(lin.x, lin.y, lin.z);
    let v = m;
    if (this.g) {
      const gn = Math.hypot(this.g.x, this.g.y, this.g.z) || 1;
      v = (lin.x * this.g.x + lin.y * this.g.y + lin.z * this.g.z) / gn;
    }
    this.rows.push({ t: s.t, v, m });
    // Keep ~12 s (5 bars at 128 BPM plus margin).
    if (this.rows.length > 64 && this.rows[0].t < s.t - 12000) {
      let i = 0;
      while (i < this.rows.length && this.rows[i].t < s.t - 12000) i++;
      this.rows = this.rows.slice(i);
    }
  }
  /** Pose from the gravity direction. Pocket mode is a UI state the guest chose. */
  private detectPose(pocket: boolean, rms: number, t: number): Pose {
    if (pocket) return "pocket";
    if (!this.g) return "hand";
    const gn = Math.hypot(this.g.x, this.g.y, this.g.z) || 1;
    const flat = Math.abs(this.g.z) / gn;
    if (flat > 0.95 && rms < 0.08) {
      if (this.stillSince < 0) this.stillSince = t;
      if (t - this.stillSince >= 60000) return "table";
    } else this.stillSince = -1;
    return Math.abs(this.g.y) / gn > 0.9 ? "up" : "hand";
  }
  /** Features for the bar [start, end) of the heard grid (local ms). */
  bar(start: number, end: number, beatMs: number, o: { pocket?: boolean } = {}): BarFeatures {
    let sum = 0;
    let n = 0;
    for (const r of this.rows)
      if (r.t >= start && r.t < end) {
        sum += r.m * r.m;
        n++;
      }
    const rms = n ? Math.sqrt(sum / n) : 0;
    const pose = this.detectPose(!!o.pocket, rms, end);
    this.pose = pose;
    const ref = POSE_REF[pose] * this.adapt;
    const e = Math.min(rms / ref, 1.5) / 1.5;
    const { R, phase, period } = this.phaseLock(end - 4 * 4 * beatMs, end, start, beatMs);
    const ph = wrap(phase - this.phaseCal[pose]);
    // Personal adaptation: only from clear dancing (Rᵢ ≥ 0.6), time constant 30 min, ±30 %.
    const barSec = (end - start) / 1000;
    if (R >= 0.6 && rms > 0.3 && pose !== "table") {
      const k = barSec / 1800;
      this.adapt += (clamp(rms / POSE_REF[pose], 0.7, 1.3) - this.adapt) * k;
      // φ_kal: slow, and never more than π/6 away from the lab prior ("up" always keeps the prior).
      if (pose !== "up") {
        const d = wrap(phase - this.phaseCal[pose]);
        this.phaseCal[pose] = PHASE_PRIOR[pose] + clamp(wrap(this.phaseCal[pose] + d * k - PHASE_PRIOR[pose]), -Math.PI / 6, Math.PI / 6);
      }
    }
    const expected = (end - start) / 16.7;
    const q = (this.fallback ? 0.7 : 1) * clamp(n / (expected * 0.6));
    return { e, ph, period, R, q, pose, rms, n, still: pose === "table" };
  }
  /** Phase locking over [from, to) against the grid through `origin`: for each candidate period,
   * the phase of every cycle, then the (chance-corrected) consistency of those phases. */
  private phaseLock(from: number, to: number, origin: number, beatMs: number) {
    let best = { R: 0, phase: 0, period: 1, score: -1 };
    let mean = 0;
    let cnt = 0;
    for (const r of this.rows)
      if (r.t >= from && r.t < to) {
        mean += r.v;
        cnt++;
      }
    if (cnt < 20) return best;
    mean /= cnt;
    for (const k of PERIODS) {
      const P = k * beatMs;
      const cycles = new Map<number, { c: number; s: number; a: number; e: number; n: number }>();
      for (const r of this.rows) {
        if (r.t < from || r.t >= to) continue;
        const x = (r.t - origin) / P;
        const c = Math.floor(x);
        const th = (x - c) * TAU;
        const v = r.v - mean;
        const z = cycles.get(c) ?? { c: 0, s: 0, a: 0, e: 0, n: 0 };
        z.c += v * Math.cos(th);
        z.s += v * Math.sin(th);
        z.a += Math.abs(v);
        z.e += v * v;
        z.n++;
        cycles.set(c, z);
      }
      let C = 0;
      let S = 0;
      let used = 0;
      for (const z of cycles.values()) {
        // A cycle counts if there is movement in it and it has a clear peak.
        if (z.n < 3 || Math.sqrt(z.e / z.n) < 0.25 || Math.hypot(z.c, z.s) / z.a < 0.25) continue;
        const a = Math.atan2(z.s, z.c);
        C += Math.cos(a);
        S += Math.sin(a);
        used++;
      }
      if (used < 3) continue;
      const Rraw = Math.hypot(C, S) / used;
      const Rc = Math.sqrt(Math.max(0, (used * Rraw * Rraw - 1) / (used - 1)));
      // Mild prior for the plain beat; long periods have fewer cycles and more chance lock.
      const score = Rc + (k === 1 ? 0.03 : k === 2 ? -0.05 : 0);
      if (score > best.score) best = { R: Rc, phase: Math.atan2(S, C), period: k, score };
    }
    return best;
  }
}
