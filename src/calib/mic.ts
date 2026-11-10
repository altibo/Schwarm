// Optional speaker-latency measurement with the master's built-in microphone (concept §6):
// play 8 clicks, record with echoCancellation / noiseSuppression / autoGainControl OFF, find each
// click's onset. Measured = output path + air + input path; the input part is subtracted where
// the browser reports it. The microphone is closed right after the measurement.
export const CLICKS = 8;
export const CLICK_GAP = 0.5;
export const MAX_DELAY = 0.45;
/** Accept only consistent measurements: spread (IQR) of the click delays ≤ this. */
export const MAX_SPREAD_MS = 15;
export interface Detection {
  delays: (number | null)[];
  medianMs: number | null;
  spreadMs: number | null;
  found: number;
}
/** Onset detection: first sample above max(0.02, 6 × noise RMS before the click). */
export function detectClicks(x: Float32Array, startFrame: number, sr: number, clicks: number[], maxDelay = MAX_DELAY): Detection {
  const delays = clicks.map((c) => {
    const at = Math.round(c * sr) - startFrame;
    const pre = Math.round(0.08 * sr);
    if (at - pre < 0 || at >= x.length) return null;
    let e = 0;
    for (let i = at - pre; i < at; i++) e += x[i] * x[i];
    const thr = Math.max(0.02, 6 * Math.sqrt(e / pre));
    const end = Math.min(x.length, at + Math.round(maxDelay * sr));
    for (let i = at; i < end; i++) if (Math.abs(x[i]) > thr) return ((i - at) / sr) * 1000;
    return null;
  });
  const ok = delays.filter((d): d is number => d !== null).sort((a, b) => a - b);
  if (ok.length < 3) return { delays, medianMs: null, spreadMs: null, found: ok.length };
  const q = (p: number) => ok[Math.min(ok.length - 1, Math.max(0, Math.round(p * (ok.length - 1))))];
  const n = ok.length;
  const med = n % 2 ? ok[(n - 1) / 2] : (ok[n / 2 - 1] + ok[n / 2]) / 2;
  return { delays, medianMs: med, spreadMs: q(0.75) - q(0.25), found: n };
}
export interface MicResult {
  ok: boolean;
  reason?: string;
  /** Raw click → microphone time (ms). */
  totalMs: number | null;
  inputMs: number;
  reportedOutMs: number;
  /** Correction on top of the reported output latency (what the tap calibration also yields). */
  extraMs: number | null;
  spreadMs: number | null;
  found: number;
  /** The microphone's name hints at Bluetooth (hands-free profile risk). */
  btMic: boolean;
  label: string;
}
const WORKLET = `class R extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage({f:currentFrame,d:c.slice(0)});return true}}registerProcessor("schwarm-rec",R);`;
export async function measureMic(ctx: AudioContext): Promise<MicResult> {
  const base = { totalMs: null, inputMs: 0, reportedOutMs: 0, extraMs: null, spreadMs: null, found: 0, btMic: false, label: "" };
  if (!navigator.mediaDevices?.getUserMedia) return { ...base, ok: false, reason: "Kein Mikrofonzugriff in diesem Browser." };
  if (!ctx.audioWorklet) return { ...base, ok: false, reason: "AudioWorklet fehlt in diesem Browser." };
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (e) {
    return { ...base, ok: false, reason: `Mikrofon nicht erlaubt (${(e as Error).name}).` };
  }
  const track = stream.getAudioTracks()[0];
  const label = track?.label ?? "";
  const btMic = /bluetooth|hands-?free|headset|airpods|buds|bt\b/i.test(label);
  const settings = (track?.getSettings?.() ?? {}) as MediaTrackSettings & { latency?: number };
  const inputMs = typeof settings.latency === "number" ? settings.latency * 1000 : 0;
  const chunks: { f: number; d: Float32Array }[] = [];
  const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
  let src: MediaStreamAudioSourceNode | null = null;
  let node: AudioWorkletNode | null = null;
  const mute = ctx.createGain();
  mute.gain.value = 0;
  try {
    await ctx.audioWorklet.addModule(url);
    await ctx.resume();
    src = ctx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(ctx, "schwarm-rec");
    node.port.onmessage = (ev) => chunks.push(ev.data as { f: number; d: Float32Array });
    src.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);
    // Clicks: 3 ms full-scale bursts straight to the speaker.
    const sr = ctx.sampleRate;
    const buf = ctx.createBuffer(1, Math.round(0.003 * sr), sr);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = i % 2 ? -0.9 : 0.9;
    const t0 = ctx.currentTime + 0.5;
    const clicks = Array.from({ length: CLICKS }, (_, k) => t0 + k * CLICK_GAP);
    for (const c of clicks) {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.connect(ctx.destination);
      s.start(c);
    }
    const until = clicks.at(-1)! + MAX_DELAY + 0.2;
    await new Promise<void>((res) => {
      const iv = setInterval(() => {
        if (ctx.currentTime >= until) {
          clearInterval(iv);
          res();
        }
      }, 50);
    });
    if (!chunks.length) return { ...base, ok: false, reason: "Vom Mikrofon kamen keine Daten.", btMic, label, inputMs };
    const first = chunks[0].f;
    const len = chunks.at(-1)!.f + chunks.at(-1)!.d.length - first;
    const x = new Float32Array(len);
    for (const c of chunks) x.set(c.d, c.f - first);
    const det = detectClicks(x, first, sr, clicks);
    const reportedOutMs = ((ctx.outputLatency || 0) + (ctx.baseLatency || 0)) * 1000;
    if (det.medianMs === null || det.found < 5) return { ...base, ok: false, reason: `Nur ${det.found} von ${CLICKS} Klicks gehört – lauter stellen, näher an die Box, leiser Raum.`, found: det.found, btMic, label, inputMs, reportedOutMs };
    const totalMs = Math.round(det.medianMs);
    const extraMs = Math.round(det.medianMs - inputMs - reportedOutMs);
    const ok = det.spreadMs! <= MAX_SPREAD_MS;
    return { ok, reason: ok ? undefined : `Messung unsicher (Streuung ${Math.round(det.spreadMs!)} ms) – bitte wiederholen oder mitklopfen.`, totalMs, inputMs: Math.round(inputMs), reportedOutMs: Math.round(reportedOutMs), extraMs, spreadMs: Math.round(det.spreadMs!), found: det.found, btMic, label };
  } finally {
    for (const t of stream.getTracks()) t.stop();
    src?.disconnect();
    node?.disconnect();
    mute.disconnect();
    URL.revokeObjectURL(url);
  }
}
