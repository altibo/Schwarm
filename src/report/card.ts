// Story card (MVP, concept §11): a static 1080×1920 PNG drawn locally on a canvas – peak time,
// number of drops, mini curve, dancer count, SCHWARM glow. No names, shared only on purpose.
import { levelHue } from "../ui/theme.ts";
export interface CardStat {
  big: string;
  small: string;
}
export interface CardData {
  /** e.g. "Die Nacht" (master) or "Meine Nacht" (guest). */
  title: string;
  date: string;
  /** Huge line, e.g. "Peak 00:47". */
  hero: string;
  heroSub: string;
  stats: CardStat[];
  /** Crowd curve 0–10 per point (null = nobody counted). */
  curve: (number | null)[];
  /** Optional second line (guest: own energy 0–10). */
  me?: (number | null)[];
  /** Optional target curve (dashed). */
  soll?: number[];
  /** Index into curve for the peak marker. */
  peak?: number;
  /** Drop positions as fractions 0–1 of the curve. */
  drops?: number[];
  /** Overall energy level 1–10 → glow colour. */
  level: number;
  footer: string;
}
export const CARD_W = 1080;
export const CARD_H = 1920;
export function drawCard(cv: HTMLCanvasElement, d: CardData) {
  cv.width = CARD_W;
  cv.height = CARD_H;
  const g = cv.getContext("2d")!;
  const hue = levelHue(d.level);
  const font = (w: number, px: number) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  // Background: deep night with two glows.
  g.fillStyle = "#05040f";
  g.fillRect(0, 0, CARD_W, CARD_H);
  for (const [x, y, r, h, a] of [
    [300, 420, 900, hue, 0.55],
    [900, 1500, 800, hue + 40, 0.35],
  ] as const) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `hsla(${h}, 95%, 50%, ${a})`);
    gr.addColorStop(1, "hsla(0, 0%, 0%, 0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, CARD_W, CARD_H);
  }
  const glowText = (text: string, x: number, y: number, f: string, color: string, blur: number, align: CanvasTextAlign = "left") => {
    g.font = f;
    g.textAlign = align;
    g.shadowColor = `hsla(${hue}, 100%, 65%, 0.9)`;
    g.shadowBlur = blur;
    g.fillStyle = color;
    g.fillText(text, x, y);
    g.shadowBlur = 0;
  };
  // Logo + title.
  glowText("S C H W A R M", 90, 170, font(800, 60), "#fff", 40);
  glowText(d.title, 90, 290, font(700, 72), "rgba(255,255,255,0.92)", 12);
  glowText(d.date, 90, 360, font(500, 40), "rgba(220,225,255,0.7)", 0);
  // Hero.
  glowText(d.hero, 90, 560, font(900, 150), "#fff", 60);
  glowText(d.heroSub, 94, 640, font(500, 44), "rgba(230,230,255,0.8)", 0);
  // Curve panel.
  const cx = 70, cy = 720, cw = CARD_W - 140, ch = 520;
  g.fillStyle = "rgba(255,255,255,0.05)";
  roundRect(g, cx, cy, cw, ch, 36);
  g.fill();
  const pts = d.curve;
  const X = (k: number, n: number) => cx + 40 + (n <= 1 ? 0 : (k / (n - 1)) * (cw - 80));
  const Y = (v: number) => cy + ch - 50 - (Math.max(0, Math.min(10, v)) / 10) * (ch - 110);
  if (d.soll?.length) {
    g.setLineDash([14, 14]);
    g.strokeStyle = "rgba(255,255,255,0.45)";
    g.lineWidth = 5;
    line(g, d.soll.map((v, k) => [X(k, d.soll!.length), Y(v)]));
    g.setLineDash([]);
  }
  for (const f of d.drops ?? []) {
    const x = cx + 40 + f * (cw - 80);
    g.fillStyle = `hsla(${hue + 30}, 100%, 70%, 0.9)`;
    g.shadowColor = g.fillStyle;
    g.shadowBlur = 24;
    diamond(g, x, cy + 46, 16);
    g.shadowBlur = 0;
  }
  const seg = (arr: (number | null)[], stroke: string, width: number, blur: number) => {
    g.strokeStyle = stroke;
    g.lineWidth = width;
    g.shadowColor = stroke;
    g.shadowBlur = blur;
    let run: [number, number][] = [];
    arr.forEach((v, k) => {
      if (v === null) {
        if (run.length) line(g, run);
        run = [];
      } else run.push([X(k, arr.length), Y(v)]);
    });
    if (run.length) line(g, run);
    g.shadowBlur = 0;
  };
  seg(pts, `hsl(${hue}, 100%, 66%)`, 12, 36);
  if (d.me) seg(d.me, "rgba(120, 240, 255, 0.95)", 7, 20);
  if (d.peak !== undefined && pts[d.peak] !== null && pts[d.peak] !== undefined) {
    const px = X(d.peak, pts.length), py = Y(pts[d.peak]!);
    g.fillStyle = "#fff";
    g.shadowColor = "#fff";
    g.shadowBlur = 40;
    g.beginPath();
    g.arc(px, py, 18, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
  }
  g.font = font(500, 32);
  g.textAlign = "left";
  g.fillStyle = "rgba(230,230,255,0.75)";
  g.fillText(d.me ? "Schwarm" : "Crowd-Energie", cx + 40, cy + ch - 14);
  if (d.me) {
    g.fillStyle = "rgba(120, 240, 255, 0.95)";
    g.fillText("Du", cx + 250, cy + ch - 14);
  }
  if (d.soll?.length) {
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.fillText("- - Plan", cx + (d.me ? 360 : 330), cy + ch - 14);
  }
  // Stat tiles (2 columns).
  const tw = (CARD_W - 140 - 40) / 2, th = 210;
  d.stats.slice(0, 4).forEach((s, k) => {
    const x = 70 + (k % 2) * (tw + 40), y = 1300 + Math.floor(k / 2) * (th + 36);
    g.fillStyle = "rgba(255,255,255,0.06)";
    roundRect(g, x, y, tw, th, 32);
    g.fill();
    glowText(s.big, x + 40, y + 118, font(800, 92), "#fff", 30);
    g.font = font(500, 34);
    g.fillStyle = "rgba(225,225,255,0.78)";
    g.fillText(s.small, x + 42, y + 175);
  });
  g.font = font(500, 30);
  g.textAlign = "center";
  g.fillStyle = "rgba(220,220,255,0.55)";
  g.fillText(d.footer, CARD_W / 2, CARD_H - 70);
  g.textAlign = "left";
}
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function line(g: CanvasRenderingContext2D, pts: [number, number][]) {
  g.beginPath();
  pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
  if (pts.length === 1) g.lineTo(pts[0][0] + 1, pts[0][1]);
  g.lineCap = "round";
  g.lineJoin = "round";
  g.stroke();
}
function diamond(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  g.moveTo(x, y - r);
  g.lineTo(x + r, y);
  g.lineTo(x, y + r);
  g.lineTo(x - r, y);
  g.closePath();
  g.fill();
}
export const cardBlob = (cv: HTMLCanvasElement) => new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("PNG fehlgeschlagen"))), "image/png"));
/** Web Share API with the PNG where supported (mobile), else a download. Returns what happened. */
export async function shareCard(cv: HTMLCanvasElement, name: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const blob = await cardBlob(cv);
  const file = new File([blob], name, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: "SCHWARM" });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
    }
  }
  downloadBlob(blob, name);
  return "downloaded";
}
export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
/** "00:47" in the device's local time. */
export const clock = (w: number) => new Date(w).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
export const dayLabel = (w: number) => new Date(w).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
