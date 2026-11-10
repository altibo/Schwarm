import { NightLog, saveNight, loadNights, deleteNight, summarizeNight, type GuestNight } from "./report/guest-night.ts";
import { drawCard, shareCard, cardBlob, downloadBlob, clock, dayLabel } from "./report/card.ts";
import { guestCard } from "./report/card-data.ts";
import "./style.css";
import "./guest.css";
import { sliderToN, nToSlider, formatN, readiness, unlockRule } from "./crowd.ts";
import { presetById } from "./curve.ts";
import { drawCurve, type CurvePoint } from "./ui/curve-view.ts";
import { levelHue, reducedMotion } from "./ui/theme.ts";
import { rng } from "./rng.ts";
import { registerSW } from "./sw-register.ts";
import { GuestCore } from "./guest-core.ts";
import { resolveCode } from "./net/session.ts";
import type { BarMsg } from "./net/session.ts";
import { normCode } from "./net/crypto.ts";
import { now } from "./net/clock.ts";
import { holdButton } from "./ui/hold.ts";
import { askMotion, onMotion, keepAwake } from "./ui/motion.ts";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const root = document.documentElement;
const BPM = 130;
const state = {
  n: 128, energy: 6.5, sync: 0.55, myEnergy: 7, myStab: 0.7, minute: 24, phase: "Aufbau", pocket: false,
  // live mode (fed by the master's bar messages + the own sensor)
  live: false, joined: 0, ready: 0, rule: "", mode: "", preset: "1h", lm: false, up: false, sensing: true, hasMe: false,
};
const liveHist: CurvePoint[] = [];
const fmt = (x: number, d = 1) => x.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
// --- particles -------------------------------------------------------------------------
const MAX_DOTS = 420;
const r = rng(77);
const dots = Array.from({ length: MAX_DOTS }, (_, i) => ({ a: (i * 2.399963) % (Math.PI * 2), off: r() * 2 - 1, ph: r(), sp: 0.6 + r() * 0.8, sz: 0.7 + r() * 0.6 }));
// N = 1: the crowd *is* me, so crowd energy/sync follow my own values.
const effE = () => (state.live ? state.energy : state.n <= 1 ? state.myEnergy : state.energy);
const effS = () => (state.live ? state.sync : state.n <= 1 ? state.myStab : state.sync);
/** Dots shown for N dancers: 1:1 up to 150, then logarithmic so 1000+ still reads as a swarm. */
export const dotsFor = (n: number) => (n <= 150 ? n : Math.min(MAX_DOTS, Math.round(150 + 110 * Math.log10(n / 150))));
let sprite: HTMLCanvasElement | null = null;
function glowSprite() {
  const s = document.createElement("canvas");
  s.width = s.height = 32;
  const g = s.getContext("2d")!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.65)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return s;
}
function fit(cv: HTMLCanvasElement) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const g = cv.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}
let rot = 0;
function drawSwarm(now: number, beat: number, motion: boolean) {
  const { g, w, h } = fit($<HTMLCanvasElement>("swarm"));
  g.clearRect(0, 0, w, h);
  sprite ??= glowSprite();
  const cx = w / 2, cy = h / 2;
  const n = state.n;
  const count = dotsFor(n);
  const R = Math.min(w, h) * (0.24 + 0.14 * Math.min(1, Math.log10(Math.max(1, n)) / 3.3));
  const hue = levelHue(Math.max(1, Math.round(effE())));
  const pulse = motion ? Math.exp(-beat * 5) : 0;
  // sync ring: brighter and tighter with more Gleichtakt; pulses on the beat
  g.beginPath();
  g.arc(cx, cy, R * (1 + pulse * 0.04 * effS()), 0, Math.PI * 2);
  g.strokeStyle = `hsla(${hue}, 100%, 70%, ${0.15 + effS() * 0.6})`;
  g.lineWidth = 2 + effS() * 4;
  g.shadowColor = `hsla(${hue}, 100%, 65%, 0.9)`;
  g.shadowBlur = 12 + pulse * 18 * effS();
  g.stroke();
  g.shadowBlur = 0;
  g.globalCompositeOperation = "lighter";
  if (motion) rot += 0.0009 * (0.3 + effE() / 10) * 16;
  for (let i = 0; i < count; i++) {
    const d = dots[i];
    const inSync = i / Math.max(1, count) < effS();
    const own = motion ? Math.exp(-(((beat + d.ph) % 1) * 5)) : 0;
    const bump = inSync ? pulse : own;
    const spread = inSync ? 0.06 : 0.55;
    const rad = R * (1 + d.off * spread) + bump * 7;
    const a = d.a + rot * d.sp * (inSync ? 1 : 1.4);
    const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
    const size = (count > 200 ? 9 : 12) * d.sz * (1 + bump * 0.5);
    g.globalAlpha = inSync ? 0.85 : 0.45;
    g.filter = "none";
    g.drawImage(tinted(hue, inSync), x - size / 2, y - size / 2, size, size);
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  // "Du": always at the top of the ring, white with a ring (not shown when only watching)
  if (!state.hasMe) return;
  const myIn = state.myStab >= 0.6;
  const mx = cx, my = cy - R * (myIn ? 1 : 1.25) - (myIn ? pulse * 7 : 0);
  g.beginPath();
  g.arc(mx, my, 7, 0, Math.PI * 2);
  g.fillStyle = "#fff";
  g.shadowColor = "#fff";
  g.shadowBlur = 14;
  g.fill();
  g.shadowBlur = 0;
  g.beginPath();
  g.arc(mx, my, 12, 0, Math.PI * 2);
  g.strokeStyle = "rgba(255,255,255,0.8)";
  g.lineWidth = 1.5;
  g.stroke();
  g.font = "bold 12px system-ui, sans-serif";
  g.fillStyle = "#fff";
  g.textAlign = "center";
  g.fillText("Du", mx, my - 17);
  g.textAlign = "start";
  void now;
}
const tintCache = new Map<string, HTMLCanvasElement>();
function tinted(hue: number, bright: boolean) {
  const key = `${Math.round(hue)}-${bright}`;
  let c = tintCache.get(key);
  if (!c) {
    c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d")!;
    g.drawImage(sprite!, 0, 0);
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = bright ? `hsl(${hue}, 100%, 72%)` : `hsl(${hue - 25}, 80%, 60%)`;
    g.fillRect(0, 0, 32, 32);
    tintCache.set(key, c);
  }
  return c;
}
function gauge(id: string, value: number, max: number, label: string, hue: number) {
  const { g, w, h } = fit($<HTMLCanvasElement>(id));
  g.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h * 0.62, rad = Math.min(w * 0.42, h * 0.55);
  const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2;
  g.lineCap = "round";
  g.lineWidth = 8;
  g.strokeStyle = "rgba(255,255,255,0.1)";
  g.beginPath();
  g.arc(cx, cy, rad, a0, a1);
  g.stroke();
  g.strokeStyle = `hsl(${hue}, 100%, 66%)`;
  g.shadowColor = `hsl(${hue}, 100%, 60%)`;
  g.shadowBlur = 10;
  g.beginPath();
  g.arc(cx, cy, rad, a0, a0 + (a1 - a0) * Math.max(0, Math.min(1, value / max)));
  g.stroke();
  g.shadowBlur = 0;
  g.fillStyle = "#fff";
  g.font = "800 20px system-ui, sans-serif";
  g.textAlign = "center";
  g.fillText(label, cx, cy + 7);
  g.textAlign = "start";
}
// --- UI state ----------------------------------------------------------------------------
function update() {
    const solo = state.n <= 1;
  const cE = effE();
  const cS = effS();
  const crowd = { energy: cE, sync: cS, participation: solo ? 1 : 0.8, n: state.n };
  const ready = state.live ? state.ready : state.phase === "Drop" || state.phase === "Peak" ? 1 : readiness(crowd);
  const hue = levelHue(state.phase === "Breakdown" ? 1 : Math.max(1, Math.round(effE())));
  root.style.setProperty("--hue", String(hue));
  $("gphase").textContent = state.phase;
  $("gN").textContent = formatN(state.n);
  $("gNtxt").textContent = state.n === 1 ? (state.live && !state.hasMe ? "tanzt gerade" : "Solo: nur du tanzt") : "tanzen mit";
  const k = state.n / dotsFor(state.n);
  $("gScale").textContent = k > 1.05 ? `1 Punkt ≈ ${fmt(k, k < 10 ? 1 : 0)} Tänzer` : "1 Punkt = 1 Tänzer";
  $("myE").style.width = `${state.myEnergy * 10}%`;
  $("myS").style.width = `${state.myStab * 100}%`;
  $("myFb").textContent = state.myStab >= 0.6 ? "Du bist im Takt!" : state.myStab >= 0.4 ? "Fast – folg der Kick" : "Such den Beat";
  $("gReady").style.width = `${Math.round(ready * 100)}%`;
  $("gReadyTxt").textContent = state.phase === "Drop" ? "Drop!" : state.live && state.n === 0 ? "nach Plan" : ready >= 1 ? "frei" : `${Math.round(ready * 100)} %`;
  $("gview").querySelector(".ready")!.classList.toggle("free", ready >= 1);
  const rule = unlockRule(state.n);
  $("gRule").textContent =
    state.phase === "Build-up" || state.phase === "Aufbau"
      ? ready >= 1
        ? "Bereit – der Drop kommt auf die Eins."
        : rule.mode === "solo"
          ? "Solo: halte deinen Takt stabil, dann kommt der Drop."
          : "Mehr Gleichtakt schaltet den Drop frei."
      : state.phase === "Breakdown"
        ? "Durchatmen – gleich baut es sich wieder auf."
        : "Weiter so!";
  $("gRuleN").textContent = state.live ? (state.n ? `Freigabe-Regel · ${state.rule} · zählt gerade ${state.n} von ${state.joined}` : state.rule) : `Freigabe-Regel · ${rule.text}`;
  gauge("gEnergy", cE, 10, fmt(cE), hue);
  gauge("gSync", cS, 1, `${Math.round(cS * 100)}%`, 190);
  const preset = presetById(state.preset);
  let hist: CurvePoint[] = liveHist;
  if (!state.live) {
    hist = [];
    for (let t = 0; t <= state.minute * 60; t += 30) hist.push({ t, level: Math.max(1, Math.round(Math.min(10, 2 + (t / 60) * 0.25))), ist: Math.min(10, 1.5 + (t / 60) * 0.24), section: "groove", drop: null });
  }
  drawCurve($<HTMLCanvasElement>("gCurve"), preset, hist, state.minute * 60, { me: true, compact: true });
  $("pocket").hidden = !state.pocket || !screenOn("gview");
  $("gview").hidden = state.pocket || !screenOn("gview");
  if (state.live) {
    $("light").hidden = !state.lm;
    $("lightUp").textContent = state.up ? "PHONES UP!" : "Licht-Moment";
    $("lightSub").textContent = state.up ? "Handy hoch – gleich kommt der Drop auf die Eins" : state.phase === "Drop" ? "Drop!" : "Gleich: Handy raus und hoch";
  }
}
// --- screens ---------------------------------------------------------------------------
let screen: "join" | "consent" | "joining" | "gview" = "gview";
const screenOn = (s: typeof screen) => screen === s;
function show(s: typeof screen) {
  screen = s;
  for (const id of ["join", "consent", "joining"] as const) $(id).hidden = s !== id;
  update();
}
// Battery: no animation in pocket mode or when hidden; 30 fps cap otherwise; static frame with reduced motion.
let last = 0;
let lastLost = 0;
const t0 = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  flashFrame(now);
  // Network gone: the grid runs on freely for 32 bars, then the view dims honestly.
  if (core?.link.last && now - lastLost > 1000) {
    lastLost = now;
    const lost = !Number.isFinite(core.link.barAt(performance.timeOrigin + now));
    document.body.classList.toggle("lost", lost);
    if (lost) $("gStat").textContent = "Verbindung zum Master verloren – versuche es weiter …";
  }
  if (state.pocket || document.hidden || screen !== "gview") return;
  const motion = !reducedMotion();
  if (!motion && last) return;
  if (now - last < 33) return;
  last = now;
  // Glow pulse once per beat (≤ 2.3 Hz, under 3 Hz). Live: on the master's heard grid.
  let beat = (((now - t0) / 1000) * (BPM / 60)) % 1;
  const g = core?.link.last;
  if (g && core) {
    const beatMs = 60000 / g.bpm;
    const tm = core.link.clock.toMaster(performance.timeOrigin + now);
    beat = ((((tm - g.at) / beatMs) % 1) + 1) % 1;
  }
  root.style.setProperty("--pulse", motion ? Math.exp(-beat * 5).toFixed(3) : "0");
  drawSwarm(now, beat, motion);
}
function bind(id: string, out: string, f: (v: number) => string, set: (v: number) => void) {
  const el = $<HTMLInputElement>(id);
  const h = () => {
    const v = Number(el.value);
    set(v);
    $(out).textContent = f(v);
    last = 0;
    update();
  };
  el.addEventListener("input", h);
  h();
}
$<HTMLInputElement>("sN").value = String(nToSlider(128));
bind("sN", "sNo", (v) => formatN(sliderToN(v)), (v) => (state.n = sliderToN(v)));
bind("sE", "sEo", (v) => fmt(v), (v) => (state.energy = v));
bind("sS", "sSo", (v) => `${Math.round(v * 100)} %`, (v) => (state.sync = v));
bind("sMe", "sMeo", (v) => fmt(v), (v) => (state.myEnergy = v));
bind("sMs", "sMso", (v) => `${Math.round(v * 100)} %`, (v) => (state.myStab = v));
bind("sT", "sTo", (v) => `${fmt(v, v % 1 ? 1 : 0)} min`, (v) => (state.minute = v));
$("sPhase").querySelectorAll("button").forEach((b) =>
  b.addEventListener("click", () => {
    state.phase = b.dataset.v!;
    $("sPhase").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    update();
  }),
);
const setPocket = (on: boolean) => {
  state.pocket = on;
  if (core) core.pocket = on;
  last = 0;
  update();
};
$("toPocket").onclick = () => setPocket(true);
// Touch lock: the black pocket screen swallows every touch; only a 2 s hold brings the stats back.
holdButton($("showStats"), 2000, () => setPocket(false));
$("pocket").addEventListener("touchstart", (e) => e.target === $("pocket") && e.preventDefault(), { passive: false });
$("takeOut").onclick = () => setPocket(!state.pocket);
window.addEventListener("resize", () => ((last = 0), update()));
// --- flash on the one (light command arrives ≥ 1 bar ahead) -----------------------------
let flashes: number[] = [];
/** Flashes shown, in master clock ms (for the sync test). */
const flashLog: { planned: number; shown: number; reduced: boolean }[] = [];
let flashUntil = 0;
const flashEl = $("flash");
function flashFrame(t: number) {
  const reduce = reducedMotion();
  for (const f of flashes)
    if (t >= f && t < f + 200) { // a late frame (jank, throttling) still flashes, up to 200 ms
      flashUntil = t + 450;
      if (core) flashLog.push({ planned: core.link.clock.toMaster(performance.timeOrigin + f), shown: core.link.clock.toMaster(performance.timeOrigin + t), reduced: reduce });
      flashes = flashes.filter((x) => x !== f);
      break;
    }
  flashes = flashes.filter((f) => f > t - 1000);
  // ≤ 1 flash per bar (< 1 Hz), none with reduced motion (the light screen stays steady).
  flashEl.style.opacity = reduce ? "0" : String(Math.max(0, (flashUntil - t) / 450) * 0.9);
}
// --- live mode -------------------------------------------------------------------------
const params = new URLSearchParams(location.search);
const hashK = new URLSearchParams(location.hash.slice(1)).get("k");
const net = params.get("net") ?? "auto";
let core: GuestCore | null = null;
const openedAt = now();
let wasUp = false;
// The guest's own night (local only) → "Meine Karte".
let night: NightLog | null = null;
let nightBars = 0;
const saveMyNight = () => night && saveNight(night.night);
function onBar(m: BarMsg) {
  if (night) {
    night.bar(m, Date.now());
    if (++nightBars % 16 === 0) saveMyNight();
  }
  state.n = m.crowd.n;
  state.joined = m.crowd.joined;
  state.energy = m.crowd.E;
  state.sync = m.crowd.S;
  state.ready = m.crowd.ready;
  state.rule = m.crowd.rule;
  state.mode = m.crowd.mode;
  state.phase = m.phase;
  state.minute = m.min;
  state.preset = m.preset;
  state.lm = m.lm;
  state.up = m.up;
  if (m.up && !wasUp) navigator.vibrate?.([220, 120, 220]);
  wasUp = m.up;
  const prev = liveHist.at(-1);
  const t = m.min * 60;
  if (!prev || t > prev.t) liveHist.push({ t, level: m.lvl, ist: m.crowd.n ? m.crowd.E : 0, section: m.sec as CurvePoint["section"], drop: m.drop as CurvePoint["drop"] });
  if (liveHist.length > 4000) liveHist.shift();
  const c = core!;
  const flashAt = (master: number) => c.link.clock.toLocal(master) - performance.timeOrigin;
  if (m.dropAt) {
    const barMs = 240000 / m.bpm;
    // The one, then the next three downbeats (one flash per bar).
    for (let k = 0; k < 4; k++) {
      const f = flashAt(m.dropAt + k * barMs);
      if (!flashes.some((x) => Math.abs(x - f) < 100) && f > performance.now() - 50) flashes.push(f);
    }
  }
  const lat = Math.round(c.link.clock.error);
  $("gStat").textContent = `Verbunden über ${c.link.transport} · Uhr ±${lat} ms · ${c.sensing ? (c.visible ? "du zählst" : "pausiert") : "nur zuschauen"}`;
  last = 0;
  update();
}
async function goLive(sid: string, key: string) {
  state.live = true;
  state.n = 0;
  state.sensing = true;
  $("gtag").textContent = "Live · verschlüsselt";
  $("simpanel").hidden = true;
  $("leave").hidden = false;
  core = new GuestCore({ sid, key, net });
  core.onBar = onBar;
  night = new NightLog(sid);
  nightBars = 0;
  $("myCard").hidden = false;
  core.onFeatures = (f) => {
    state.myEnergy = f.e * 10;
    state.myStab = f.R;
    night?.me(f, Date.now());
  };
  show("consent");
  core.connect().catch((e) => ($("joinErr").textContent = `Keine Verbindung: ${(e as Error).message}. Bitte WLAN/Mobilfunk prüfen.`));
  const join = async (sensing: boolean) => {
    const c = core!;
    $("joinErr").textContent = "";
    let ok = false;
    if (sensing) {
      // Ask in the same tap (iOS). No motion sensor → watch only, honestly labelled.
      const perm = await askMotion();
      if (perm !== "denied") ok = await onMotion((smp) => c.push(smp));
      if (!ok) $("joinErr").textContent = perm === "denied" ? "Bewegungssensor nicht erlaubt – du schaust nur zu." : "Kein Bewegungssensor gefunden – du schaust nur zu.";
    }
    c.sensing = ok;
    state.sensing = ok;
    state.hasMe = ok;
    show("joining");
    $("joinStep").textContent = "Verbinde …";
    try {
      await c.connect();
      $("joinStep").textContent = "Uhr wird synchronisiert …";
      $("joinDetail").textContent = `über ${c.link.transport}`;
      await c.start(openedAt);
    } catch (e) {
      show("consent");
      $("joinErr").textContent = `Beitritt fehlgeschlagen: ${(e as Error).message}`;
      return;
    }
    keepAwake();
    // Battery (Chromium only): below 30 % suggest locking the phone.
    void (navigator as unknown as { getBattery?: () => Promise<{ level: number; charging: boolean }> }).getBattery?.().then((b) => {
      if (b.level < 0.3 && !b.charging) {
        $("hiddenNote").textContent = `Akku bei ${Math.round(b.level * 100)} % – sperr dein Handy ruhig; du zählst dann nur nicht mit.`;
        $("hiddenNote").hidden = false;
      }
    });
    show("gview");
    setPocket(ok);
  };
  $("agree").onclick = () => void join(true);
  $("watch").onclick = () => void join(false);
}
document.addEventListener("visibilitychange", () => {
  if (!core) return;
  const vis = document.visibilityState === "visible";
  core.setVisible(vis);
  if (vis && core.link.joined && core.sensing) {
    $("hiddenNote").textContent = "Während die Seite verdeckt war, hast du nicht gezählt – das ist okay, du giltst nicht als müde.";
    $("hiddenNote").hidden = false;
    setTimeout(() => ($("hiddenNote").hidden = true), 9000);
  }
});
$("leave").onclick = async () => {
  await core?.leave();
  core = null;
  saveMyNight();
  const mine = night?.night;
  night = null;
  $("myCard").hidden = true;
  renderNights();
  if (mine?.start) openCard(mine, false);
  state.live = false;
  state.hasMe = false;
  show("join");
  $("codeErr").textContent = "Du bist raus – danke fürs Mittanzen!";
};
$("codeGo").onclick = async () => {
  const code = normCode($<HTMLInputElement>("codeIn").value);
  if (code.length !== 6) {
    $("codeErr").textContent = "Der Code hat 6 Zeichen.";
    return;
  }
  $("codeErr").textContent = "Suche Party …";
  try {
    const inv = await resolveCode(code, net);
    history.replaceState(null, "", `?s=${inv.s}${net !== "auto" ? `&net=${net}` : ""}#k=${inv.k}`);
    await goLive(inv.s, inv.k);
  } catch (e) {
    $("codeErr").textContent = (e as Error).message;
  }
};
// --- story card + past nights --------------------------------------------------------------
let cardNight: GuestNight | null = null;
function openCard(n: GuestNight, deletable: boolean) {
  cardNight = n;
  drawCard($<HTMLCanvasElement>("gCard"), guestCard(n));
  $<HTMLImageElement>("gCardImg").src = $<HTMLCanvasElement>("gCard").toDataURL("image/png");
  $("gCardDel").hidden = !deletable;
  $("gCardNote").textContent = "";
  $("cardView").hidden = false;
}
const cardName = (n: GuestNight) => `schwarm-meine-nacht-${new Date(n.start).toISOString().slice(0, 10)}.png`;
$("myCard").onclick = () => {
  if (!night?.night.start) {
    $("gStat").textContent = "Noch keine Daten – nach dem ersten Takt gibt es deine Karte.";
    return;
  }
  saveMyNight();
  openCard(structuredClone(night.night), false);
};
$("gShare").onclick = async () => {
  if (!cardNight) return;
  const how = await shareCard($<HTMLCanvasElement>("gCard"), cardName(cardNight));
  $("gCardNote").textContent = how === "shared" ? "Geteilt." : how === "downloaded" ? "Teilen geht hier nicht – Bild gespeichert." : "Abgebrochen.";
};
$("gSave").onclick = async () => cardNight && downloadBlob(await cardBlob($<HTMLCanvasElement>("gCard")), cardName(cardNight));
$("gCardClose").onclick = () => ($("cardView").hidden = true);
$("gCardDel").onclick = () => {
  if (!cardNight) return;
  deleteNight(cardNight.sid, cardNight.start);
  $("cardView").hidden = true;
  renderNights();
};
function renderNights() {
  const xs = loadNights();
  $("nights").hidden = !xs.length;
  $("nightList").innerHTML = "";
  for (const n of xs) {
    const s = summarizeNight(n);
    const li = document.createElement("li");
    const t = document.createElement("span");
    t.textContent = `${dayLabel(n.start)} · ${clock(n.start)}–${clock(n.end)} · ${s.myMinutes} min mitgetanzt · ${n.drops.length} ${n.drops.length === 1 ? "Drop" : "Drops"}`;
    const b = document.createElement("button");
    b.className = "btn small";
    b.textContent = "Karte";
    b.onclick = () => openCard(n, true);
    li.append(t, b);
    $("nightList").append(li);
  }
}
window.addEventListener("pagehide", () => saveMyNight());
document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && saveMyNight());
renderNights();
const sid = params.get("s");
if (sid && hashK) void goLive(sid, hashK);
else if (params.has("preview")) {
  state.hasMe = true;
  $("simpanel").hidden = false;
  show("gview");
} else show("join");
requestAnimationFrame(frame);
registerSW();
(window as unknown as { __guest: unknown }).__guest = { state, dotsFor, core: () => core, flashLog, night: () => night?.night ?? null };
