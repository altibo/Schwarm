// Local party profile (per device, localStorage only): speaker latency (tap-along or mic click),
// TV/crowd-screen flash offset. On the second start everything comes from here (concept §6, §9).
export interface PartyProfile {
  /** Extra speaker latency on top of what the browser reports (ms, + = heard later). */
  speakerMs: number;
  speakerHow: "none" | "tap" | "mic" | "slider";
  /** The TV shows a frame this much later than it was drawn (ms): flash early by this. */
  tvMs: number;
  tvHow: "none" | "tap" | "slider";
  /** Raw mic round trip of the last mic measurement (ms), for display. */
  micTotalMs?: number;
  at: number;
}
const KEY = "schwarm.profile";
const OLD = "schwarm.latency";
export const DEFAULT_PROFILE: PartyProfile = { speakerMs: 0, speakerHow: "none", tvMs: 0, tvHow: "none", at: 0 };
type Store = Pick<Storage, "getItem" | "setItem">;
const ls = (): Store | null => (globalThis as { localStorage?: Store }).localStorage ?? null;
export function loadProfile(store: Store | null = ls()): PartyProfile {
  if (!store) return { ...DEFAULT_PROFILE };
  try {
    const p = JSON.parse(store.getItem(KEY) ?? "null") as Partial<PartyProfile> | null;
    if (p && typeof p.speakerMs === "number") return { ...DEFAULT_PROFILE, ...p };
  } catch {
    /* corrupt → defaults */
  }
  // Phase 1 stored only the tap latency.
  const old = Number(store.getItem(OLD));
  if (Number.isFinite(old) && store.getItem(OLD) !== null) return { ...DEFAULT_PROFILE, speakerMs: old, speakerHow: "tap" };
  return { ...DEFAULT_PROFILE };
}
export function saveProfile(p: Partial<PartyProfile>, store: Store | null = ls()): PartyProfile {
  const next = { ...loadProfile(store), ...p, at: Date.now() };
  store?.setItem(KEY, JSON.stringify(next));
  store?.setItem(OLD, String(next.speakerMs));
  return next;
}
/** Calibrated = the second start needs nothing but "Start". */
export const isCalibrated = (p: PartyProfile) => p.speakerHow !== "none";
export const clampSpeaker = (ms: number) => Math.round(Math.max(-150, Math.min(400, ms)));
export const clampTv = (ms: number) => Math.round(Math.max(0, Math.min(300, ms)));
/** Median offset of taps against a periodic reference (wrapped to ±period/2). */
export function tapOffset(taps: number[], ref: number, period: number): number {
  const offs = taps.map((t) => {
    const d = (((t - ref) % period) + period) % period;
    return d > period / 2 ? d - period : d;
  });
  offs.sort((a, b) => a - b);
  const n = offs.length;
  return n % 2 ? offs[(n - 1) / 2] : (offs[n / 2 - 1] + offs[n / 2]) / 2;
}
