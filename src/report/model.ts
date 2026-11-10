// The recorded night: one compact row per heard bar + the director's event log. Stored only on
// the master device (IndexedDB), never uploaded.
import type { BarPlan, DirectorEvent } from "../director.ts";
import type { CrowdMode } from "../set.ts";
export interface BarRow {
  i: number;
  /** Seconds since the start of the set. */
  t: number;
  /** Wall clock (ms since epoch) when the bar was heard. */
  w: number;
  soll: number;
  lvl: number;
  E: number;
  S: number;
  P: number;
  n: number;
  ready: number;
  sec: BarPlan["section"];
  ph: string;
  d: BarPlan["drop"];
  mv: BarPlan["move"];
  /** Phones-up quota U (share of reporting phones held up) and whether the call was on. */
  U: number;
  pu: boolean;
}
export interface PartyRecord {
  v: 1;
  id: string;
  startedAt: number;
  updatedAt: number;
  preset: string;
  presetLabel: string;
  mode: CrowdMode;
  seed: number;
  /** Max number of devices that were connected at some point. */
  joinedMax: number;
  bars: BarRow[];
  events: DirectorEvent[];
  finished: boolean;
}
/** Crowd-Energie-Index for Techno/House (concept §7): 0–100. */
export const cei = (E: number, S: number, P: number) => 100 * (0.45 * (E / 10) + 0.35 * S + 0.2 * P);
/** null = nobody counted in this bar (no measurement, not "zero energy"). */
export const rowCei = (r: BarRow) => (r.n > 0 ? cei(r.E, r.S, r.P) : null);
export const r2 = (x: number) => Math.round(x * 100) / 100;
export function rowFrom(p: BarPlan, w: number, extra: { U?: number; pu?: boolean } = {}): BarRow {
  return {
    i: p.index,
    t: Math.round(p.time * 1000) / 1000,
    w: Math.round(w),
    soll: r2(p.soll),
    lvl: p.level,
    E: r2(p.crowd.energy),
    S: r2(p.crowd.sync),
    P: r2(p.crowd.participation),
    n: p.crowd.n,
    ready: r2(p.readiness),
    sec: p.section,
    ph: p.phaseName,
    d: p.drop,
    mv: p.move,
    U: r2(extra.U ?? 0),
    pu: !!extra.pu,
  };
}
export const MODE_LABEL: Record<CrowdMode, string> = { live: "Live gemessen", sim: "Simulation (keine echten Messwerte)", manual: "Regler (keine echten Messwerte)" };
