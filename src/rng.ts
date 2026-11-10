// Deterministic helpers: the same seed always yields the same set (offline render = blind-test set).
export function hash(...parts: (number | string)[]): number {
  let h = 2166136261 >>> 0;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 0x9e3779b9;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
export type Rng = () => number;
export function rng(seed: number): Rng {
  let a = seed >>> 0 || 0x2545f491;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Same generator as rng(), with its state readable/settable (for snapshots / resume). */
export interface SRng {
  (): number;
  state: number;
}
export function srng(seed: number): SRng {
  const f = (() => {
    f.state = (f.state + 0x6d2b79f5) >>> 0;
    let t = f.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as SRng;
  f.state = seed >>> 0 || 0x2545f491;
  return f;
}
export const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length) % xs.length];
export const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
// Pick an index, avoiding the most recent ones where possible.
export function pickFresh(r: Rng, n: number, recent: readonly number[]): number {
  const options = [...Array(n).keys()].filter((i) => !recent.includes(i));
  const pool = options.length ? options : [...Array(n).keys()];
  return pool[Math.floor(r() * pool.length) % pool.length];
}
// Euclidean rhythm E(k, n) rotated by rot: k onsets spread as evenly as possible over n steps.
export function euclid(k: number, n: number, rot = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (Math.floor(((i + rot) * k) / n) !== Math.floor(((i + rot - 1) * k) / n)) out.push(i);
  return out;
}
