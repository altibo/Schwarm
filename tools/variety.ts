// Anti-monotony metrics on the symbolic score (what the engine actually schedules).
// Usage: node tools/variety.ts <preset> <seed> [genre] [out.json]
// Works on any SetRunner version (the "before" measurement runs this file in an old checkout).
import { SetRunner } from "../src/set.ts";
import { writeFileSync } from "node:fs";
const [preset = "10m", seedArg = "2026", genre = "", out = ""] = process.argv.slice(2);
const opts: Record<string, unknown> = { preset, seed: Number(seedArg), crowd: "sim" };
if (genre) opts.genre = genre;
const run = new SetRunner(opts as never);
type Sc = ReturnType<SetRunner["next"]>;
const scores: Sc[] = [];
while (!run.finished) scores.push(run.next());
const MEL = new Set(["lead", "stab", "acid", "hoover", "chop", "pluck", "rstab", "hook", "reese"]);
const GEN = new Set(["noisehat"]); // generative ghost hats: excluded from the "core" loop
const evs = (s: Sc) => s.events as unknown as { layer: string; voice: string; sample?: string; step: number; note?: number; notes?: number[]; len: number }[];
const fpFull = (s: Sc) => evs(s).map((e) => `${e.layer}:${e.voice}:${e.sample ?? ""}:${e.step.toFixed(2)}:${e.note ?? (e.notes ?? []).join("/")}`).join("|") + fxTok(s).join(",");
const fpCore = (s: Sc) => evs(s).filter((e) => !GEN.has(e.voice) && !e.layer.startsWith("perc")).map((e) => `${e.layer}:${e.voice}:${e.sample ?? ""}:${e.step.toFixed(2)}:${e.note ?? (e.notes ?? []).join("/")}`).join("|") + fxTok(s).join(",");
function fxTok(s: Sc): string[] {
  const a = s.auto as unknown as Record<string, unknown>;
  const t: string[] = [];
  for (const k of ["stutter", "tape", "crush", "throwFb", "wash"]) if (a[k] !== undefined && a[k] !== null && a[k] !== 0 && a[k] !== -1) t.push(`fx:${k}`);
  if (typeof a.gapAt === "number" && a.gapAt >= 0) t.push("fx:gap");
  return t;
}
const sec = (i: number) => 240 / scores[i].plan.bpm;
function longestLoop(fp: string[]) {
  let best = { bars: 0, seconds: 0, period: 0, atMinute: 0 };
  for (const P of [1, 2, 4, 8]) {
    let run = 0;
    for (let i = P; i < fp.length; i++) {
      run = fp[i] === fp[i - P] ? run + 1 : 0;
      const bars = run ? run + P : 0;
      if (bars > best.bars) {
        const from = i - bars + 1;
        let s = 0;
        for (let k = from; k <= i; k++) s += sec(k);
        best = { bars, seconds: Math.round(s * 10) / 10, period: P, atMinute: Math.round(scores[from].plan.minute * 100) / 100 };
      }
    }
  }
  return best;
}
// Phrases: consecutive bars with the same (section, phraseIndex, buildBlock).
const groups: Sc[][] = [];
let key = "";
for (const s of scores) {
  const k = `${s.plan.section}:${s.plan.phraseIndex}:${s.plan.buildBlock}`;
  if (k !== key) groups.push([]);
  key = k;
  groups[groups.length - 1].push(s);
}
const timbre = (g: Sc[]) => new Set(g.flatMap((s) => [...evs(s).map((e) => `${e.layer}:${e.voice}:${e.sample ?? ""}`), ...fxTok(s)]));
const melCells = (g: Sc[]) => {
  const cells = new Set<string>();
  for (const s of g) {
    const m = evs(s).filter((e) => MEL.has(e.layer) || MEL.has(e.voice));
    if (!m.length) continue;
    const byLayer = new Map<string, string[]>();
    for (const e of m) {
      const n = e.note ?? (e.notes ?? [0])[0];
      const arr = byLayer.get(e.layer) ?? [];
      arr.push(`${e.step.toFixed(1)}:${n}`);
      byLayer.set(e.layer, arr);
    }
    for (const [l, a] of byLayer) cells.add(`${l}=${a.join(",")}`);
  }
  return cells;
};
const jacc = (a: Set<string>, b: Set<string>) => {
  const u = new Set([...a, ...b]);
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return u.size ? 1 - i / u.size : 0;
};
const tn: number[] = [], mn: number[] = [], newT: number[] = [];
const seenT = new Set<string>();
let melPhrases = 0;
groups.forEach((g, k) => {
  const T = timbre(g);
  let fresh = 0;
  for (const x of T) if (!seenT.has(x)) {
    fresh++;
    seenT.add(x);
  }
  if (k > 0) newT.push(fresh);
  if (k > 0) tn.push(jacc(T, timbre(groups[k - 1])));
  const M = melCells(g);
  if (M.size) melPhrases++;
  if (k > 0 && M.size) {
    const prev = melCells(groups[k - 1]);
    let n = 0;
    for (const c of M) if (!prev.has(c)) n++;
    mn.push(n / M.size);
  }
});
const mean = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 1000) / 1000 : 0);
// Harmony: chord pitch-class sets of pads/stabs, distinct bass roots.
const chords = new Set<string>(), roots = new Set<number>();
for (const s of scores)
  for (const e of evs(s)) {
    if ((e.voice === "pad" || e.voice === "stab" || e.voice === "rstab") && e.notes) chords.add([...new Set(e.notes.map((n) => n % 12))].sort((a, b) => a - b).join("-"));
    if (e.layer === "bass" && e.note !== undefined) roots.add(e.note % 12);
  }
// Level contrast: timbre sets per level band.
const band = (s: Sc) => (s.plan.section !== "groove" ? s.plan.section : s.plan.level <= 3 ? "low" : s.plan.level <= 6 ? "mid" : "peak");
const bands = new Map<string, Set<string>>();
for (const s of scores) {
  const b = bands.get(band(s)) ?? new Set<string>();
  for (const e of evs(s)) b.add(`${e.layer}:${e.voice}:${e.sample ?? ""}`);
  for (const t of fxTok(s)) b.add(t);
  bands.set(band(s), b);
}
const bandNames = [...bands.keys()];
const contrast: Record<string, number> = {};
for (let i = 0; i < bandNames.length; i++) for (let j = i + 1; j < bandNames.length; j++) contrast[`${bandNames[i]}↔${bandNames[j]}`] = Math.round(jacc(bands.get(bandNames[i])!, bands.get(bandNames[j])!) * 100) / 100;
const fx: Record<string, number> = {};
for (const s of scores) for (const t of fxTok(s)) fx[t] = (fx[t] ?? 0) + 1;
const keys = new Set(scores.map((s) => (s.plan as unknown as { key?: number }).key ?? 0));
const res = {
  preset, seed: Number(seedArg), genre: genre || "(default)", bars: scores.length, minutes: Math.round(scores[scores.length - 1].plan.minute * 10) / 10,
  bpm: [Math.min(...scores.map((s) => s.plan.bpm)), Math.max(...scores.map((s) => s.plan.bpm))],
  longestIdenticalLoop: longestLoop(scores.map(fpFull)),
  longestIdenticalLoopCore: longestLoop(scores.map(fpCore)),
  distinctBars: new Set(scores.map(fpFull)).size,
  distinctBarsCore: new Set(scores.map(fpCore)).size,
  phrases: groups.length,
  timbreNoveltyPerPhrase: mean(tn),
  newTimbresPerPhrase: mean(newT),
  timbreTokensTotal: seenT.size,
  melodicPhraseShare: Math.round((melPhrases / groups.length) * 100) / 100,
  motifNoveltyPerPhrase: mean(mn),
  distinctMelodicCells: new Set(groups.flatMap((g) => [...melCells(g)])).size,
  distinctChords: chords.size,
  bassRootPitchClasses: roots.size,
  keys: keys.size,
  levelBandContrast: contrast,
  fxBars: fx,
};
console.log(JSON.stringify(res, null, 1));
if (out) writeFileSync(out, JSON.stringify(res, null, 1));
