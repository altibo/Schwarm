// Crowd input is an abstract aggregate. The director never sees individual people, only this
// summary, so it works the same for 1 dancer and for 1000+ (O(1) per participant update).
import { clamp, rng, hash } from "./rng.ts";
export interface CrowdInput {
  /** Crowd energy on the 0–10 ladder scale (CEI). */
  energy: number;
  /** Beat lock 0–1. For N ≥ 2: mean resultant length R of the phases (Rayleigh). For N = 1: the
   * single dancer's beat stability (consistency of their own phase over the last bars). */
  sync: number;
  /** Share of joined devices that currently count (0–1). */
  participation: number;
  /** Number of counting participants (≥ 1; the master counts when it dances). */
  n: number;
  // --- only present for measured (live) input; the simulation leaves them out ---------------
  /** Reports that went into this bar's sync estimate (sample size m ≤ N with sampling). */
  reports?: number;
  /** Median of the devices' own phase stability Rᵢ. */
  stability?: number;
  /** Solo: consecutive bars with Rᵢ ≥ 0.6. */
  streak?: number;
  /** Phones-up share U during a light moment. */
  phonesUp?: number;
}
/** Solo unlock needs Rᵢ ≥ 0.6 over 2 blocks (concept §7, solo mode). */
export const SOLO_STREAK = 16;
// Streaming aggregate over participant summaries: running sums only, no per-person list.
export class CrowdAggregate {
  private w = 0;
  private e = 0;
  private c = 0;
  private s = 0;
  private stab = 0;
  private joined = 0;
  private counting = 0;
  /** One participant window summary: energy 0–10, beat phase (rad), own stability 0–1, weight qᵢ. */
  add(p: { energy: number; phase: number; stability: number; weight?: number; counts?: boolean }) {
    this.joined++;
    if (p.counts === false) return;
    const w = p.weight ?? 1;
    this.counting++;
    this.w += w;
    this.e += w * p.energy;
    this.c += w * Math.cos(p.phase);
    this.s += w * Math.sin(p.phase);
    this.stab += w * p.stability;
  }
  result(): CrowdInput {
    const n = this.counting;
    if (!n || this.w <= 0) return { energy: 0, sync: 0, participation: 0, n: 0 };
    const r = Math.hypot(this.c, this.s) / this.w;
    return {
      energy: this.e / this.w,
      // Rayleigh's R is meaningless for one phase (always 1): use the dancer's own stability.
      sync: n === 1 ? this.stab / this.w : r,
      participation: this.joined ? n / this.joined : 0,
      n,
    };
  }
}
export type UnlockMode = "solo" | "klein" | "gruppe";
export interface UnlockRule {
  mode: UnlockMode;
  /** Minimum sync for the drop to unlock. */
  syncMin: number;
  /** Minimum crowd energy for the drop to unlock. */
  energyMin: number;
  /** Minimum participation share. */
  participationMin: number;
  text: string;
}
// Drop unlock rule as a function of N (concept §7: drop from N ≥ 5 by group sync; below that
// a dedicated small-group / solo rule). For large N the Rayleigh critical value sqrt(-ln α / N)
// shrinks, so the threshold falls to a fixed musical floor of 0.35.
export function unlockRule(n: number): UnlockRule {
  if (n <= 1)
    return {
      mode: "solo",
      syncMin: 0.6,
      energyMin: 6,
      participationMin: 0,
      text: "Solo: eigener Takt stabil ≥ 60 % und Energie ≥ 6",
    };
  if (n < 5)
    return {
      mode: "klein",
      syncMin: 0.65,
      energyMin: 5.5,
      participationMin: 0.5,
      text: `Kleine Gruppe (${n}): Gleichtakt ≥ 65 %, Energie ≥ 5,5, ≥ 50 % zählen`,
    };
  const crit = Math.sqrt(-Math.log(0.05) / n);
  const syncMin = Math.max(0.35, Math.min(0.6, crit));
  return {
    mode: "gruppe",
    syncMin,
    energyMin: 5,
    participationMin: 0.4,
    text: `Gruppe (${formatN(n)}): Gleichtakt R ≥ ${Math.round(syncMin * 100)} % (Rayleigh, α = 5 %), Energie ≥ 5, ≥ 40 % zählen`,
  };
}
export const formatN = (n: number) => (n >= 1000 ? `${(n / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} Tsd.` : String(n));
/** Readiness 0–1 for the meter: the weakest of the three conditions, 1 = unlocked. */
export function readiness(c: CrowdInput): number {
  if (c.n < 1) return 0;
  const r = unlockRule(c.n);
  let syncMin = r.syncMin;
  // Measured input: the sync value is the chance-corrected S of m reports; the Rayleigh test
  // (p < 0.05 ⇔ m·R² ≥ 3 ⇔ S ≥ √(2/(m−1))) must hold on top of the musical threshold.
  if (c.reports !== undefined && r.mode !== "solo") syncMin = Math.max(syncMin, c.reports > 1 ? Math.sqrt(2 / (c.reports - 1)) : 1);
  const parts = [c.sync / syncMin, c.energy / r.energyMin];
  if (r.participationMin > 0) parts.push(c.participation / r.participationMin);
  if (c.stability !== undefined && r.mode !== "solo") parts.push(c.stability / 0.5);
  if (c.streak !== undefined && r.mode === "solo") parts.push(c.streak / SOLO_STREAK);
  return clamp(Math.min(...parts));
}
export const unlocked = (c: CrowdInput) => readiness(c) >= 1;
// Log-scale mapping for the "Anzahl Tänzer" control: slider 0–1 ↔ 1…5000.
export const N_MAX = 5000;
export const sliderToN = (u: number) => Math.max(1, Math.round(Math.exp(clamp(u) * Math.log(N_MAX))));
export const nToSlider = (n: number) => clamp(Math.log(Math.max(1, n)) / Math.log(N_MAX));
// Simulated crowd for the blind test and the offline render. It follows the music with a lag,
// has one stubborn stretch (to exercise moves and the anchor fallback) and gets more beat lock
// while a build-up runs. Deterministic per seed. It is a model, not a measurement.
export class CrowdSim {
  energy = 1.5;
  private sync = 0.2;
  private r;
  n: number;
  constructor(seed: number, n = 12) {
    this.r = rng(hash("crowd", seed));
    this.n = n;
  }
  /** Advance by one bar. musicLevel 1–10, section of the bar, minute of the set. */
  step(musicLevel: number, section: string, minute: number, moveBoost = 0): CrowdInput {
    const stubborn = minute >= 16 && minute < 21 ? 5.2 : 10;
    let target = Math.min(stubborn, musicLevel * 0.95 + 0.3 + moveBoost);
    if (section === "breakdown") target = Math.max(1, musicLevel - 3);
    if (section === "build") target = musicLevel - 0.5;
    const noise = (this.r() - 0.5) * 0.25;
    this.energy = clamp(this.energy + (target - this.energy) * 0.09 + noise, 0, 10);
    const syncTarget = section === "build" ? clamp(0.25 + this.energy / 11) : clamp(0.15 + this.energy / 18);
    this.sync = clamp(this.sync + (syncTarget - this.sync) * 0.2 + (this.r() - 0.5) * 0.04);
    // Sampling noise of R shrinks with N: a small group fluctuates more.
    const jitter = (this.r() - 0.5) * (0.3 / Math.sqrt(Math.max(1, this.n)));
    return { energy: this.energy, sync: clamp(this.sync + jitter), participation: 0.8, n: this.n };
  }
}
