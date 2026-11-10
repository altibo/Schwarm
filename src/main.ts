import "./style.css";
import { LiveEngine } from "./live.ts";
import { PRESETS, presetById } from "./curve.ts";
import { sliderToN, nToSlider, unlockRule, formatN } from "./crowd.ts";
import { drawCurve, type CurvePoint } from "./ui/curve-view.ts";
import { levelHue, reducedMotion } from "./ui/theme.ts";
import { registerSW } from "./sw-register.ts";
import type { Score } from "./arranger.ts";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let presetId = "1h";
let mode: "manual" | "sim" = "manual";
const engine = new LiveEngine({ preset: presetId, seed: Date.now() % 100000, crowd: mode });
const hist: CurvePoint[] = [];
let flashUntil = 0;
const root = document.documentElement;
const fmt = (x: number, d = 1) => x.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
function readSliders() {
  const e = Number($<HTMLInputElement>("energy").value);
  const s = Number($<HTMLInputElement>("sync").value);
  const n = sliderToN(Number($<HTMLInputElement>("n").value));
  engine.runner.manual = { energy: e, sync: s, participation: 0.8, n };
  engine.runner.sim.n = n;
  $("eOut").textContent = fmt(e);
  $("sOut").textContent = `${Math.round(s * 100)} %`;
  $("nOut").textContent = formatN(n);
  $("rule").textContent = `Drop-Freigabe · ${unlockRule(n).text}`;
}
for (const id of ["energy", "sync", "n"]) $(id).addEventListener("input", readSliders);
$<HTMLInputElement>("n").value = String(nToSlider(12));
function setMode(m: "manual" | "sim") {
  mode = m;
  engine.runner.mode = m;
  $("modeManual").setAttribute("aria-pressed", String(m === "manual"));
  $("modeSim").setAttribute("aria-pressed", String(m === "sim"));
  for (const id of ["energy", "sync"]) $<HTMLInputElement>(id).disabled = m === "sim";
}
$("modeManual").onclick = () => setMode("manual");
$("modeSim").onclick = () => setMode("sim");
const presetBox = $("presets");
for (const p of PRESETS) {
  const b = document.createElement("button");
  b.className = "btn small";
  b.textContent = p.label;
  b.dataset.preset = p.id;
  b.setAttribute("aria-pressed", String(p.id === presetId));
  b.onclick = () => {
    presetId = p.id;
    engine.reset({ preset: presetId, seed: Date.now() % 100000, crowd: mode });
    hist.length = 0;
    readSliders();
    setMode(mode);
    for (const x of presetBox.querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
    $("play").textContent = "▶ Play";
    $("phase").textContent = "Bereit";
  };
  presetBox.append(b);
}
$("play").onclick = async () => {
  if (engine.running) {
    engine.stop();
    $("play").textContent = "▶ Play";
  } else {
    $("play").textContent = "■ Stop";
    try {
      await engine.start();
    } catch (err) {
      $("event").textContent = `Audio-Fehler: ${(err as Error).message}`;
      $("play").textContent = "▶ Play";
    }
  }
};
$("drop").onclick = () => {
  engine.runner.director.forceDrop();
  $("drop").classList.add("queued");
};
engine.onBar = (s: Score) => {
  const p = s.plan;
  hist.push({ t: p.time, level: p.level, ist: p.crowd.energy, section: p.section, drop: p.drop });
  if (p.drop) {
    flashUntil = performance.now() + 450;
    $("drop").classList.remove("queued");
  }
  $("level").textContent = String(p.level);
  $("phase").textContent = p.phaseName;
  $("meta").textContent = `${fmt(p.bpm)} BPM · Phrase ${p.phraseIndex + 1} · Takt ${p.phraseBar + 1}/${p.section === "build" ? 8 : 16}`;
  $("ready").style.width = `${Math.round(p.readiness * 100)}%`;
  $("readyTxt").textContent = p.readiness >= 1 ? "frei" : `${Math.round(p.readiness * 100)} %`;
  $("fat").style.width = `${Math.min(100, Math.round(p.fatigue * 100))}%`;
  $("fatTxt").textContent = fmt(p.fatigue, 2);
  root.style.setProperty("--hue", String(levelHue(p.section === "breakdown" ? 1 : p.level)));
  const ev = engine.runner.director.events.filter((e) => e.time <= p.time && e.kind !== "level").at(-1);
  if (ev) $("event").textContent = `${fmtTime(ev.time)} · ${ev.detail}`;
  document.body.dataset.section = p.section;
  if (!p.dropQueued) $("drop").classList.remove("queued");
};
engine.onEnd = () => {
  $("play").textContent = "▶ Play";
  $("phase").textContent = "Set zu Ende";
};
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
function frame() {
  const reduce = reducedMotion();
  // One soft glow pulse per beat (≤ 2.3 Hz at 138 BPM, under the 3 Hz limit); none with reduced motion.
  const pulse = engine.running && !reduce ? Math.exp(-engine.beatPhase * 5) : 0;
  const flash = !reduce && performance.now() < flashUntil ? 1 : 0;
  root.style.setProperty("--pulse", pulse.toFixed(3));
  root.style.setProperty("--flash", String(flash));
  drawCurve($<HTMLCanvasElement>("curve"), presetById(presetId), hist, engine.position);
  requestAnimationFrame(frame);
}
readSliders();
setMode("manual");
requestAnimationFrame(frame);
registerSW();
// Test hook (Playwright): read-only engine state.
(window as unknown as { __schwarm: unknown }).__schwarm = {
  engine,
  state: () => ({
    running: engine.running,
    ctx: engine.ctx?.state,
    bars: engine.played.length,
    lateBars: engine.lateBars,
    voices: engine.mix?.voices ?? 0,
    current: engine.current?.plan ?? null,
    events: engine.runner.director.events,
  }),
};
