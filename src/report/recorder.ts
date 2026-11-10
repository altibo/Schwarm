// Records every heard bar of the running set and saves it locally (throttled, plus on stop /
// page hide). A master reload continues the same record (see resume.ts).
import type { Score } from "../arranger.ts";
import type { SetRunner } from "../set.ts";
import { presetById } from "../curve.ts";
import { rowFrom, type PartyRecord } from "./model.ts";
import { putParty } from "./store.ts";
export const newPartyId = () => `p-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
export class Recorder {
  rec: PartyRecord;
  private unsaved = 0;
  private saving: Promise<unknown> = Promise.resolve();
  /** Saves are skipped (e.g. no IndexedDB); the report then says so. */
  failed = false;
  constructor(runner: SetRunner, presetId: string, existing?: PartyRecord, id?: string) {
    this.rec = existing ?? {
      v: 1,
      id: id ?? newPartyId(),
      startedAt: Date.now(),
      updatedAt: Date.now(),
      preset: presetId,
      presetLabel: presetById(presetId).label,
      mode: runner.mode,
      seed: runner.director.seed,
      joinedMax: 0,
      bars: [],
      events: [],
      finished: false,
    };
    this.runner = runner;
  }
  private runner: SetRunner;
  add(s: Score, extra: { U?: number; pu?: boolean; joined?: number } = {}) {
    const p = s.plan;
    const last = this.rec.bars.at(-1);
    if (last && p.index <= last.i) return;
    if (!this.rec.bars.length) this.rec.startedAt = Date.now();
    this.rec.bars.push(rowFrom(p, Date.now(), extra));
    // "Live" if any bar was measured live; the mode of the night may change while it runs.
    if (this.runner.mode === "live") this.rec.mode = "live";
    else if (this.rec.mode !== "live") this.rec.mode = this.runner.mode;
    this.rec.joinedMax = Math.max(this.rec.joinedMax, extra.joined ?? 0, p.crowd.n);
    this.rec.events = this.runner.director.events.filter((e) => e.kind !== "level");
    if (++this.unsaved >= 8) void this.save();
  }
  save(finished = false) {
    if (finished) this.rec.finished = true;
    if (!this.rec.bars.length) return Promise.resolve();
    this.unsaved = 0;
    this.rec.updatedAt = Date.now();
    const snap = JSON.parse(JSON.stringify(this.rec)) as PartyRecord;
    this.saving = this.saving.then(() => putParty(snap)).catch(() => (this.failed = true));
    return this.saving;
  }
}
