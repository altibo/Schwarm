import "./style.css";
import "./blindtest.css";
import { LiveEngine } from "./live.ts";
import { BLIND_TEST_SEED } from "./set.ts";
import { PACK } from "./pack/techno.ts";
import { registerSW } from "./sw-register.ts";
import { type BlindResult, RATING_EVERY_SEC, TEST_SECONDS, toCsv, evaluateGate, isResult, minutesToBoredom, meanRating } from "./gate.ts";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const KEY = "schwarm.blindtest.results";
const CUR = "schwarm.blindtest.current";
// Test hook for automated checks only: ?zeitraffer=N speeds up the playlist timer N×.
const speed = Math.max(1, Number(new URLSearchParams(location.search).get("zeitraffer")) || 1);
let mode: BlindResult["mode"] = "schwarm";
let playback = "Kopfhörer";
let engine: LiveEngine | null = null;
let run: BlindResult | null = null;
let t0 = 0;
let pendingDue: number | null = null;
let timer = 0;
const load = (): BlindResult[] => {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown[]).filter(isResult);
  } catch {
    return [];
  }
};
const save = (rs: BlindResult[]) => localStorage.setItem(KEY, JSON.stringify(rs));
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
function seg(id: string, set: (v: string) => void) {
  const box = $(id);
  box.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      if (run) return;
      box.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      set(b.dataset.v!);
    }),
  );
}
seg("playback", (v) => (playback = v));
seg("mode", (v) => {
  mode = v as BlindResult["mode"];
  $("plField").hidden = mode !== "playlist";
  $("modeHint").textContent =
    mode === "playlist"
      ? "Spiel deine kuratierte Playlist in deiner eigenen App ab und starte hier gleichzeitig den Timer. Bewertet wird genau wie bei Set A."
      : "Set A ist für alle Hörer gleich. Die App spielt es selbst ab. Bitte Ton laut genug stellen und den Bildschirm anlassen.";
});
if (speed > 1) $("modeHint").insertAdjacentHTML("afterend", `<p class="hint warn">Zeitraffer ${speed}× aktiv (nur für automatische Tests).</p>`);
const elapsed = () => (run ? (run.mode === "schwarm" && engine ? engine.position : ((performance.now() - t0) / 1000) * speed) : 0);
const rateBtns = $("rateBtns");
for (let i = 1; i <= 10; i++) {
  const b = document.createElement("button");
  b.className = "btn";
  b.textContent = String(i);
  b.onclick = () => rate(i);
  rateBtns.append(b);
}
function rate(v: number) {
  if (!run || pendingDue === null) return;
  run.ratings.push({ due: pendingDue, t: Math.round(elapsed() * 10) / 10, value: v });
  const wasFinal = pendingDue >= TEST_SECONDS;
  pendingDue = null;
  $("rate").hidden = true;
  persist();
  if (wasFinal) finish(true);
}
function persist() {
  if (run) {
    run.durationSec = Math.round(elapsed() * 10) / 10;
    localStorage.setItem(CUR, JSON.stringify(run));
  }
}
async function start() {
  const listener = $<HTMLInputElement>("listener").value.trim() || "anonym";
  run = {
    schema: "schwarm-blindtest/1",
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    listener,
    playback,
    mode,
    pack: mode === "schwarm" ? PACK.id : null,
    preset: mode === "schwarm" ? "1h" : null,
    seed: mode === "schwarm" ? BLIND_TEST_SEED : null,
    playlistName: mode === "playlist" ? $<HTMLInputElement>("playlist").value.trim() || "Playlist" : null,
    startedAt: new Date().toISOString(),
    durationSec: 0,
    plannedSec: TEST_SECONDS,
    finished: false,
    bored: [],
    ratings: [],
    userAgent: navigator.userAgent,
  };
  $("setup").classList.add("locked");
  $("start").textContent = "■ Test beenden";
  $<HTMLButtonElement>("bored").disabled = false;
  $("boredInfo").textContent = "Noch nicht getippt.";
  if (mode === "schwarm") {
    engine = new LiveEngine({ preset: "1h", seed: BLIND_TEST_SEED, crowd: "sim" });
    engine.onEnd = () => {
      if (run && pendingDue === null) ask(TEST_SECONDS);
    };
    await engine.start();
  } else t0 = performance.now();
  timer = window.setInterval(tick, 250);
}
function ask(due: number) {
  pendingDue = due;
  $("rateQ").textContent = due >= TEST_SECONDS ? "Letzte Frage: Wie hat dir die Musik insgesamt gefallen? (1–10)" : `Nach ${due / 60} Minuten: Wie gefällt dir die Musik gerade? (1 = gar nicht, 10 = sehr)`;
  $("rate").hidden = false;
}
function tick() {
  if (!run) return;
  const t = elapsed();
  $("clock").textContent = mmss(Math.min(t, TEST_SECONDS));
  const due = Math.floor(Math.min(t, TEST_SECONDS) / RATING_EVERY_SEC) * RATING_EVERY_SEC;
  const answered = new Set(run.ratings.map((r) => r.due));
  if (pendingDue === null && due >= RATING_EVERY_SEC && !answered.has(due)) ask(due);
  if (Math.floor(t) % 10 === 0) persist();
}
function finish(complete: boolean) {
  if (!run) return;
  window.clearInterval(timer);
  engine?.stop();
  run.durationSec = Math.round(Math.min(elapsed(), TEST_SECONDS) * 10) / 10;
  run.finished = complete || run.durationSec >= TEST_SECONDS - 1;
  const all = load();
  all.push(run);
  save(all);
  localStorage.removeItem(CUR);
  run = null;
  engine = null;
  pendingDue = null;
  $("rate").hidden = true;
  $("setup").classList.remove("locked");
  $("start").textContent = "▶ Test starten";
  $<HTMLButtonElement>("bored").disabled = true;
  renderList();
}
$("start").onclick = () => {
  if (run) {
    if (confirm("Test jetzt beenden? Das Ergebnis wird gespeichert.")) finish(false);
  } else void start();
};
$("bored").onclick = () => {
  if (!run) return;
  const t = Math.round(elapsed() * 10) / 10;
  const cur = engine?.current?.plan;
  // Logged for the analysis only; the listener does not see what was playing.
  run.bored.push({ t, bar: cur?.index, level: cur?.level, phase: cur?.phaseName });
  $("boredInfo").textContent = `Getippt bei ${mmss(t)} (${run.bored.length}×). Du kannst weiterhören.`;
  persist();
};
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
$("exportJson").onclick = () => download(`schwarm-blindtest-${stamp()}.json`, JSON.stringify(load(), null, 1), "application/json");
$("exportCsv").onclick = () => download(`schwarm-blindtest-${stamp()}.csv`, toCsv(load()), "text/csv");
function renderList() {
  const rs = load();
  const box = $("list");
  box.replaceChildren();
  if (!rs.length) box.textContent = "Noch keine Ergebnisse.";
  for (const r of rs.slice(-12).reverse()) {
    const d = document.createElement("div");
    d.className = "item";
    const m = meanRating(r);
    d.textContent = `${r.listener} · ${r.mode === "schwarm" ? "Set A" : r.playlistName} · ${mmss(r.durationSec)} · Langeweile: ${r.bored.length ? mmss(r.bored[0].t) : "nie"} · Ø Note ${Number.isFinite(m) ? m.toFixed(1) : "–"}${r.finished ? "" : " · abgebrochen"}`;
    box.append(d);
  }
}
$<HTMLInputElement>("files").onchange = async (ev) => {
  const files = [...((ev.target as HTMLInputElement).files ?? [])];
  const results: BlindResult[] = [];
  for (const f of files) {
    try {
      const data = JSON.parse(await f.text()) as unknown;
      for (const x of Array.isArray(data) ? data : [data]) if (isResult(x)) results.push(x);
    } catch {
      /* skip invalid file */
    }
  }
  const uniq = [...new Map(results.map((r) => [r.id, r])).values()];
  const g = evaluateGate(uniq);
  const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "–");
  $("gate").textContent = [
    `Ergebnisse: ${uniq.length}`,
    `Set A:    ${g.schwarm.listeners} Hörer · Median bis Langeweile ${fmt(g.schwarm.medianBoredomMin)} min · Ø Note ${fmt(g.schwarm.meanRating)}`,
    `Playlist: ${g.playlist.listeners} Hörer · Median bis Langeweile ${fmt(g.playlist.medianBoredomMin)} min · Ø Note ${fmt(g.playlist.meanRating)}`,
    `Urteil: ${g.verdict.toUpperCase()}`,
    ...g.reasons,
  ].join("\n");
};
// Recover an interrupted run (e.g. the tab was closed) into the result list.
const cur = localStorage.getItem(CUR);
if (cur) {
  try {
    const r = JSON.parse(cur) as unknown;
    if (isResult(r)) save([...load(), r]);
  } catch {
    /* ignore */
  }
  localStorage.removeItem(CUR);
}
renderList();
registerSW();
(window as unknown as { __blindtest: unknown }).__blindtest = { state: () => ({ run, pendingDue, elapsed: elapsed(), results: load() }), minutesToBoredom };
