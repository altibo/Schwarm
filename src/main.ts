import "./style.css";
import { LiveEngine } from "./live.ts";
import { PRESETS, presetById } from "./curve.ts";
import { sliderToN, nToSlider, unlockRule, formatN } from "./crowd.ts";
import { drawCurve, type CurvePoint } from "./ui/curve-view.ts";
import { levelHue, reducedMotion } from "./ui/theme.ts";
import { registerSW } from "./sw-register.ts";
import type { Score } from "./arranger.ts";
import { Party } from "./party.ts";
import { drawQr } from "./ui/qr.ts";
import { holdButton } from "./ui/hold.ts";
import { askMotion, onMotion } from "./ui/motion.ts";
import { now } from "./net/clock.ts";
import type { CrowdMode } from "./set.ts";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let presetId = "1h";
let mode: CrowdMode = "manual";
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
  if (mode !== "live") $("rule").textContent = `Drop-Freigabe · ${unlockRule(n).text}`;
}
for (const id of ["energy", "sync", "n"]) $(id).addEventListener("input", readSliders);
$<HTMLInputElement>("n").value = String(nToSlider(12));
function setMode(m: CrowdMode) {
  mode = m;
  engine.runner.mode = m;
  $("modeManual").setAttribute("aria-pressed", String(m === "manual"));
  $("modeSim").setAttribute("aria-pressed", String(m === "sim"));
  $("modeLive").setAttribute("aria-pressed", String(m === "live"));
  for (const id of ["energy", "sync"]) $<HTMLInputElement>(id).disabled = m === "sim";
  document.body.classList.toggle("live", m === "live");
  $("tag").textContent = m === "live" ? "Phase 1 · Live-Party (Test)" : m === "sim" ? "Phase 1 · Crowd simuliert" : "Phase 1 · Crowd per Regler";
  if (m === "live") void ensureParty();
  else readSliders();
}
$("modeManual").onclick = () => setMode("manual");
$("modeSim").onclick = () => setMode("sim");
$("modeLive").onclick = () => setMode("live");
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
    if (party) party.presetId = presetId;
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
    if (!party) flashUntil = performance.now() + 450;
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
  if (party && !$("tv").hidden) renderTv();
  // Heard drop (wall clock incl. output latency): the TV / master screen flashes on the one.
  if (party) {
    const t = now();
    for (const f of party.flashes) if (t >= f && t < f + 60 && flashUntil < performance.now()) flashUntil = performance.now() + 450;
  }
  const flash = !reduce && performance.now() < flashUntil ? 1 : 0;
  flashEl.style.opacity = reduce ? "0" : String(Math.max(0, (flashUntil - performance.now()) / 450) * 0.85);
  root.style.setProperty("--pulse", pulse.toFixed(3));
  root.style.setProperty("--flash", String(flash));
  drawCurve($<HTMLCanvasElement>("curve"), presetById(presetId), hist, engine.position);
  requestAnimationFrame(frame);
}
// --- Party (live crowd) -------------------------------------------------------------------
const params = new URLSearchParams(location.search);
const flashEl = $("flash");
let party: Party | null = null;
async function ensureParty(fresh = false) {
  if (party && !fresh) return party;
  party?.close();
  const p = new Party(engine, params.get("net") ?? "auto", fresh);
  party = p;
  p.presetId = presetId;
  engine.onSchedule = (s, heard) => p.onScheduled(s, heard);
  p.onChange = () => renderParty();
  const url = p.hub.joinUrl();
  $("code").textContent = `${p.hub.code.slice(0, 3)} ${p.hub.code.slice(3)}`;
  $("tvCode").textContent = $("code").textContent;
  $("guestHost").textContent = new URL("guest.html", location.href).host + new URL("guest.html", location.href).pathname;
  openParty();
  drawQr($<HTMLCanvasElement>("qr"), url);
  drawQr($<HTMLCanvasElement>("tvQr"), url);
  renderParty();
  await p.start();
  renderParty();
  return p;
}
function renderParty() {
  const p = party;
  if (!p) return;
  const c = p.crowd;
  const joined = p.agg.joined;
  $("lsN").textContent = String(c.n);
  $("lsJoined").textContent = `${joined} verbunden${p.selfOn ? " (inkl. dir)" : ""}`;
  $("lsVals").textContent = c.n
    ? `Energie ${fmt(c.energy)} · ${c.n === 1 ? "Taktgefühl" : "Gleichtakt S"} ${Math.round(c.sync * 100)} % · Beteiligung ${Math.round(c.participation * 100)} %`
    : "Niemand zählt gerade – Drop kommt nach Plan";
  const up = p.hub.link.upNames;
  $("lsNet").textContent = up.length ? `Verbunden über ${up.join(", ")} · Ende-zu-Ende-verschlüsselt` : p.started ? "Keine Verbindung – Musik läuft weiter nach Kurve" : "Verbindung wird aufgebaut …";
  $("pGuests").innerHTML = `<b>${joined}</b> verbunden · ${c.n} zählen`;
  $("pNets").innerHTML = p.hub.link.all.map((t) => `<li class="${t.up ? "ok" : "off"}">${t.up ? "●" : "○"} ${t.name}</li>`).join("");
  if (mode === "live") $("rule").textContent = c.n ? `Drop-Freigabe · ${unlockRule(c.n).text} · live: zusätzlich Rayleigh p < 5 % und Median Rᵢ ≥ 0,5` : "Drop-Freigabe · niemand zählt – der Drop kommt nach Plan (Rettungs-Drop)";
  $("tvN").textContent = c.n === 1 ? "Solo – 1 tanzt" : `${c.n} tanzen mit`;
  $("latTxt").textContent = `Lautsprecher-Versatz: ${Math.round(engine.latencyMs)} ms`;
}
function openParty() {
  $("party").hidden = false;
}
$("openParty").onclick = () => void ensureParty().then(openParty);
$("closeParty").onclick = () => ($("party").hidden = true);
$("newParty").onclick = () => void ensureParty(true);
const openTv = () => {
  $("party").hidden = true;
  $("tv").hidden = false;
  document.documentElement.requestFullscreen?.().catch(() => {});
};
$("openTv").onclick = openTv;
$("pTv").onclick = openTv;
$("tvExit").onclick = () => {
  $("tv").hidden = true;
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
};
// "Ich tanze mit": the master's own phone/laptop sensor counts as one dancer; controls locked.
let motionHooked = false;
$("selfDance").onclick = async () => {
  const p = await ensureParty();
  $("party").hidden = true;
  if (p.selfOn) return;
  const perm = await askMotion();
  if (perm === "denied" || perm === "unsupported") {
    $("event").textContent = "Kein Bewegungssensor freigegeben – der Master kann so nicht mittanzen.";
    return;
  }
  if (!motionHooked) {
    motionHooked = true;
    const ok = await onMotion((s) => p.selfOn && p.selfFeat.push(s));
    if (!ok) {
      motionHooked = false;
      $("event").textContent = "Dieses Gerät liefert keine Bewegungsdaten (Laptop?). Mittanzen geht nur mit Handy/Tablet.";
      return;
    }
  }
  p.setSelf(true);
  $("selfDance").setAttribute("aria-pressed", "true");
  $("lock").hidden = false;
};
holdButton($("unlock"), 3000, () => {
  party?.setSelf(false);
  $("selfDance").setAttribute("aria-pressed", "false");
  $("lock").hidden = true;
});
$("lockStop").onclick = () => {
  engine.stop();
  $("play").textContent = "▶ Play";
};
// Speaker latency: tap 8 beats along with the music (concept §6).
let taps: number[] = [];
$("tap").onclick = () => {
  if (!engine.running || !engine.current || !engine.ctx) {
    $("latTxt").textContent = "Erst Play drücken, dann 8× im Takt tippen.";
    return;
  }
  taps.push(now());
  $("tap").textContent = taps.length < 8 ? `Weiter tippen … ${taps.length}/8` : "Mitklopfen (8×)";
  if (taps.length < 8) return;
  const ctx = engine.ctx;
  const beatMs = 60000 / engine.current.plan.bpm;
  const cal = engine.latencyMs;
  // Heard beat grid without the current correction, then the median distance of the taps.
  const ref = engine.ctxToWall(ctx.currentTime) - cal - (engine.position - engine.current.plan.time) * 1000;
  const offs = taps.map((t) => {
    const d = (((t - ref) % beatMs) + beatMs) % beatMs;
    return d > beatMs / 2 ? d - beatMs : d;
  });
  offs.sort((a, b) => a - b);
  const med = (offs[3] + offs[4]) / 2;
  engine.latencyMs = Math.round(Math.max(-150, Math.min(400, med)));
  localStorage.setItem("schwarm.latency", String(engine.latencyMs));
  taps = [];
  renderParty();
};
readSliders();
setMode(params.get("crowd") === "live" ? "live" : "manual");
requestAnimationFrame(frame);
registerSW();
function renderTv() {
  const p = party!;
  const cur = engine.current?.plan;
  $("tvPhase").textContent = cur ? cur.phaseName : "Bereit";
  $("tvUp").hidden = !p.phonesUp;
  const ready = p.crowd.n ? Math.min(1, cur?.readiness ?? 0) : 0;
  $("tvReady").style.width = `${Math.round(ready * 100)}%`;
  $("tvSub").textContent = p.crowd.n ? (ready >= 1 ? "Drop freigeschaltet!" : "Drop-Bereitschaft") : "Drop kommt nach Plan";
}
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
    party: party
      ? { sid: party.hub.sid, code: party.hub.code, url: party.hub.joinUrl(), crowd: party.crowd, latest: party.latest, joined: party.agg.joined, nets: party.hub.link.upNames, msgsIn: party.hub.msgsIn, flashes: party.flashes, lm: party.lightMoment, phonesUp: party.phonesUp }
      : null,
  }),
  party: () => party,
};
