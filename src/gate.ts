// Blind-test results: schema, CSV export and the music gate (concept §13, stage 1).
export interface BlindResult {
  schema: "schwarm-blindtest/1";
  id: string;
  listener: string;
  playback: string;
  mode: "schwarm" | "playlist";
  pack: string | null;
  preset: string | null;
  seed: number | null;
  playlistName: string | null;
  startedAt: string;
  durationSec: number;
  plannedSec: number;
  finished: boolean;
  bored: { t: number; bar?: number; level?: number; phase?: string }[];
  ratings: { due: number; t: number; value: number }[];
  userAgent: string;
}
export const RATING_EVERY_SEC = 600;
export const TEST_SECONDS = 3600;
/** Minutes until the first "Langweilig" tap; a listener who never taps counts as the full test length. */
export const minutesToBoredom = (r: BlindResult) => (r.bored.length ? r.bored[0].t : Math.max(r.durationSec, r.finished ? r.plannedSec : r.durationSec)) / 60;
export const meanRating = (r: BlindResult) => (r.ratings.length ? r.ratings.reduce((a, b) => a + b.value, 0) / r.ratings.length : NaN);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export interface GateVerdict {
  schwarm: { listeners: number; medianBoredomMin: number; meanRating: number };
  playlist: { listeners: number; medianBoredomMin: number; meanRating: number };
  ratio: number;
  verdict: "bestanden" | "grauzone" | "no-go" | "zu wenig daten";
  reasons: string[];
}
export function evaluateGate(results: BlindResult[], minListeners = 10): GateVerdict {
  const group = (mode: BlindResult["mode"]) => {
    const rs = results.filter((r) => r.mode === mode && r.ratings.length);
    const means = rs.map(meanRating);
    return { listeners: rs.length, medianBoredomMin: median(rs.map(minutesToBoredom)), meanRating: means.length ? means.reduce((a, b) => a + b, 0) / means.length : NaN };
  };
  const schwarm = group("schwarm"), playlist = group("playlist");
  const ratio = schwarm.meanRating / playlist.meanRating;
  const reasons: string[] = [];
  let verdict: GateVerdict["verdict"];
  if (!schwarm.listeners || !playlist.listeners || !Number.isFinite(ratio)) {
    verdict = "zu wenig daten";
    reasons.push("Es braucht Bewertungen für SCHWARM und für die Playlist.");
  } else {
    if (schwarm.listeners < minListeners || playlist.listeners < minListeners) reasons.push(`Weniger als ${minListeners} Hörer je Gruppe: Ergebnis nur vorläufig.`);
    const boredOk = schwarm.medianBoredomMin >= 45;
    reasons.push(`Median bis Langeweile ${schwarm.medianBoredomMin.toFixed(1)} min (Ziel ≥ 45).`);
    reasons.push(`Note ${(ratio * 100).toFixed(0)} % der Playlist (Ziel ≥ 80 %, unter 65 % No-Go).`);
    verdict = ratio < 0.65 ? "no-go" : boredOk && ratio >= 0.8 ? "bestanden" : "grauzone";
    if (verdict === "bestanden" && (schwarm.listeners < minListeners || playlist.listeners < minListeners)) verdict = "grauzone";
  }
  return { schwarm, playlist, ratio, verdict, reasons };
}
const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(results: BlindResult[]): string {
  const head = ["test_id", "hoerer", "wiedergabe", "modus", "playlist", "seed", "gestartet", "typ", "t_sek", "t_min", "wert", "faellig_sek", "takt", "stufe", "phase"];
  const rows: unknown[][] = [];
  for (const r of results) {
    const base = [r.id, r.listener, r.playback, r.mode, r.playlistName, r.seed, r.startedAt];
    for (const b of r.bored) rows.push([...base, "langweilig", b.t.toFixed(1), (b.t / 60).toFixed(2), "", "", b.bar ?? "", b.level ?? "", b.phase ?? ""]);
    for (const x of r.ratings) rows.push([...base, "note", x.t.toFixed(1), (x.t / 60).toFixed(2), x.value, x.due, "", "", ""]);
    rows.push([...base, "ende", r.durationSec.toFixed(1), (r.durationSec / 60).toFixed(2), r.finished ? "vollstaendig" : "abgebrochen", "", "", "", ""]);
  }
  return [head, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}
export function isResult(x: unknown): x is BlindResult {
  const r = x as BlindResult;
  return !!r && r.schema === "schwarm-blindtest/1" && Array.isArray(r.bored) && Array.isArray(r.ratings);
}
