// Turn a recorded night (master) or a guest night into story-card content.
import type { CardData } from "./card.ts";
import { clock, dayLabel } from "./card.ts";
import type { PartyRecord } from "./model.ts";
import type { Report } from "./analyze.ts";
import { summarizeNight, type GuestNight } from "./guest-night.ts";
const fmt = (x: number, d = 1) => x.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
export function masterCard(rec: PartyRecord, rep: Report): CardData {
  const s = rep.summary;
  const mins = rep.minutes;
  const curve = mins.map((m) => m.ist);
  let peak: number | undefined;
  if (s.peak) peak = mins.findIndex((m) => m.m === Math.floor(s.peak!.t / 60));
  const total = Math.max(1, mins.length - 1);
  const drops = rep.drops.map((d) => Math.min(1, Math.floor(d.t / 60) / total));
  const live = rec.mode === "live";
  return {
    title: "Die Nacht",
    date: dayLabel(s.startedAt),
    hero: s.peak ? `Peak ${clock(s.peak.w)}` : `${clock(s.startedAt)}–${clock(s.endedAt)}`,
    heroSub: s.peak ? `${s.peak.label} · CEI ${Math.round(s.peak.cei)}` : "ohne Messung – Musik nach Plan",
    stats: [
      { big: String(s.drops), small: s.drops === 1 ? "Drop" : `Drops · ${s.unlocked} freigeschaltet` },
      { big: String(s.maxN), small: s.maxN === 1 ? "Tänzer (solo)" : "Tänzer gleichzeitig" },
      { big: `${Math.round(s.durationMin)}′`, small: "Minuten Musik" },
      { big: s.avgS === null ? "–" : `${Math.round(s.avgS * 100)} %`, small: "Ø Gleichtakt" },
    ],
    curve,
    soll: mins.map((m) => m.soll),
    peak: peak !== undefined && peak >= 0 ? peak : undefined,
    drops,
    level: Math.max(1, ...mins.map((m) => m.lvl)),
    footer: live ? "lokal erstellt · anonym · SCHWARM KI-DJ" : "Simulation – keine echten Messwerte · SCHWARM",
  };
}
export function guestCard(n: GuestNight): CardData {
  const s = summarizeNight(n);
  const unlocked = n.drops.filter((d) => d.type === "freigeschaltet").length;
  return {
    title: "Meine Nacht",
    date: dayLabel(n.start),
    hero: s.peakW ? `Peak ${clock(s.peakW)}` : `${clock(n.start)}–${clock(n.end)}`,
    heroSub: `${n.drops.length} ${n.drops.length === 1 ? "Drop" : "Drops"} erlebt${unlocked ? ` · ${unlocked} habt ihr freigeschaltet` : ""}`,
    stats: [
      { big: `${s.myMinutes}′`, small: "du hast mitgetanzt" },
      { big: s.mySync === null ? "–" : `${Math.round(s.mySync * 100)} %`, small: "deiner Takte im Takt" },
      { big: s.myEnergy === null ? "–" : fmt(s.myEnergy), small: "deine Ø Energie" },
      { big: String(n.maxN), small: n.maxN === 1 ? "Tänzer (solo)" : "im Schwarm (max.)" },
    ],
    curve: s.crowd,
    me: s.me,
    peak: s.peak,
    drops: n.drops.map((d) => Math.min(1, (d.w - n.start) / Math.max(1, n.end - n.start))),
    level: Math.max(1, Math.min(10, Math.round(Math.max(0, ...s.crowd.map((v) => v ?? 0))))),
    footer: "nur auf deinem Handy erstellt · anonym · SCHWARM",
  };
}
