// QR code on a canvas: dark modules on white with a quiet zone (scannable in a dark room).
import qrcode from "qrcode-generator";
export function drawQr(cv: HTMLCanvasElement, text: string) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 3;
  const css = Math.max(64, Math.min(cv.clientWidth || 240, cv.clientHeight || cv.clientWidth || 240));
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const cell = Math.max(1, Math.floor((css * dpr) / (n + quiet * 2)));
  const size = cell * (n + quiet * 2);
  cv.width = cv.height = size;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, size, size);
  g.fillStyle = "#0a0820";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
  cv.dataset.text = text;
}
