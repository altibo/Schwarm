// Target energy curves E_soll(t) on the 0–10 scale (concept §8). Times in minutes.
export interface CurvePreset {
  id: string;
  label: string;
  minutes: number;
  points: [number, number][];
}
export const PRESETS: CurvePreset[] = [
  {
    id: "1h",
    label: "60 min · 1 Welle",
    minutes: 60,
    points: [
      [0, 2],
      [5, 3.2],
      [14, 5.2],
      [26, 7.2],
      [36, 9.4],
      [45, 9.6],
      [52, 7.4],
      [60, 4],
    ],
  },
  {
    id: "3h",
    label: "3 h · 2 Wellen",
    minutes: 180,
    points: [
      [0, 2],
      [12, 3.8],
      [35, 6.4],
      [58, 8.8],
      [72, 9.4],
      [88, 6.2],
      [104, 5.4],
      [128, 8],
      [148, 9.8],
      [160, 9.6],
      [172, 6.5],
      [180, 4],
    ],
  },
  {
    id: "10m",
    label: "10 min · Demo-Welle",
    minutes: 10,
    points: [
      [0, 3],
      [2.5, 5.5],
      [5, 8.6],
      [7.5, 9.4],
      [10, 5],
    ],
  },
];
export const presetById = (id: string) => PRESETS.find((p) => p.id === id) ?? PRESETS[0];
// Monotone cosine interpolation between key points: smooth, never overshoots a key point.
export function sollAt(preset: CurvePreset, minute: number): number {
  const p = preset.points;
  if (minute <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    const [t1, v1] = p[i];
    const [t0, v0] = p[i - 1];
    if (minute <= t1) {
      const u = (minute - t0) / (t1 - t0);
      return v0 + (v1 - v0) * (1 - Math.cos(Math.PI * u)) * 0.5;
    }
  }
  return p[p.length - 1][1];
}
export type CurvePhase = "Warm-up" | "Aufbau" | "Peak" | "Ausklang";
export function curvePhase(preset: CurvePreset, minute: number): CurvePhase {
  const v = sollAt(preset, minute);
  const slope = sollAt(preset, minute + 1.5) - sollAt(preset, minute - 1.5);
  if (v >= 8.6) return "Peak";
  if (slope < -0.12) return "Ausklang";
  if (minute < preset.minutes * 0.12 && v < 4.5) return "Warm-up";
  return "Aufbau";
}
// δ for "Vorhalten": +1 in warm-up/build/peak, 0 when winding down.
export const leadDelta = (phase: CurvePhase) => (phase === "Ausklang" ? 0 : 1);
// Exploration rate per phase (concept §8).
export const exploreRate = (phase: CurvePhase) =>
  ({ "Warm-up": 0.2, Aufbau: 0.1, Peak: 0, Ausklang: 0.05 })[phase];
