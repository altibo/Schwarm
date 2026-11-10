// Big energy-curve view: target curve, music level, crowd energy, breakdowns/drops, "jetzt".
import { sollAt, type CurvePreset } from "../curve.ts";
import { levelColor } from "./theme.ts";
export interface CurvePoint {
  t: number; // seconds
  level: number;
  ist: number;
  section: string;
  drop: string | null;
}
export function drawCurve(cv: HTMLCanvasElement, preset: CurvePreset, hist: CurvePoint[], nowSec: number, opts: { me?: boolean; compact?: boolean } = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const g = cv.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const padL = opts.compact ? 6 : 30, padR = 8, padT = 10, padB = opts.compact ? 6 : 20;
  const total = preset.minutes * 60;
  const X = (t: number) => padL + (t / total) * (w - padL - padR);
  const Y = (v: number) => padT + (1 - v / 10) * (h - padT - padB);
  // grid
  g.font = "11px system-ui, sans-serif";
  g.fillStyle = "rgba(200,210,255,0.55)";
  g.strokeStyle = "rgba(160,170,255,0.12)";
  g.lineWidth = 1;
  if (!opts.compact) {
    for (const v of [0, 2, 4, 6, 8, 10]) {
      g.beginPath();
      g.moveTo(padL, Y(v));
      g.lineTo(w - padR, Y(v));
      g.stroke();
      g.fillText(String(v), 6, Y(v) + 4);
    }
    const stepMin = preset.minutes <= 10 ? 2 : preset.minutes <= 60 ? 10 : 30;
    for (let m = 0; m <= preset.minutes; m += stepMin) {
      g.beginPath();
      g.moveTo(X(m * 60), padT);
      g.lineTo(X(m * 60), h - padB);
      g.stroke();
      const label = preset.minutes > 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}` : `${m}′`;
      g.fillText(label, X(m * 60) - 8, h - 5);
    }
  }
  // breakdown / build bands
  for (let i = 0; i < hist.length; i++) {
    const p = hist[i];
    if (p.section === "groove") continue;
    const t1 = hist[i + 1]?.t ?? nowSec;
    g.fillStyle = p.section === "breakdown" ? "rgba(90,140,255,0.16)" : "rgba(230,120,255,0.14)";
    g.fillRect(X(p.t), padT, Math.max(1, X(t1) - X(p.t)), h - padT - padB);
  }
  // music level: filled steps coloured by level
  for (let i = 0; i < hist.length; i++) {
    const p = hist[i];
    const t1 = hist[i + 1]?.t ?? nowSec;
    const lvl = p.section === "breakdown" ? Math.max(1, p.level - 3) : p.level;
    const grad = g.createLinearGradient(0, Y(lvl), 0, Y(0));
    grad.addColorStop(0, levelColor(p.level, 60, 0.75));
    grad.addColorStop(1, levelColor(p.level, 40, 0.05));
    g.fillStyle = grad;
    g.fillRect(X(p.t), Y(lvl), Math.max(1, X(t1) - X(p.t)) + 0.5, Y(0) - Y(lvl));
  }
  // target curve (future dimmer)
  const curve = (from: number, to: number, alpha: number, dash: number[]) => {
    g.beginPath();
    g.setLineDash(dash);
    for (let t = from; t <= to; t += total / 400) {
      const x = X(t), y = Y(sollAt(preset, t / 60));
      if (t === from) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokeStyle = `rgba(255,255,255,${alpha})`;
    g.lineWidth = 2;
    g.shadowColor = "rgba(255,255,255,0.6)";
    g.shadowBlur = alpha > 0.5 ? 8 : 0;
    g.stroke();
    g.shadowBlur = 0;
    g.setLineDash([]);
  };
  curve(0, Math.min(nowSec, total), 0.85, []);
  if (nowSec < total) curve(nowSec, total, 0.4, [5, 5]);
  // crowd energy
  if (hist.length > 1) {
    g.beginPath();
    hist.forEach((p, i) => (i ? g.lineTo(X(p.t), Y(p.ist)) : g.moveTo(X(p.t), Y(p.ist))));
    g.strokeStyle = "rgba(90,240,255,0.9)";
    g.lineWidth = 1.5;
    g.stroke();
  }
  // drops
  for (const p of hist)
    if (p.drop) {
      const x = X(p.t), y = Y(p.level);
      g.fillStyle = p.drop === "rettung" ? "rgba(255,255,255,0.9)" : "hsl(330,100%,70%)";
      g.beginPath();
      g.moveTo(x, y - 7);
      g.lineTo(x + 6, y);
      g.lineTo(x, y + 7);
      g.lineTo(x - 6, y);
      g.closePath();
      g.fill();
    }
  // now marker
  const nx = X(Math.min(nowSec, total));
  const last = hist[hist.length - 1];
  g.strokeStyle = last ? levelColor(last.level, 75) : "#fff";
  g.shadowColor = g.strokeStyle;
  g.shadowBlur = 14;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(nx, padT);
  g.lineTo(nx, h - padB);
  g.stroke();
  g.beginPath();
  g.arc(nx, Y(sollAt(preset, nowSec / 60)), 5, 0, Math.PI * 2);
  g.fillStyle = "#fff";
  g.fill();
  g.shadowBlur = 0;
  if (opts.me) {
    g.font = "bold 12px system-ui, sans-serif";
    g.fillStyle = "#fff";
    const label = "Du bist hier";
    const tw = g.measureText(label).width;
    g.fillText(label, Math.min(w - tw - 4, Math.max(4, nx - tw / 2)), Math.max(12, Y(sollAt(preset, nowSec / 60)) - 10));
  }
}
