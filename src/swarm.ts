// Load-test harness: N simulated guests in one page, each with its own transport connection,
// clock sync and the real feature pipeline (synthetic motion instead of DeviceMotion).
import "./style.css";
import "./guest.css";
import { GuestCore } from "./guest-core.ts";
import { now } from "./net/clock.ts";
import { rng } from "./rng.ts";
const params = new URLSearchParams(location.search);
const key = new URLSearchParams(location.hash.slice(1)).get("k") ?? "";
const sid = params.get("s") ?? "";
const n = Number(params.get("n") ?? 50);
const net = params.get("net") ?? "auto";
const out = document.getElementById("out")!;
interface Sim {
  core: GuestCore;
  offset: number;
  amp: number;
}
const mode = { sync: params.get("mode") !== "random", amp: Number(params.get("amp") ?? 3.5) };
const r = rng(Number(params.get("seed") ?? 1));
const sims: Sim[] = [];
async function main() {
  if (!sid || !key) return;
  out.textContent = `Verbinde ${n} Gäste …`;
  const t0 = now();
  // Browsers allow only one WebSocket handshake per server IP at a time (RFC 6455 §4.1), so one
  // page opening 50 connections has to queue them; real phones each have their own browser.
  const res: PromiseSettledResult<void>[] = [];
  const joins: Promise<void>[] = [];
  for (let i = 0; i < n; i++) {
    const core = new GuestCore({ sid, key, net, id: `sim${i}-${Math.floor(r() * 1e6).toString(36)}` });
    let ok = false;
    for (let tries = 0; tries < 3 && !ok; tries++) {
      try {
        await core.connect();
        ok = true;
      } catch (e) {
        if (tries === 2) res.push({ status: "rejected", reason: e });
      }
    }
    if (!ok) continue;
    out.textContent = `Verbinde ${n} Gäste … ${i + 1}`;
    joins.push(
      core.start().then(() => {
        sims.push({ core, offset: 0, amp: mode.amp * (0.8 + r() * 0.4) });
      }),
    );
  }
  res.push(...(await Promise.allSettled(joins)));
  setPhases();
  const errs = res.filter((x) => x.status === "rejected").map((x) => String((x as PromiseRejectedResult).reason?.message ?? x));
  const failed = errs.length;
  (window as unknown as { __swarmErrors: string[] }).__swarmErrors = errs;
  out.textContent = `${sims.length} verbunden, ${failed} fehlgeschlagen, ${Math.round(now() - t0)} ms`;
  // One shared 30 Hz motion clock for everybody.
  setInterval(() => {
    const t = performance.now();
    for (const s of sims) {
      const g = s.core.link.last;
      if (!g) continue;
      const tm = s.core.link.clock.toMaster(performance.timeOrigin + t);
      const th = (2 * Math.PI * (tm - g.at)) / (60000 / g.bpm);
      const v = s.amp * Math.cos(th - s.offset) + (Math.random() - 0.5) * 0.4;
      s.core.push({ t, acc: { x: (Math.random() - 0.5) * 0.3, y: v * 0.7, z: v * 0.7 }, accG: { x: 0, y: 6.87 + v * 0.7, z: 7 + v * 0.7 } });
    }
  }, 33);
}
function setPhases() {
  for (const s of sims) s.offset = mode.sync ? (r() - 0.5) * 0.6 : r() * Math.PI * 2;
}
(window as unknown as { __swarm: unknown }).__swarm = {
  sims,
  setMode(sync: boolean) {
    mode.sync = sync;
    setPhases();
  },
  stats: () => ({
    connected: sims.length,
    synced: sims.filter((s) => s.core.link.clock.count >= 3).length,
    reports: sims.reduce((a, s) => a + s.core.reports, 0),
    maxOffsetMs: Math.max(0, ...sims.map((s) => Math.abs(s.core.link.clock.offset))),
    joinMs: sims.map((s) => s.core.joinMs),
    transports: [...new Set(sims.map((s) => s.core.link.transport))],
  }),
  leave: (k: number) => Promise.all(sims.splice(0, k).map((s) => s.core.leave())),
};
void main();
