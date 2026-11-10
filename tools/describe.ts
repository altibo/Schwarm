// Per-section description of a set, derived from the scheduled score (not from listening).
// Usage: node tools/describe.ts <preset> <seed> <genre> <out.md>
import { SetRunner } from "../src/set.ts";
import { keyName } from "../src/director.ts";
import { HH, BASS } from "../src/pack/hardhouse.ts";
import { PACK } from "../src/pack/techno.ts";
import { writeFileSync } from "node:fs";
const [preset = "10m", seedArg = "2026", genre = "hardhouse", out = ""] = process.argv.slice(2);
const run = new SetRunner({ preset, seed: Number(seedArg), crowd: "sim", genre: genre as "hardhouse" | "techno" });
type Sc = ReturnType<SetRunner["next"]>;
const all: Sc[] = [];
while (!run.finished) all.push(run.next());
const NAME: Record<string, string> = {
  hkick: "Kick (hart, angezerrt)", kick: "Kick", hbass: "Offbeat-Sub", donk: "Donk-Bass", roll: "Rolling-Bass", hoover: "Hoover", reese: "Reese",
  rstab: "Rave-Stabs", chop: "Vocal-Chops (synthetisch)", pluck: "Pluck", pad: "Pads/Akkorde", atmos: "Atmo", clapx: "Claps", clap: "Claps",
  ride: "Ride", openhat: "Open Hats", snare: "Snares", revcrash: "Reverse-Crash", zap: "Zap", riser: "Riser", crash: "Crash", impact: "Impact",
  sub: "Sub-Bass", fm: "FM-Bass", saw: "Säge-Bass", acid: "Acid", stab: "Dub-Stabs", lead: "Hymne (Lead)", tom: "Toms", rim: "Rim", conga: "Conga", shaker: "Shaker", clave: "Clave",
};
const band = (s: Sc) => (s.plan.section !== "groove" ? s.plan.section : s.plan.level <= 3 ? "low" : s.plan.level <= 6 ? "mid" : "peak");
const segs: Sc[][] = [];
for (const s of all) {
  const prev = segs[segs.length - 1]?.[0];
  if (!prev || band(prev) !== band(s) || prev.plan.key !== s.plan.key || (s.plan.drop && segs[segs.length - 1].length > 1)) segs.push([]);
  segs[segs.length - 1].push(s);
}
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const lines: string[] = [`# SCHWARM ${genre === "hardhouse" ? "Hard House" : "Techno"} · ${preset} · Seed ${seedArg}`, "", "Aus der geplanten Partitur abgeleitet (was die Engine spielt), nicht aus dem Hören.", ""];
for (const g of segs) {
  const p0 = g[0].plan, p1 = g[g.length - 1].plan;
  const t1 = p1.time + 240 / p1.bpm;
  const lv = [...new Set(g.map((s) => s.plan.level))];
  const sounds = new Map<string, number>();
  for (const s of g) for (const e of s.events) {
    const n = NAME[e.voice === "drum" ? (e.sample ?? "") : e.voice] ?? NAME[e.layer];
    if (n) sounds.set(n, (sounds.get(n) ?? 0) + 1);
  }
  const hookVoices = [...new Set(g.flatMap((s) => s.events.filter((e) => e.layer === "hook" || e.layer === "lead").map((e) => NAME[e.voice] ?? e.voice)))];
  const fx: string[] = [];
  const cnt = (f: (s: Sc) => boolean) => g.filter(f).length;
  const st = cnt((s) => !!s.auto.stutter?.length), tp = cnt((s) => !!s.auto.tape), cr = cnt((s) => !!s.auto.crush), th = cnt((s) => (s.auto.throwFb ?? 0.42) > 0.5), wa = cnt((s) => (s.auto.wash ?? 0) > 0), gp = cnt((s) => s.auto.gapAt >= 0);
  if (st) fx.push(`Stutter ×${st}`);
  if (tp) fx.push(`Tape-Stop ×${tp}`);
  if (cr) fx.push(`Crush ×${cr}`);
  if (th) fx.push(`Delay-Throws ×${th}`);
  if (wa) fx.push(`Hall-Wash ×${wa}`);
  if (gp) fx.push(`Gap (Stille auf Schlag 4) ×${gp}`);
  const progOf = (p: Sc["plan"]) => {
    const v = p.variation;
    return genre === "hardhouse" ? (p.section === "breakdown" ? HH.breakdownProgressions[(v.progression + p.chapter) % HH.breakdownProgressions.length] : HH.progressions[(v.progression + p.chapter) % HH.progressions.length]).name : PACK.progressions[v.progression].name;
  };
  const prog = [...new Set(g.map((s) => progOf(s.plan)))].join(" / ");
  const basses = genre === "hardhouse" ? [...new Set(g.filter((s) => s.plan.section === "groove").map((s) => BASS[HH.levels[s.plan.level - 1].bassPool[s.plan.variation.bass % HH.levels[s.plan.level - 1].bassPool.length]]))] : [];
  const what = p0.section === "breakdown" ? "Breakdown" : p0.section === "build" ? "Build-up" : p0.drop ? `Drop (${p0.drop}) → ${p0.phaseName === "Drop" ? "Groove" : p0.phaseName}` : p0.phaseName;
  const top = [...sounds.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 12);
  lines.push(`## ${mmss(p0.time)}–${mmss(t1)} · ${what} · Stufe ${Math.min(...lv)}${lv.length > 1 ? `–${Math.max(...lv)}` : ""} · ${keyName(p0.key)} · ${Math.round(p0.bpm)}${p1.bpm !== p0.bpm ? `–${Math.round(p1.bpm)}` : ""} BPM`);
  lines.push(`- Akkorde: ${prog}${basses.length ? ` · Bass: ${basses.join(", ")}` : ""}`);
  if (hookVoices.length) lines.push(`- Hook/Motiv auf: ${hookVoices.join(" ↔ ")}`);
  lines.push(`- Klänge: ${top.join(", ")}`);
  if (fx.length) lines.push(`- Effekte: ${fx.join(", ")}`);
  lines.push("");
}
const md = lines.join("\n");
if (out) writeFileSync(out, md);
console.log(md);
