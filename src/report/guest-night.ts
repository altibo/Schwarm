// The guest's own night, kept only on the guest's phone (localStorage): per minute the crowd
// values it received live + its own sensor values. Source for "Meine Karte" – no server.
// (The concept's next-day recap link would need a relay storing the group curve for 72 h; we
// have no own relay, so the recap is built from what this phone received live. docs/auswertung.md)
import type { BarMsg } from "../net/session.ts";
import type { BarFeatures } from "../sense.ts";
export interface NightMinute {
  /** Minute index since the first bar this phone heard. */
  k: number;
  w: number;
  /** Sums for means: crowd energy (only bars where someone counted), sync, own energy. */
  eSum: number;
  sSum: number;
  cBars: number;
  nMax: number;
  meE: number;
  meBars: number;
  /** Own bars with beat stability Rᵢ ≥ 0.6 ("im Takt"). */
  meSync: number;
}
export interface GuestNight {
  v: 1;
  sid: string;
  start: number;
  end: number;
  preset: string;
  minutes: NightMinute[];
  drops: { w: number; type: string }[];
  maxN: number;
  phonesUp: number;
  /** Per bar (for short nights): crowd E (null = nobody counted) and own energy, 0–10, 1 decimal. */
  bars?: [number | null, number | null][];
}
export const NIGHTS_KEY = "schwarm.nights";
export const MAX_NIGHTS = 6;
export const IN_SYNC_R = 0.6;
export class NightLog {
  night: GuestNight;
  private lastDrop = -1;
  private wasUp = false;
  constructor(sid: string, existing?: GuestNight) {
    this.night = existing ?? { v: 1, sid, start: 0, end: 0, preset: "", minutes: [], drops: [], maxN: 0, phonesUp: 0 };
  }
  private minute(w: number): NightMinute {
    if (!this.night.start) this.night.start = w;
    this.night.end = Math.max(this.night.end, w);
    const k = Math.floor((w - this.night.start) / 60000);
    let m = this.night.minutes.at(-1);
    if (!m || m.k !== k) {
      m = { k, w, eSum: 0, sSum: 0, cBars: 0, nMax: 0, meE: 0, meBars: 0, meSync: 0 };
      this.night.minutes.push(m);
      if (this.night.minutes.length > 600) this.night.minutes.shift();
    }
    return m;
  }
  private seen = new Set<string>();
  bar(b: BarMsg, w: number) {
    // Several transports may deliver the same bar: count each (page epoch, bar) once.
    const key = `${b.ep}:${b.i}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!);
    const m = this.minute(w);
    this.night.preset = b.preset;
    if (b.crowd.n > 0) {
      m.eSum += b.crowd.E;
      m.sSum += b.crowd.S;
      m.cBars++;
    }
    m.nMax = Math.max(m.nMax, b.crowd.n);
    const bars = (this.night.bars ??= []);
    bars.push([b.crowd.n > 0 ? Math.round(b.crowd.E * 10) / 10 : null, null]);
    if (bars.length > 4000) bars.shift();
    this.night.maxN = Math.max(this.night.maxN, b.crowd.n);
    if (b.drop && b.i !== this.lastDrop) {
      this.lastDrop = b.i;
      this.night.drops.push({ w, type: b.drop });
    }
    if (b.up && !this.wasUp) this.night.phonesUp++;
    this.wasUp = b.up;
  }
  me(f: BarFeatures, w: number) {
    if (f.n <= 0 || f.still) return;
    const m = this.minute(w);
    m.meE += f.e * 10;
    const last = this.night.bars?.at(-1);
    if (last) last[1] = Math.round(f.e * 100) / 10;
    m.meBars++;
    if (f.R >= IN_SYNC_R) m.meSync++;
  }
}
/** Below this many minutes the card curve uses bars instead of minutes. */
export const SHORT_NIGHT_MIN = 15;
export function summarizeNight(n: GuestNight) {
  const mins = n.minutes;
  const byMin = mins.map((m) => (m.cBars ? m.eSum / m.cBars : null));
  const fine = mins.length < SHORT_NIGHT_MIN && (n.bars?.length ?? 0) >= 4;
  const crowd = fine ? n.bars!.map((b) => b[0]) : byMin;
  const me = fine ? n.bars!.map((b) => b[1]) : mins.map((m) => (m.meBars ? m.meE / m.meBars : null));
  const meBars = mins.reduce((a, m) => a + m.meBars, 0);
  const meSync = mins.reduce((a, m) => a + m.meSync, 0);
  let pm = -1;
  byMin.forEach((v, k) => v !== null && (pm < 0 || v > byMin[pm]!) && (pm = k));
  let peak = -1;
  crowd.forEach((v, k) => v !== null && (peak < 0 || v > crowd[peak]!) && (peak = k));
  return {
    crowd,
    me,
    peak: peak >= 0 ? peak : undefined,
    peakW: pm >= 0 ? mins[pm].w : null,
    /** Minutes in which this phone reported its own movement. */
    myMinutes: mins.filter((m) => m.meBars > 0).length,
    myEnergy: meBars ? mins.reduce((a, m) => a + m.meE, 0) / meBars : null,
    mySync: meBars ? meSync / meBars : null,
    minutes: mins.length,
  };
}
type Store = Pick<Storage, "getItem" | "setItem">;
export function loadNights(store: Store = localStorage): GuestNight[] {
  try {
    const xs = JSON.parse(store.getItem(NIGHTS_KEY) ?? "[]") as GuestNight[];
    return Array.isArray(xs) ? xs.filter((x) => x && x.v === 1) : [];
  } catch {
    return [];
  }
}
export function saveNight(n: GuestNight, store: Store = localStorage) {
  if (!n.start) return;
  const xs = loadNights(store).filter((x) => !(x.sid === n.sid && x.start === n.start));
  xs.unshift(n);
  store.setItem(NIGHTS_KEY, JSON.stringify(xs.slice(0, MAX_NIGHTS)));
}
export function deleteNight(sid: string, start: number, store: Store = localStorage) {
  store.setItem(NIGHTS_KEY, JSON.stringify(loadNights(store).filter((x) => !(x.sid === sid && x.start === start))));
}
