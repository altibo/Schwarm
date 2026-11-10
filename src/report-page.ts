// "Nach der Nacht": list of past parties on this device, one report per party, story card,
// JSON/CSV export, delete. Everything local (IndexedDB), nothing uploaded.
import "./style.css";
import "./report.css";
import { listParties, getParty, deleteParty, putParty } from "./report/store.ts";
import { analyze, toCsv, type Report, type MoveInfo } from "./report/analyze.ts";
import { MODE_LABEL, rowCei, type PartyRecord } from "./report/model.ts";
import { drawChart } from "./report/charts.ts";
import { drawCard, shareCard, cardBlob, downloadBlob, clock, dayLabel } from "./report/card.ts";
import { masterCard } from "./report/card-data.ts";
import { simulateNight } from "./report/demo.ts";
import { registerSW } from "./sw-register.ts";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (x: number | null, d = 1) => (x === null ? "–" : x.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)} %`);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const DROP_LABEL: Record<string, string> = { freigeschaltet: "freigeschaltet", rettung: "Rettungs-Drop", erzwungen: "erzwungen" };
const DROP_COLOR: Record<string, string> = { freigeschaltet: "hsl(320, 100%, 70%)", rettung: "hsl(40, 100%, 60%)", erzwungen: "hsl(200, 100%, 70%)" };
let current: { rec: PartyRecord; rep: Report } | null = null;
async function showList() {
  current = null;
  $("detail").hidden = true;
  $("list").hidden = false;
  history.replaceState(null, "", location.pathname);
  let all: PartyRecord[] = [];
  try {
    all = await listParties();
  } catch (e) {
    $("lErr").textContent = `Speicher nicht verfügbar: ${(e as Error).message} (privater Modus?)`;
  }
  $("empty").hidden = all.length > 0;
  $("parties").innerHTML = "";
  for (const r of all) {
    const s = analyze(r).summary;
    const li = document.createElement("li");
    li.dataset.id = r.id;
    li.innerHTML = `<div class="pinfo"><b>${esc(dayLabel(s.startedAt))} · ${clock(s.startedAt)}–${clock(s.endedAt)}</b><span>${esc(r.presetLabel)} · ${esc(MODE_LABEL[r.mode])} · ${Math.round(s.durationMin)} min · ${s.drops} Drops · max. ${s.maxN} zählen${r.finished ? "" : " · abgebrochen"}</span></div>`;
    const open = document.createElement("button");
    open.className = "btn small";
    open.textContent = "Öffnen";
    open.onclick = () => void showDetail(r.id);
    li.append(open);
    $("parties").append(li);
  }
}
async function showDetail(id: string) {
  const rec = await getParty(id);
  if (!rec) return void showList();
  const rep = analyze(rec);
  current = { rec, rep };
  history.replaceState(null, "", `?id=${encodeURIComponent(id)}`);
  $("list").hidden = true;
  $("detail").hidden = false;
  $("del").textContent = "Diese Party löschen";
  delete $("del").dataset.armed;
  const s = rep.summary;
  $("dTitle").textContent = `${dayLabel(s.startedAt)}`;
  $("dSub").textContent = `${clock(s.startedAt)}–${clock(s.endedAt)} · ${rec.presetLabel} · ${MODE_LABEL[rec.mode]}${rec.finished ? "" : " · nicht zu Ende gespielt"}`;
  $("dMode").hidden = rec.mode === "live" && s.measuredShare > 0;
  $("dMode").textContent =
    rec.mode !== "live" ? "Diese Nacht lief mit simulierter bzw. per Regler gesetzter Crowd – die Kurven zeigen keine echten Messwerte." : "In dieser Nacht hat niemand gezählt – die Musik lief nach Plan, es gibt keine Messwerte.";
  const tiles: [string, string][] = [
    [`${Math.round(s.durationMin)} min`, "Musik"],
    [s.peak ? clock(s.peak.w) : "–", s.peak ? `Peak · CEI ${Math.round(s.peak.cei)}` : "Peak"],
    [String(s.drops), `Drops · ${s.unlocked} frei · ${s.rescue} Rettung · ${s.forced} erzwungen`],
    [String(s.breakdowns), "Breakdowns"],
    [String(s.maxN), `max. zählen · Ø ${fmt(s.avgN)}`],
    [pct(s.avgP), "Ø Beteiligung P"],
    [pct(s.avgS), "Ø Gleichtakt S"],
    [s.avgCei === null ? "–" : String(Math.round(s.avgCei)), "Ø CEI (0–100)"],
    [s.deviation === null ? "–" : fmt(s.deviation), "Ø Abstand Soll/Ist"],
    [pct(s.phonesUp), "Phones-up-Quote"],
    [pct(s.measuredShare), "Takte mit Messung"],
  ];
  $("dTiles").innerHTML = tiles.map(([b, t]) => `<div class="rtile"><b>${esc(b)}</b><span>${esc(t)}</span></div>`).join("");
  drawCharts();
  // Top moments.
  $("dTop").innerHTML = rep.top.length ? rep.top.map((m) => `<li><b>${clock(m.w)}</b> (Minute ${mmss(m.t)}) · ${esc(m.label)} · CEI ${Math.round(m.cei)}</li>`).join("") : "<li>Keine Messwerte – keine Top-Momente.</li>";
  // Drops.
  $("dDrops").innerHTML =
    `<tr><th>Uhrzeit</th><th>Set</th><th>Art</th><th>Wartezeit</th><th>CEI davor</th><th>CEI danach</th></tr>` +
    (rep.drops.map((d) => `<tr><td>${clock(d.w)}</td><td>${mmss(d.t)}</td><td style="color:${DROP_COLOR[d.type]}">${DROP_LABEL[d.type]}</td><td>${d.waitBars} Takte Build-up</td><td>${fmt(d.ceiBefore, 0)}</td><td>${fmt(d.ceiAfter, 0)}</td></tr>`).join("") || `<tr><td colspan="6">Kein Drop.</td></tr>`);
  $("dBreaks").innerHTML =
    `<tr><th>Uhrzeit</th><th>Set</th><th>Länge</th><th>CEI davor</th><th>CEI danach</th></tr>` +
    (rep.breakdowns.map((b) => `<tr><td>${clock(b.w)}</td><td>${mmss(b.t)}</td><td>${b.bars} Takte</td><td>${fmt(b.ceiBefore, 0)}</td><td>${fmt(b.ceiAfter, 0)}</td></tr>`).join("") || `<tr><td colspan="5">Kein Breakdown.</td></tr>`);
  const mv = (m: MoveInfo) => `${clock(m.w)} · <b>${esc(m.label)}</b> · ${m.reward! >= 0 ? "+" : ""}${fmt(m.reward)} CEI über Erwartung`;
  $("dTopMoves").innerHTML = rep.topMoves.map((m) => `<li>${mv(m)}</li>`).join("") || "<li>keiner</li>";
  $("dFlopMoves").innerHTML = rep.flopMoves.map((m) => `<li>${mv(m)}</li>`).join("") || "<li>keiner</li>";
  const vcls = (v: string) => (v === "gewirkt" ? "v-gewirkt" : v === "eher nicht" ? "v-eher" : v === "überlagert" ? "v-ueber" : v === "neutral" ? "v-neutral" : "v-nicht");
  $("dMoves").innerHTML =
    `<tr><th>Uhrzeit</th><th>Move</th><th>CEI davor</th><th>danach</th><th>Δ</th><th>erwartet</th><th>Bewertung</th><th>Director live</th></tr>` +
    (rep.moves.map((m) => `<tr><td>${clock(m.w)}</td><td>${esc(m.label)}</td><td>${fmt(m.before, 0)}</td><td>${fmt(m.after, 0)}</td><td>${fmt(m.delta)}</td><td>${fmt(m.expected)}</td><td class="${vcls(m.verdict)}">${m.verdict}</td><td>${m.director ?? "–"}</td></tr>`).join("") || `<tr><td colspan="8">Keine Moves.</td></tr>`);
  // Story card.
  drawCard($<HTMLCanvasElement>("card"), masterCard(rec, rep));
  $<HTMLImageElement>("cardImg").src = $<HTMLCanvasElement>("card").toDataURL("image/png");
  $("dNote").textContent = `${rec.bars.length} Takte gespeichert · ID ${rec.id}`;
  document.documentElement.style.setProperty("--hue", String(215 + (Math.max(...rep.minutes.map((m) => m.lvl), 1) - 1) * 13.3));
}
function drawCharts() {
  if (!current) return;
  const { rec, rep } = current;
  const bars = rec.bars;
  const n = bars.length;
  const total = bars.at(-1)?.t ?? 0;
  const step = total > 3600 ? 1800 : total > 1200 ? 600 : 120;
  const xLabels: { at: number; text: string }[] = [];
  for (let t = 0; t <= total; t += step) {
    const k = bars.findIndex((b) => b.t >= t);
    if (k >= 0) xLabels.push({ at: k, text: clock(bars[k].w) });
  }
  const bands = [];
  for (let k = 0; k < n; k++) {
    if (bars[k].sec === "groove" || (k && bars[k - 1].sec === bars[k].sec)) continue;
    let e = k;
    while (e + 1 < n && bars[e + 1].sec === bars[k].sec) e++;
    bands.push({ from: k, to: e + 1, color: bars[k].sec === "breakdown" ? "rgba(90,140,255,0.18)" : "rgba(230,120,255,0.15)" });
  }
  const markers = rep.drops.map((d) => ({ at: bars.findIndex((b) => b.i === d.i), color: DROP_COLOR[d.type] }));
  drawChart($<HTMLCanvasElement>("cEnergy"), {
    n,
    min: 0,
    max: 10,
    ticks: [0, 2, 4, 6, 8, 10],
    xLabels,
    bands,
    markers,
    series: [
      { values: bars.map((b) => b.lvl), color: "hsla(285, 90%, 62%, 0.55)", width: 1.5, label: "Stufe" },
      { values: bars.map((b) => b.soll), color: "rgba(255,255,255,0.85)", width: 2, dash: [5, 4], label: "Soll" },
      { values: bars.map((b) => (b.n > 0 ? b.E : null)), color: "hsl(180, 90%, 60%)", width: 2.4, glow: true, label: "Ist" },
    ],
  });
  const maxN = Math.max(1, rep.summary.maxN);
  drawChart($<HTMLCanvasElement>("cCrowd"), {
    n,
    min: 0,
    max: 1,
    ticks: [0, 0.25, 0.5, 0.75, 1],
    tickFmt: (v) => `${Math.round(v * 100)}%`,
    xLabels,
    bands,
    markers,
    series: [
      { values: bars.map((b) => b.n / maxN), color: "rgba(255,255,255,0.55)", width: 1.5, label: "N" },
      { values: bars.map((b) => (b.n > 0 ? b.P : null)), color: "hsl(140, 80%, 55%)", width: 2, label: "P" },
      { values: bars.map((b) => (rowCei(b) === null ? null : b.S)), color: "hsl(300, 90%, 66%)", width: 2, glow: true, label: "S" },
    ],
  });
}
const fileBase = (r: PartyRecord) => `schwarm-${new Date(r.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, "-")}`;
$("back").onclick = () => void showList();
$("exJson").onclick = () => current && downloadBlob(new Blob([JSON.stringify({ ...current.rec, report: current.rep.summary }, null, 1)], { type: "application/json" }), `${fileBase(current.rec)}.json`);
$("exCsv").onclick = () => current && downloadBlob(new Blob([toCsv(current.rec)], { type: "text/csv;charset=utf-8" }), `${fileBase(current.rec)}.csv`);
$("share").onclick = async () => {
  if (!current) return;
  const how = await shareCard($<HTMLCanvasElement>("card"), `${fileBase(current.rec)}-karte.png`);
  $("dNote").textContent = how === "shared" ? "Geteilt." : how === "downloaded" ? "Teilen wird hier nicht unterstützt – PNG gespeichert." : "Abgebrochen.";
};
$("dlCard").onclick = async () => current && downloadBlob(await cardBlob($<HTMLCanvasElement>("card")), `${fileBase(current.rec)}-karte.png`);
$("del").onclick = async () => {
  if (!current) return;
  const b = $("del");
  if (!b.dataset.armed) {
    b.dataset.armed = "1";
    b.textContent = "Wirklich löschen? Nochmal tippen";
    return;
  }
  await deleteParty(current.rec.id);
  void showList();
};
$("demo").onclick = async () => {
  const r = simulateNight("1h", Date.now() % 1000);
  await putParty(r);
  void showDetail(r.id);
};
window.addEventListener("resize", () => drawCharts());
const id = new URLSearchParams(location.search).get("id");
void (id ? showDetail(id) : showList());
registerSW();
(window as unknown as { __report: unknown }).__report = { current: () => current, listParties };
