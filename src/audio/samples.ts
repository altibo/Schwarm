import bank from "./sample-bank.json" with { type: "json" };
export { bank };
export const SAMPLE_FILES: string[] = [
  ...Object.values(bank.drums).map((d) => d.file),
  ...Object.values(bank.instruments).flatMap((i) => i.zones.map((z) => z.file)),
];
export interface Zone {
  root: number;
  buffer: AudioBuffer;
}
export interface Library {
  drums: Record<string, AudioBuffer>;
  instruments: Record<string, Zone[]>;
}
const cache = new WeakMap<BaseAudioContext, Promise<Library>>();
export function loadLibrary(ctx: BaseAudioContext, base: string): Promise<Library> {
  const hit = cache.get(ctx);
  if (hit) return hit;
  const promise = (async () => {
    const get = async (file: string) => {
      const res = await fetch(`${base}${file}`);
      if (!res.ok) throw new Error(`Sample fehlt: ${file}`);
      return ctx.decodeAudioData(await res.arrayBuffer());
    };
    const drums: Record<string, AudioBuffer> = {};
    const instruments: Record<string, Zone[]> = {};
    await Promise.all([
      ...Object.entries(bank.drums).map(async ([k, d]) => {
        drums[k] = await get(d.file);
      }),
      ...Object.entries(bank.instruments).map(async ([k, inst]) => {
        instruments[k] = await Promise.all(inst.zones.map(async (z) => ({ root: z.root, buffer: await get(z.file) })));
      }),
    ]);
    return { drums, instruments };
  })();
  cache.set(ctx, promise);
  return promise;
}
export function nearestZone(zones: Zone[], note: number): Zone {
  return zones.reduce((best, z) => (Math.abs(z.root - note) < Math.abs(best.root - note) ? z : best));
}
