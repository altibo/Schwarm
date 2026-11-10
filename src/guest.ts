import "./style.css";
import "./guest.css";
import { sliderToN, nToSlider, formatN, readiness, unlockRule } from "./crowd.ts";
import { presetById } from "./curve.ts";
import { drawCurve, type CurvePoint } from "./ui/curve-view.ts";
import { levelHue, reducedMotion } from "./ui/theme.ts";
import { rng } from "./rng.ts";
import { registerSW } from "./sw-register.ts";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const root = document.documentElement;
const BPM = 130;
const state = { n: 128, energy: 6.5, sync: 0.55, myEnergy: 7, myStab: 0.7, minute: 24, phase: "Aufbau", pocket: false };
const fmt = (x: number, d = 1) => x.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
// --- particles -------------------------------------------------------------------------
const MAX_DOTS = 420;
const r = rng(77);
const dots = Array.from({ length: MAX_DOTS }, (_, i) => ({ a: (i * 2.399963) % (Math.PI * 2), off: r() * 2 - 1, ph: r(), sp: 0.6 + r() * 0.8, sz: 0.7 + r() * 0.6 }));
// N = 1: the crowd *is* me, so crowd energy/sync follow my own values.
const effE = () => (state.n <= 1 ? state.myEnergy : state.energy);
const effS = () => (state.n <= 1 ? state.myStab : state.sync);
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
  // "Du": always at the top of the ring, white with a ring
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
  const ready = state.phase === "Drop" || state.phase === "Peak" ? 1 : readiness(crowd);
  const hue = levelHue(state.phase === "Breakdown" ? 1 : Math.max(1, Math.round(effE())));
  root.style.setProperty("--hue", String(hue));
  $("gphase").textContent = state.phase;
  $("gN").textContent = formatN(state.n);
  $("gNtxt").textContent = state.n === 1 ? "Solo: nur du tanzt" : "tanzen mit";
  const k = state.n / dotsFor(state.n);
  $("gScale").textContent = k > 1.05 ? `1 Punkt ≈ ${fmt(k, k < 10 ? 1 : 0)} Tänzer` : "1 Punkt = 1 Tänzer";
  $("myE").style.width = `${state.myEnergy * 10}%`;
  $("myS").style.width = `${state.myStab * 100}%`;
  $("myFb").textContent = state.myStab >= 0.6 ? "Du bist im Takt!" : state.myStab >= 0.4 ? "Fast – folg der Kick" : "Such den Beat";
  $("gReady").style.width = `${Math.round(ready * 100)}%`;
  $("gReadyTxt").textContent = ready >= 1 ? (state.phase === "Drop" ? "Drop!" : "frei") : `${Math.round(ready * 100)} %`;
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
  $("gRuleN").textContent = `Freigabe-Regel · ${rule.text}`;
  gauge("gEnergy", cE, 10, fmt(cE), hue);
  gauge("gSync", cS, 1, `${Math.round(cS * 100)}%`, 190);
  const preset = presetById("1h");
  const hist: CurvePoint[] = [];
  for (let t = 0; t <= state.minute * 60; t += 30) hist.push({ t, level: Math.max(1, Math.round(Math.min(10, 2 + (t / 60) * 0.25))), ist: Math.min(10, 1.5 + (t / 60) * 0.24), section: "groove", drop: null });
  drawCurve($<HTMLCanvasElement>("gCurve"), preset, hist, state.minute * 60, { me: true, compact: true });
  $("pocket").hidden = !state.pocket;
  $("gview").hidden = state.pocket;
}
// Battery: no animation in pocket mode or when hidden; 30 fps cap otherwise; static frame with reduced motion.
let last = 0;
const t0 = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  if (state.pocket || document.hidden) return;
  const motion = !reducedMotion();
  if (!motion && last) return;
  if (now - last < 33) return;
  last = now;
  const beat = (((now - t0) / 1000) * (BPM / 60)) % 1; // 2.17 Hz glow pulse, under 3 Hz
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
$("toPocket").onclick = () => ((state.pocket = true), update());
$("showStats").onclick = () => ((state.pocket = false), (last = 0), update());
$("takeOut").onclick = () => ((state.pocket = !state.pocket), (last = 0), update());
window.addEventListener("resize", () => ((last = 0), update()));
update();
requestAnimationFrame(frame);
registerSW();
(window as unknown as { __guest: unknown }).__guest = { state, dotsFor };
