import { test } from "node:test";
import assert from "node:assert/strict";
import { SetRunner } from "../src/set.ts";
import { Director, KEY_SHIFTS } from "../src/director.ts";
import { presetById } from "../src/curve.ts";
import { fingerprint, type Score } from "../src/arranger.ts";
import { theme, mutate, chapterMotif, phraseMotif, response, chordNotes, bassRootOf, degSemis, foldKey } from "../src/music/motif.ts";
const set = (preset = "1h", seed = 2026, genre: "hardhouse" | "techno" = "hardhouse") => {
  const r = new SetRunner({ preset, seed, crowd: "sim", genre });
  const out: Score[] = [];
  while (!r.finished) out.push(r.next());
  return out;
};
const hh = set();
const voices = (s: Score) => new Set(s.events.map((e) => e.voice));
test("motif: deterministic theme, cumulative mutation, chapters develop the same theme", () => {
  assert.deepEqual(theme(7), theme(7));
  assert.notDeepEqual(theme(7).notes, theme(8).notes);
  const m = theme(7);
  const a = mutate(m, 3, 99), b = mutate(m, 4, 99);
  const key = (x: typeof a) => new Set(x.notes.map((n) => `${n.step}:${n.deg}`));
  const ka = key(a), kb = key(b);
  const diff = [...ka].filter((x) => !kb.has(x)).length + [...kb].filter((x) => !ka.has(x)).length;
  assert.ok(diff <= 4, `one more phrase = one more small edit (${diff})`);
  for (const c of [0, 1, 2, 3]) {
    const cm = chapterMotif(7, c);
    assert.ok(cm.notes.length >= 6 && cm.notes.every((n) => n.step >= 0 && n.step < 32));
  }
  assert.deepEqual(phraseMotif(7, 2, 3, true), chapterMotif(7, 2), "the hymn returns pure");
  const r = response(m, 0);
  assert.equal(r.notes[r.notes.length - 1].deg, 0, "the answer resolves to the tonic");
});
test("harmony: chords and bass in the chapter key, registers stay put", () => {
  for (const k of KEY_SHIFTS) {
    const n = chordNotes({ deg: 0 }, k, 53);
    assert.equal(((n[0] - 53 - foldKey(k)) % 12 + 12) % 12, 0);
    const pc = (x: number) => ((x % 12) + 12) % 12;
    assert.equal(pc(n[1] - n[0]), 3, "minor third");
    const v = chordNotes({ deg: 4, major: true }, k, 53);
    assert.equal(pc(v[1] - v[0]), 4, "major V");
    assert.ok(v.every((x) => x >= 41 && x <= 67), "close register");
    const b = bassRootOf({ deg: 5 }, k);
    assert.ok(b >= 22 && b <= 36, `bass ${b}`);
  }
  assert.equal(degSemis(7), 12);
});
test("key changes: breakdowns open a new chapter in a new key; several keys per hour", () => {
  const keys = new Set(hh.map((s) => s.plan.key));
  assert.ok(keys.size >= 3, `${keys.size} keys`);
  for (let i = 1; i < hh.length; i++) {
    if (hh[i].plan.key !== hh[i - 1].plan.key) {
      const p = hh[i].plan;
      assert.ok(p.section === "breakdown" ? p.sectionBar === 0 : p.phraseBar === 0, `key change on a section/phrase boundary (bar ${p.index})`);
    }
  }
});
test("energy levels sound different: warm-up minimal, peak with hoover hook + effects, breakdown pads without kick", () => {
  const low = hh.filter((s) => s.plan.section === "groove" && s.plan.level <= 2);
  const peak = hh.filter((s) => s.plan.section === "groove" && s.plan.level >= 8);
  const bd = hh.filter((s) => s.plan.section === "breakdown");
  const build = hh.filter((s) => s.plan.section === "build");
  assert.ok(low.length && peak.length && bd.length && build.length);
  assert.ok(low.every((s) => !voices(s).has("hoover") && !voices(s).has("reese")), "no hoover in the warm-up");
  assert.ok(peak.filter((s) => voices(s).has("hoover")).length > peak.length * 0.5, "the peak carries the hoover");
  assert.ok(peak.some((s) => s.auto.crush || s.auto.stutter || s.auto.tape), "effects at the peak");
  assert.ok(bd.every((s) => !voices(s).has("hkick")) && bd.filter((s) => voices(s).has("pad")).length >= bd.length / 4);
  assert.ok(build.every((s) => s.events.some((e) => e.layer === "fill")), "snare roll in every build bar");
});
test("bus effects stay inside the bar; stutter ≤ 7 repeats per window", () => {
  for (const s of [...hh, ...set("1h", 2026, "techno")]) {
    const a = s.auto;
    for (const w of a.stutter ?? []) {
      assert.ok(w.at >= 0 && w.at + w.len <= 16 && w.slice > 0);
      assert.ok(w.len / w.slice <= 8);
    }
    if (a.tape) assert.ok(a.tape.at + a.tape.len <= 16);
    if (a.crush) assert.ok(a.crush.at + a.crush.len <= 16 && a.crush.mix > 0 && a.crush.mix <= 1);
  }
});
test("anti-monotony: short exact loops, the hook changes every phrase", () => {
  const fp = hh.map((s) => fingerprint(s));
  let best = 0;
  for (const P of [1, 2, 4, 8]) {
    let run = 0;
    for (let i = P; i < fp.length; i++) {
      run = fp[i] === fp[i - P] ? run + 1 : 0;
      best = Math.max(best, run ? run + P : 0);
    }
  }
  assert.ok(best <= 12, `longest identical loop ${best} bars`);
  const hookOf = (p: number) => hh.filter((s) => s.plan.section === "groove" && s.plan.phraseIndex === p).flatMap((s) => s.events.filter((e) => e.layer === "hook").map((e) => `${s.plan.phraseBar}:${e.step}:${e.note}`)).join();
  const phrases = [...new Set(hh.filter((s) => s.plan.section === "groove").map((s) => s.plan.phraseIndex))];
  let same = 0;
  for (let i = 1; i < phrases.length; i++) if (hookOf(phrases[i]) && hookOf(phrases[i]) === hookOf(phrases[i - 1])) same++;
  assert.ok(same <= phrases.length * 0.1, `${same} of ${phrases.length} phrases repeat the previous hook`);
});
test("snapshot: genre and chapter survive a restore; old snapshots are Techno", () => {
  const d = new Director(presetById("1h"), 5, "hardhouse");
  for (let i = 0; i < 300; i++) d.step({ energy: 6, sync: 0.6, participation: 0.9, n: 10 });
  const snap = d.snapshot();
  const r = Director.restore(snap, presetById("1h"));
  assert.equal(r.genre, "hardhouse");
  assert.equal(r.chapter, d.chapter);
  const a = d.step({ energy: 6, sync: 0.6, participation: 0.9, n: 10 }), b = r.step({ energy: 6, sync: 0.6, participation: 0.9, n: 10 });
  assert.equal(a.key, b.key);
  assert.equal(a.bpm, b.bpm);
  const old = JSON.parse(JSON.stringify(snap));
  delete old.state.genre;
  assert.equal(Director.restore(old, presetById("1h")).genre, "techno");
});
