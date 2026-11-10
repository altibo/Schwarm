// Party session on top of a transport: the master is the hub, guests join with the link from
// the QR code (guest.html?s=<sid>#k=<key>) or with the short code via the lobby. All payloads are
// AES-GCM sealed with the session key. Guests send ~1 small feature packet per bar.
import { Box, newKey, randomCode, codeTopic, normCode } from "./crypto.ts";
import { ClockSync, now } from "./clock.ts";
import { HubLink, ClientLink, candidates, type NetChoice } from "./transport.ts";
import type { FeaturePacket } from "../aggregate.ts";
import type { Pose } from "../sense.ts";
/** What the master tells everyone once per bar. Times are master clock ms (heard grid). */
export interface BarMsg {
  t: "bar";
  /** Master page epoch: changes when the master tab reloads. */
  ep: string;
  i: number;
  at: number;
  bpm: number;
  lvl: number;
  sec: string;
  phase: string;
  min: number;
  preset: string;
  soll: number;
  pre: boolean;
  drop: string | null;
  /** Light command, sent ≥ 1 bar ahead: the drop lands at this master time. */
  dropAt: number | null;
  dropType: string | null;
  /** Light moment (phones up) active. */
  lm: boolean;
  /** "Phones up!" call (light moment and the drop is close / unlocked). */
  up: boolean;
  /** Sampling probability for feature reports. */
  p: number;
  crowd: { n: number; m: number; joined: number; E: number; S: number; P: number; U: number; medR: number; ready: number; mode: string; rule: string };
}
export type UpMsg =
  | { t: "hello"; id: string; vis: boolean }
  | { t: "ping"; id: string; k: number; t0: number }
  | ({ t: "f" } & FeaturePacket & { still?: boolean })
  | { t: "hb"; id: string; vis: boolean; still?: boolean; watch?: boolean }
  | { t: "bye"; id: string };
export type DirectMsg = { t: "pong"; k: number; t0: number; tm: number } | { t: "welcome"; ep: string };
interface Stored {
  sid: string;
  code: string;
  key: string;
}
const STORE = "schwarm.session";
export function loadOrCreateSession(fresh = false): Stored {
  if (!fresh) {
    try {
      const s = JSON.parse(localStorage.getItem(STORE) ?? "null") as Stored | null;
      if (s?.sid && s.key && s.code) return s;
    } catch {
      /* ignore */
    }
  }
  const s = { sid: randomCode(10).toLowerCase(), code: randomCode(6), key: newKey() };
  localStorage.setItem(STORE, JSON.stringify(s));
  return s;
}
export class MasterHub {
  readonly sid: string;
  readonly code: string;
  readonly key: string;
  readonly ep = randomCode(6);
  private box!: Box;
  private lobbyBox!: Box;
  private lobbyTopic = "";
  link: HubLink;
  onUp: (m: UpMsg, t: number) => void = () => {};
  onState: () => void = () => {};
  results: { name: string; ok: boolean; error: string }[] = [];
  msgsIn = 0;
  readonly net: NetChoice;
  constructor(s: Stored, net: NetChoice = "auto") {
    this.net = net;
    this.sid = s.sid;
    this.code = s.code;
    this.key = s.key;
    this.link = new HubLink(candidates(net, "hub", s.sid));
  }
  joinUrl(base = location.href) {
    const u = new URL("guest.html", base);
    u.search = `?s=${this.sid}${this.net !== "auto" ? `&net=${encodeURIComponent(this.net)}` : ""}`;
    u.hash = `k=${this.key}`;
    return u.toString();
  }
  async start() {
    this.box = await Box.fromKey(this.key, this.sid);
    this.lobbyBox = await Box.fromCode(this.code, "lobby");
    this.lobbyTopic = `lobby/${await codeTopic(this.code)}`;
    this.link.onMessage = (topic, data) => void this.receive(topic, data);
    this.link.onState = () => this.onState();
    this.link.subscribe(`${this.sid}/up`);
    this.link.subscribe(this.lobbyTopic);
    this.results = await this.link.start();
    this.onState();
    return this.results;
  }
  private async receive(topic: string, data: Uint8Array) {
    if (topic === this.lobbyTopic) {
      const m = await this.lobbyBox.open<{ t: string }>(data);
      if (m?.t === "ask") this.link.publish(this.lobbyTopic, await this.lobbyBox.seal({ t: "invite", s: this.sid, k: this.key }));
      return;
    }
    const m = await this.box.open<UpMsg>(data);
    if (!m) return;
    this.msgsIn++;
    const t = now();
    if (m.t === "ping") this.direct(m.id, { t: "pong", k: m.k, t0: m.t0, tm: now() });
    else if (m.t === "hello") this.direct(m.id, { t: "welcome", ep: this.ep });
    this.onUp(m, t);
  }
  async direct(id: string, m: DirectMsg) {
    this.link.publish(`${this.sid}/g/${id}`, await this.box.seal(m));
  }
  async broadcast(m: BarMsg) {
    this.link.publish(`${this.sid}/down`, await this.box.seal(m));
  }
  close() {
    this.link.close();
  }
}
/** Ask the master for the session link with the short code (MQTT lobby). */
export async function resolveCode(codeIn: string, net: NetChoice = "auto", timeoutMs = 9000): Promise<{ s: string; k: string }> {
  const code = normCode(codeIn);
  const box = await Box.fromCode(code, "lobby");
  const topic = `lobby/${await codeTopic(code)}`;
  const link = new ClientLink(() => candidates(net === "auto" ? "mqtt" : net, "client", "lobby"));
  link.subscribe(topic);
  try {
    return await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("Code nicht gefunden – läuft die Party?")), timeoutMs);
      link.onMessage = async (_t, d) => {
        const m = await box.open<{ t: string; s: string; k: string }>(d);
        if (m?.t === "invite") {
          clearTimeout(to);
          resolve({ s: m.s, k: m.k });
        }
      };
      link
        .start()
        .then(async () => {
          const ask = async () => link.publish(topic, await box.seal({ t: "ask" }));
          await ask();
          setTimeout(ask, 1500);
          setTimeout(ask, 4000);
        })
        .catch((e) => {
          clearTimeout(to);
          reject(e);
        });
    });
  } finally {
    link.close();
  }
}
export interface Grid {
  /** Bar index and its start (master ms). */
  i: number;
  at: number;
  bpm: number;
}
export class GuestLink {
  readonly sid: string;
  readonly id: string;
  private key: string;
  private box!: Box;
  link: ClientLink;
  clock = new ClockSync();
  last: BarMsg | null = null;
  lastAt = 0;
  transport = "";
  ep = "";
  sent = 0;
  private pingK = 0;
  private pending = new Map<number, number>();
  private syncTimer = 0;
  onBar: (m: BarMsg) => void = () => {};
  onState: (up: boolean) => void = () => {};
  constructor(sid: string, key: string, net: NetChoice = "auto", id?: string) {
    this.sid = sid;
    this.key = key;
    this.id = id ?? guestId(sid);
    this.link = new ClientLink(() => candidates(net, "client", sid, this.id));
  }
  joined = false;
  private connecting: Promise<string> | null = null;
  /** Transport only (nothing is sent): can run while the consent screen is shown. */
  connect() {
    this.connecting ??= (async () => {
      this.box = await Box.fromKey(this.key, this.sid);
      this.link.subscribe(`${this.sid}/down`);
      this.link.subscribe(`${this.sid}/g/${this.id}`);
      this.link.onMessage = (_t, d) => void this.receive(d);
      this.link.onState = (up, name) => {
        this.transport = name;
        if (up && this.joined) void this.hello().then(() => this.syncClock(5));
        this.onState(up);
      };
      this.transport = await this.link.start();
      return this.transport;
    })();
    this.connecting.catch(() => (this.connecting = null));
    return this.connecting;
  }
  /** After consent: announce, then ≥ 10 ping-pongs for the clock; re-sync every 30 s. */
  async join() {
    await this.connect();
    this.joined = true;
    await this.hello();
    await this.syncClock(10);
    clearInterval(this.syncTimer);
    this.syncTimer = setInterval(() => void this.syncClock(3), 30000) as unknown as number;
  }
  async start() {
    await this.connect();
    await this.join();
  }
  private async hello() {
    await this.send({ t: "hello", id: this.id, vis: typeof document === "undefined" || document.visibilityState !== "hidden" });
  }
  /** ≥ 10 ping-pongs at join, a few every 30 s; the smallest round trip wins. */
  async syncClock(count: number) {
    for (let j = 0; j < count; j++) {
      const k = ++this.pingK;
      const t0 = now();
      this.pending.set(k, t0);
      await this.send({ t: "ping", id: this.id, k, t0 });
      await new Promise((r) => setTimeout(r, 110));
    }
    const until = now() + 2500;
    while (this.clock.count < Math.min(count, 3) && now() < until) await new Promise((r) => setTimeout(r, 50));
  }
  private async receive(d: Uint8Array) {
    const m = await this.box.open<BarMsg | DirectMsg>(d);
    if (!m) return;
    if (m.t === "pong") {
      if (!this.pending.delete(m.k)) return;
      this.clock.add({ t0: m.t0, tm: m.tm, t2: now() });
    } else if (m.t === "welcome") {
      this.ep = m.ep;
    } else if (m.t === "bar") {
      if (this.ep && m.ep !== this.ep) {
        // The master tab was reloaded: new grid, resync the clock.
        this.ep = m.ep;
        void this.syncClock(5);
      }
      this.ep = m.ep;
      this.last = m;
      this.lastAt = now();
      this.onBar(m);
    }
  }
  async send(m: UpMsg) {
    const ok = this.link.publish(`${this.sid}/up`, await this.box.seal(m));
    if (ok) this.sent++;
    return ok;
  }
  /** The master's heard grid extrapolated to local time (up to 32 bars without news). */
  grid(): Grid | null {
    return this.last ? { i: this.last.i, at: this.last.at, bpm: this.last.bpm } : null;
  }
  /** Start of bar `i` in local ms (extrapolated with the last tempo). */
  barStartLocal(i: number) {
    const g = this.last;
    if (!g) return NaN;
    return this.clock.toLocal(g.at + (i - g.i) * (240000 / g.bpm));
  }
  /** Index of the bar audible at local time t (NaN after 32 bars without a bar message). */
  barAt(tLocal: number) {
    const g = this.last;
    if (!g) return NaN;
    const k = Math.floor((this.clock.toMaster(tLocal) - g.at) / (240000 / g.bpm));
    return k > 32 ? NaN : g.i + k;
  }
  async leave() {
    await this.send({ t: "bye", id: this.id });
    clearInterval(this.syncTimer);
    this.link.close();
  }
}
export function guestId(sid: string) {
  const k = `schwarm.gid.${sid}`;
  try {
    const old = sessionStorage.getItem(k);
    if (old) return old;
    const id = randomCode(8).toLowerCase();
    sessionStorage.setItem(k, id);
    return id;
  } catch {
    return randomCode(8).toLowerCase();
  }
}
export type { Pose };
