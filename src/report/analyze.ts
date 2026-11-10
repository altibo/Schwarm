// "Nach der Nacht": pure, rule-based analysis of a recorded night (concept §11). Everything is
// derived from the bar rows; nothing here needs a server.
import { MOVE_LABEL, type MoveType, type DropType } from "../director.ts";
import { rowCei, r2, type BarRow, type PartyRecord } from "./model.ts";
export interface MinuteRow { m: number; w: number; soll: number; ist: number | null; cei: number | null; P: number | null; S: number | null; n: number; lvl: number }
export interface DropInfo { i: number; t: number; w: number; type: DropType; waitBars: number; ceiBefore: number | null; ceiAfter: number | null }
export interface BreakInfo { i: number; t: number; w: number; bars: number; ceiBefore: number | null; ceiAfter: number | null }
export type MoveVerdict = "gewirkt" | "neutral" | "eher nicht" | "überlagert" | "nicht messbar";
export interface MoveInfo { i: number; t: number; w: number; type: MoveType; label: string; before: number | null; after: number | null; delta: number | null; expected: number; reward: number | null; verdict: MoveVerdict; director: "gewirkt" | "ohne Wirkung" | null }
export interface Moment { i: number; t: number; w: number; cei: number; label: string }
export interface Report {
  minutes: MinuteRow[];
  drops: DropInfo[];
  breakdowns: BreakInfo[];
  moves: MoveInfo[];
  top: Moment[];
  topMoves: MoveInfo[];
  flopMoves: MoveInfo[];
  summary: {
    bars: number;
    durationMin: number;
    startedAt: number;
    endedAt: number;
    drops: number;
    unlocked: number;
    rescue: number;
    forced: number;
    breakdowns: number;
    maxN: number;
    avgN: number;
    avgP: number | null;
    avgS: number | null;
    avgCei: number | null;
    measuredShare: number;
    /** Mean |soll − ist| over measured bars (energy points 0–10). */
    deviation: number | null;
    peak: Moment | null;
    phonesUp: number | null;
  };
}
/** Move window (bars from the move's first bar): before = [−8, 0), after = [24, 32) – the
 * second half of the second phrase, where the director judges it too. */
export const MOVE_BEFORE = 8;
export const MOVE_AFTER: [number, number] = [24, 32];
/** |reward| below this many CEI points counts as "neutral". */
export const MOVE_THRESHOLD = 3;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const nn = <T>(x: T | null): x is T => x !== null;
function ceiOver(rows: BarRow[], from: number, to: number) {
  return mean(rows.slice(Math.max(0, from), Math.max(0, to)).map(rowCei).filter(nn));
}
export function analyze(rec: PartyRecord): Report {
  const rows = rec.bars;
  const n = rows.length;
  const end = rows.at(-1);
  // --- per minute ---
  const byMin = new Map<number, BarRow[]>();
  for (const r of rows) {
    const m = Math.floor(r.t / 60);
    if (!byMin.has(m)) byMin.set(m, []);
    byMin.get(m)!.push(r);
  }
  const minutes: MinuteRow[] = [...byMin.entries()].map(([m, rs]) => {
    const meas = rs.filter((r) => r.n > 0);
    const c = meas.map(rowCei).filter(nn);
    return {
      m,
      w: rs[0].w,
      soll: r2(mean(rs.map((r) => r.soll))!),
      ist: meas.length ? r2(mean(meas.map((r) => r.E))!) : null,
      cei: c.length ? r2(mean(c)!) : null,
      P: meas.length ? r2(mean(meas.map((r) => r.P))!) : null,
      S: meas.length ? r2(mean(meas.map((r) => r.S))!) : null,
      n: Math.max(...rs.map((r) => r.n)),
      lvl: Math.round(mean(rs.map((r) => r.lvl))!),
    };
  });
  // --- drops ---
  const drops: DropInfo[] = [];
  rows.forEach((r, k) => {
    if (!r.d) return;
    let wait = 0;
    for (let j = k - 1; j >= 0 && rows[j].sec === "build"; j--) wait++;
    drops.push({ i: r.i, t: r.t, w: r.w, type: r.d, waitBars: wait, ceiBefore: ceiOver(rows, k - 8, k), ceiAfter: ceiOver(rows, k, k + 8) });
  });
  // --- breakdowns ---
  const breakdowns: BreakInfo[] = [];
  for (let k = 0; k < n; k++) {
    if (rows[k].sec !== "breakdown" || (k > 0 && rows[k - 1].sec === "breakdown")) continue;
    let e = k;
    while (e + 1 < n && rows[e + 1].sec === "breakdown") e++;
    breakdowns.push({ i: rows[k].i, t: rows[k].t, w: rows[k].w, bars: e - k + 1, ceiBefore: ceiOver(rows, k - 8, k), ceiAfter: ceiOver(rows, e + 1, e + 9) });
  }
  // --- moves: rule-based before/after CEI, corrected for the curve trend ---
  const moves: MoveInfo[] = [];
  for (let k = 0; k < n; k++) {
    const r = rows[k];
    if (!r.mv || (k > 0 && rows[k - 1].mv === r.mv && rows[k - 1].i === r.i - 1)) continue;
    const before = ceiOver(rows, k - MOVE_BEFORE, k);
    const after = ceiOver(rows, k + MOVE_AFTER[0], k + MOVE_AFTER[1]);
    const sollB = mean(rows.slice(Math.max(0, k - MOVE_BEFORE), k).map((x) => x.soll)) ?? r.soll;
    const sollA = mean(rows.slice(k + MOVE_AFTER[0], k + MOVE_AFTER[1]).map((x) => x.soll)) ?? r.soll;
    // The curve itself moves the floor: 1 energy point = 4.5 CEI points (E weight 0.45 · 10).
    const expected = r2(4.5 * (sollA - sollB));
    const delta = before !== null && after !== null ? r2(after - before) : null;
    const reward = delta !== null ? r2(delta - expected) : null;
    const win = rows.slice(Math.max(0, k - MOVE_BEFORE), k + MOVE_AFTER[1]);
    const disturbed = win.some((x) => x.d || x.sec !== "groove");
    const verdict: MoveVerdict =
      reward === null ? "nicht messbar" : disturbed ? "überlagert" : reward >= MOVE_THRESHOLD ? "gewirkt" : reward <= -MOVE_THRESHOLD ? "eher nicht" : "neutral";
    const ev = rec.events.find((e) => (e.kind === "move-ok" || e.kind === "move-fail") && e.bar > r.i && e.bar <= r.i + 48);
    moves.push({ i: r.i, t: r.t, w: r.w, type: r.mv, label: MOVE_LABEL[r.mv], before: before === null ? null : r2(before), after: after === null ? null : r2(after), delta, expected, reward, verdict, director: ev ? (ev.kind === "move-ok" ? "gewirkt" : "ohne Wirkung") : null });
  }
  const judged = moves.filter((m) => m.reward !== null && m.verdict !== "überlagert");
  const topMoves = [...judged].sort((a, b) => b.reward! - a.reward!).slice(0, 3).filter((m) => m.reward! > 0);
  const flopMoves = [...judged].sort((a, b) => a.reward! - b.reward!).slice(0, 3).filter((m) => m.reward! < 0);
  // --- top moments: 16-bar rolling CEI, local maxima ≥ 64 bars apart ---
  const W = 16;
  const roll: { k: number; c: number }[] = [];
  for (let k = 0; k + W <= n; k++) {
    const c = rows.slice(k, k + W).map(rowCei).filter(nn);
    if (c.length >= W / 2) roll.push({ k, c: mean(c)! });
  }
  roll.sort((a, b) => b.c - a.c);
  const picked: { k: number; c: number }[] = [];
  for (const x of roll) if (picked.length < 3 && picked.every((p) => Math.abs(p.k - x.k) >= 64)) picked.push(x);
  const top: Moment[] = picked.map(({ k, c }) => {
    const mid = rows[k + W / 2] ?? rows[k];
    const win = rows.slice(k, k + W);
    const d = win.find((x) => x.d);
    const label = d ? `Drop (${d.d})` : win.some((x) => x.pu) ? "Phones up" : mid.ph;
    return { i: mid.i, t: mid.t, w: mid.w, cei: r2(c), label };
  });
  const meas = rows.filter((r) => r.n > 0);
  const c = meas.map(rowCei).filter(nn);
  const lm = rows.filter((r) => r.pu && r.n > 0);
  return {
    minutes,
    drops,
    breakdowns,
    moves,
    top,
    topMoves,
    flopMoves,
    summary: {
      bars: n,
      durationMin: end ? r2((end.t + 240 / 130) / 60) : 0,
      startedAt: rows[0]?.w ?? rec.startedAt,
      endedAt: end?.w ?? rec.updatedAt,
      drops: drops.length,
      unlocked: drops.filter((d) => d.type === "freigeschaltet").length,
      rescue: drops.filter((d) => d.type === "rettung").length,
      forced: drops.filter((d) => d.type === "erzwungen").length,
      breakdowns: breakdowns.length,
      maxN: Math.max(0, ...rows.map((r) => r.n)),
      avgN: n ? r2(mean(rows.map((r) => r.n))!) : 0,
      avgP: meas.length ? r2(mean(meas.map((r) => r.P))!) : null,
      avgS: meas.length ? r2(mean(meas.map((r) => r.S))!) : null,
      avgCei: c.length ? r2(mean(c)!) : null,
      measuredShare: n ? r2(meas.length / n) : 0,
      deviation: meas.length ? r2(mean(meas.map((r) => Math.abs(r.soll - r.E)))!) : null,
      peak: top[0] ?? null,
      phonesUp: lm.length ? r2(mean(lm.map((r) => r.U))!) : null,
    },
  };
}
const CSV_HEAD = ["takt", "zeit_s", "uhrzeit_iso", "soll", "stufe", "energie_E", "gleichtakt_S", "beteiligung_P", "zaehlen_N", "cei", "bereitschaft", "abschnitt", "phase", "drop", "move", "phones_up", "phones_up_quote_U"];
const cell = (x: unknown) => {
  const s = x === null || x === undefined ? "" : String(x);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** One line per bar (comma-separated, decimal point, UTF-8). */
export function toCsv(rec: PartyRecord): string {
  const lines = [CSV_HEAD.join(",")];
  for (const r of rec.bars) {
    const c = rowCei(r);
    lines.push([r.i, r.t, new Date(r.w).toISOString(), r.soll, r.lvl, r.E, r.S, r.P, r.n, c === null ? "" : r2(c), r.ready, r.sec, r.ph, r.d ?? "", r.mv ?? "", r.pu ? 1 : 0, r.U].map(cell).join(","));
  }
  return lines.join("\n") + "\n";
}
