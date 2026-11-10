// Small canvas charts for the report: lines over the night, bands, markers.
export interface Series {
  values: (number | null)[];
  color: string;
  width?: number;
  dash?: number[];
  glow?: boolean;
  label: string;
}
export interface Band {
  from: number;
  to: number;
  color: string;
}
export interface Marker {
  at: number;
  color: string;
  label?: string;
}
export function drawChart(cv: HTMLCanvasElement, o: { series: Series[]; min: number; max: number; ticks: number[]; tickFmt?: (v: number) => string; xLabels: { at: number; text: string }[]; bands?: Band[]; markers?: Marker[]; n: number }) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth || 600, h = cv.clientHeight || 200;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const g = cv.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const L = 34, R = 8, T = 16, B = 20;
  const X = (k: number) => L + (o.n <= 1 ? 0 : (k / (o.n - 1)) * (w - L - R));
  const Y = (v: number) => T + (1 - (v - o.min) / (o.max - o.min)) * (h - T - B);
  g.font = "11px system-ui, sans-serif";
  for (const b of o.bands ?? []) {
    g.fillStyle = b.color;
    g.fillRect(X(b.from), T, Math.max(1, X(b.to) - X(b.from)), h - T - B);
  }
  g.strokeStyle = "rgba(160,170,255,0.14)";
  g.fillStyle = "rgba(200,210,255,0.6)";
  g.lineWidth = 1;
  for (const v of o.ticks) {
    g.beginPath();
    g.moveTo(L, Y(v));
    g.lineTo(w - R, Y(v));
    g.stroke();
    g.fillText(o.tickFmt ? o.tickFmt(v) : String(v), 4, Y(v) + 4);
  }
  for (const x of o.xLabels) g.fillText(x.text, Math.min(w - 34, Math.max(L - 4, X(x.at) - 14)), h - 5);
  for (const s of o.series) {
    g.strokeStyle = s.color;
    g.lineWidth = s.width ?? 2;
    g.setLineDash(s.dash ?? []);
    g.shadowColor = s.color;
    g.shadowBlur = s.glow ? 8 : 0;
    g.beginPath();
    let pen = false;
    s.values.forEach((v, k) => {
      if (v === null) return void (pen = false);
      if (pen) g.lineTo(X(k), Y(v));
      else g.moveTo(X(k), Y(v));
      pen = true;
    });
    g.stroke();
    g.setLineDash([]);
    g.shadowBlur = 0;
  }
  for (const m of o.markers ?? []) {
    const x = X(m.at);
    g.fillStyle = m.color;
    g.beginPath();
    g.moveTo(x, T - 2);
    g.lineTo(x + 6, T + 5);
    g.lineTo(x, T + 12);
    g.lineTo(x - 6, T + 5);
    g.fill();
    g.strokeStyle = m.color;
    g.globalAlpha = 0.35;
    g.beginPath();
    g.moveTo(x, T + 12);
    g.lineTo(x, h - B);
    g.stroke();
    g.globalAlpha = 1;
  }
}
