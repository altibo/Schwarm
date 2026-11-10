// DeviceMotion access: iOS needs a tap + permission; everything needs HTTPS.
import type { MotionSample } from "../sense.ts";
type DME = typeof DeviceMotionEvent & { requestPermission?: () => Promise<"granted" | "denied" | "prompt"> };
/** Must be called inside a tap handler (iOS). */
export async function askMotion(): Promise<"granted" | "denied" | "prompt" | "unsupported"> {
  if (typeof DeviceMotionEvent === "undefined") return "unsupported";
  const D = DeviceMotionEvent as DME;
  if (typeof D.requestPermission === "function") {
    try {
      return await D.requestPermission();
    } catch {
      return "denied";
    }
  }
  return "granted";
}
/** Subscribe to motion; resolves `true` once a real sample arrived (within `waitMs`). */
export function onMotion(cb: (s: MotionSample) => void, waitMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    let got = false;
    window.addEventListener("devicemotion", (e: DeviceMotionEvent) => {
      const a = e.acceleration;
      const g = e.accelerationIncludingGravity;
      const acc = a && a.x !== null ? { x: a.x ?? 0, y: a.y ?? 0, z: a.z ?? 0 } : null;
      const accG = g && g.x !== null ? { x: g.x ?? 0, y: g.y ?? 0, z: g.z ?? 0 } : null;
      if (!acc && !accG) return;
      if (!got) {
        got = true;
        resolve(true);
      }
      cb({ t: performance.now(), acc, accG });
    });
    setTimeout(() => resolve(got), waitMs);
  });
}
type WL = { request(t: "screen"): Promise<{ release(): Promise<void>; addEventListener(e: string, f: () => void): void }> };
/** Keep the screen on while visible; re-acquired when the page becomes visible again. */
export function keepAwake() {
  let lock: { release(): Promise<void> } | null = null;
  const get = async () => {
    try {
      const wl = (navigator as unknown as { wakeLock?: WL }).wakeLock;
      if (wl && document.visibilityState === "visible") lock = await wl.request("screen");
    } catch {
      lock = null;
    }
  };
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void get());
  void get();
  return () => void lock?.release().catch(() => {});
}
