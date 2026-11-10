// A simulated night (no audio, offline): for the empty report page ("Beispiel-Nacht") and tests.
// Clearly labelled as simulation in the record (mode "sim").
import { SetRunner } from "../set.ts";
import { presetById } from "../curve.ts";
import { rowFrom, type PartyRecord } from "./model.ts";
import { newPartyId } from "./recorder.ts";
export function simulateNight(preset = "1h", seed = 7, start = Date.now() - presetById(preset).minutes * 60000, n = 12): PartyRecord {
  const run = new SetRunner({ preset, seed, crowd: "sim", n });
  const bars = [];
  while (!run.finished) {
    const p = run.next().plan;
    bars.push(rowFrom(p, start + p.time * 1000, { U: p.section === "build" ? 0.55 : 0, pu: p.section === "build" && p.buildBlock > 0 }));
  }
  return {
    v: 1,
    id: newPartyId(),
    startedAt: start,
    updatedAt: start + (bars.at(-1)?.t ?? 0) * 1000,
    preset,
    presetLabel: presetById(preset).label,
    mode: "sim",
    seed,
    joinedMax: n,
    bars,
    events: run.director.events.filter((e) => e.kind !== "level"),
    finished: true,
  };
}
