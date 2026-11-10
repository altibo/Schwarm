// Transports carry opaque (already encrypted) bytes between master and guests. Three kinds share
// one interface: public MQTT brokers over WSS (primary), WebRTC data channels via the PeerJS
// cloud signalling server with the master as hub (fallback) and a BroadcastChannel for tests and
// single-device demos. Topics are relative to "schwarm/v1/": "<sid>/up", "<sid>/down",
// "<sid>/g/<guestId>", "lobby/<hash>".
import { MqttLite } from "./mqtt-lite.ts";
import { randomCode } from "./crypto.ts";
export interface Transport {
  readonly name: string;
  up: boolean;
  start(): Promise<void>;
  subscribe(topic: string): void;
  publish(topic: string, data: Uint8Array): boolean;
  onMessage: (topic: string, data: Uint8Array) => void;
  onState: (up: boolean) => void;
  close(): void;
}
const PREFIX = "schwarm/v1/";
export interface BrokerDef {
  name: string;
  url: string;
  username?: string;
  password?: string;
}
/** Public, account-free brokers (WSS). Order = preference for guests. */
export const BROKERS: BrokerDef[] = [
  { name: "shiftr.io", url: "wss://public.cloud.shiftr.io", username: "public", password: "public" },
  { name: "HiveMQ", url: "wss://broker.hivemq.com:8884/mqtt" },
  { name: "EMQX", url: "wss://broker.emqx.io:8084/mqtt" },
];
abstract class Base implements Transport {
  abstract readonly name: string;
  up = false;
  onMessage: (topic: string, data: Uint8Array) => void = () => {};
  onState: (up: boolean) => void = () => {};
  protected setUp(v: boolean) {
    if (v !== this.up) {
      this.up = v;
      this.onState(v);
    }
  }
  abstract start(): Promise<void>;
  abstract subscribe(topic: string): void;
  abstract publish(topic: string, data: Uint8Array): boolean;
  abstract close(): void;
}
export class MqttTransport extends Base {
  readonly name: string;
  private c: MqttLite | null = null;
  private subs = new Set<string>();
  private closed = false;
  private retry = 0;
  private def: BrokerDef;
  constructor(def: BrokerDef) {
    super();
    this.def = def;
    this.name = def.name;
  }
  async start() {
    const c = new MqttLite({ url: this.def.url, clientId: `schwarm-${randomCode(10)}`, username: this.def.username, password: this.def.password, keepalive: 20, timeoutMs: 7000 });
    c.onMessage = (t, p) => t.startsWith(PREFIX) && this.onMessage(t.slice(PREFIX.length), p);
    c.onClose = () => {
      this.setUp(false);
      this.reconnect();
    };
    await c.connect();
    if (this.closed) return c.close();
    this.c = c;
    this.retry = 0;
    for (const s of this.subs) c.subscribe(PREFIX + s);
    this.setUp(true);
  }
  private reconnect() {
    if (this.closed) return;
    const wait = Math.min(10000, 1000 * 2 ** this.retry++);
    setTimeout(() => !this.closed && this.start().catch(() => this.reconnect()), wait);
  }
  subscribe(topic: string) {
    this.subs.add(topic);
    this.c?.subscribe(PREFIX + topic);
  }
  publish(topic: string, data: Uint8Array) {
    return this.c?.publish(PREFIX + topic, data) ?? false;
  }
  close() {
    this.closed = true;
    this.c?.close();
    this.setUp(false);
  }
}
/** Same-browser transport (tabs/frames of one profile): tests, demos, the swarm harness. */
export class LocalTransport extends Base {
  readonly name = "lokal";
  private ch: BroadcastChannel | null = null;
  private subs = new Set<string>();
  async start() {
    this.ch = new BroadcastChannel("schwarm-local");
    this.ch.onmessage = (ev: MessageEvent<{ t: string; d: Uint8Array }>) => {
      if (this.subs.has(ev.data.t)) this.onMessage(ev.data.t, ev.data.d);
    };
    this.setUp(true);
  }
  subscribe(topic: string) {
    this.subs.add(topic);
  }
  publish(topic: string, data: Uint8Array) {
    this.ch?.postMessage({ t: topic, d: data });
    // BroadcastChannel does not echo to itself; deliver locally for a subscribed sender.
    if (this.subs.has(topic)) queueMicrotask(() => this.onMessage(topic, data));
    return !!this.ch;
  }
  close() {
    this.ch?.close();
    this.ch = null;
    this.setUp(false);
  }
}
type PeerMod = typeof import("peerjs");
type DataConn = import("peerjs").DataConnection;
type PeerT = import("peerjs").Peer;
interface Env {
  t: string;
  d: Uint8Array | ArrayBuffer;
  f?: string;
}
const peerId = (sid: string) => `schwarm-${sid.toLowerCase()}`;
const bytes = (d: Uint8Array | ArrayBuffer) => (d instanceof Uint8Array ? d : new Uint8Array(d));
/** WebRTC data channels with the master as hub (PeerJS cloud only does the signalling). Good for
 * small parties; one browser tab cannot hold hundreds of peer connections. */
export class PeerTransport extends Base {
  readonly name = "WebRTC (PeerJS)";
  private peer: PeerT | null = null;
  private conns = new Set<DataConn>();
  private byId = new Map<string, DataConn>();
  private hubConn: DataConn | null = null;
  private closed = false;
  private role: "hub" | "client";
  private sid: string;
  private me: string;
  constructor(role: "hub" | "client", sid: string, me = "") {
    super();
    this.role = role;
    this.sid = sid;
    this.me = me;
  }
  async start() {
    const { Peer } = (await import("peerjs")) as PeerMod;
    await new Promise<void>((resolve, reject) => {
      const peer = this.role === "hub" ? new Peer(peerId(this.sid), { debug: 0 }) : new Peer({ debug: 0 });
      this.peer = peer;
      const to = setTimeout(() => reject(new Error("peer timeout")), 9000);
      peer.on("error", (e) => {
        if (!this.up) {
          clearTimeout(to);
          reject(e);
        }
      });
      peer.on("open", () => {
        if (this.role === "hub") {
          clearTimeout(to);
          this.setUp(true);
          resolve();
        } else this.dial(() => (clearTimeout(to), resolve()));
      });
      peer.on("connection", (c) => this.attach(c));
      peer.on("disconnected", () => !this.closed && peer.reconnect());
    });
  }
  private dial(ok?: () => void) {
    if (!this.peer || this.closed) return;
    const c = this.peer.connect(peerId(this.sid), { serialization: "binary", reliable: true });
    c.on("open", () => {
      this.hubConn = c;
      this.setUp(true);
      ok?.();
    });
    c.on("data", (x) => this.deliver(c, x as Env));
    c.on("close", () => {
      this.hubConn = null;
      this.setUp(false);
      setTimeout(() => this.dial(), 2000);
    });
  }
  private attach(c: DataConn) {
    c.on("open", () => this.conns.add(c));
    c.on("data", (x) => this.deliver(c, x as Env));
    c.on("close", () => {
      this.conns.delete(c);
      for (const [id, x] of this.byId) if (x === c) this.byId.delete(id);
    });
  }
  private deliver(c: DataConn, e: Env) {
    if (!e || typeof e.t !== "string") return;
    if (e.f) this.byId.set(e.f, c);
    this.onMessage(e.t, bytes(e.d));
  }
  subscribe() {}
  publish(topic: string, data: Uint8Array) {
    if (this.role === "client") {
      if (!this.hubConn?.open) return false;
      void this.hubConn.send({ t: topic, d: data, f: this.me });
      return true;
    }
    const g = topic.match(/\/g\/(.+)$/);
    if (g) {
      const c = this.byId.get(g[1]);
      if (c?.open) void c.send({ t: topic, d: data });
      return !!c;
    }
    for (const c of this.conns) if (c.open) void c.send({ t: topic, d: data });
    return true;
  }
  close() {
    this.closed = true;
    this.peer?.destroy();
    this.setUp(false);
  }
}
export type NetChoice = "auto" | "mqtt" | "peer" | "local" | string;
/** Candidate transports for a network choice ("shiftr.io", "HiveMQ"… pick one broker). */
export function candidates(choice: NetChoice, role: "hub" | "client", sid: string, me = ""): Transport[] {
  if (choice === "local") return [new LocalTransport()];
  const brokers = BROKERS.filter((b) => choice === "auto" || choice === "mqtt" || b.name.toLowerCase() === choice.toLowerCase());
  const list: Transport[] = brokers.map((b) => new MqttTransport(b));
  if (choice === "auto" || choice === "peer") list.push(new PeerTransport(role, sid, me));
  return list;
}
/** Master: use every transport that works (guests may be on any of them). */
export class HubLink {
  readonly all: Transport[];
  onMessage: (topic: string, data: Uint8Array) => void = () => {};
  onState: () => void = () => {};
  constructor(list: Transport[]) {
    this.all = list;
    for (const t of list) {
      t.onMessage = (a, b) => this.onMessage(a, b);
      t.onState = () => this.onState();
    }
  }
  async start() {
    const res = await Promise.allSettled(this.all.map((t) => t.start()));
    this.onState();
    return res.map((r, i) => ({ name: this.all[i].name, ok: r.status === "fulfilled", error: r.status === "rejected" ? String((r.reason as Error)?.message ?? r.reason) : "" }));
  }
  subscribe(topic: string) {
    for (const t of this.all) t.subscribe(topic);
  }
  publish(topic: string, data: Uint8Array) {
    let ok = false;
    for (const t of this.all) if (t.up) ok = t.publish(topic, data) || ok;
    return ok;
  }
  get upNames() {
    return this.all.filter((t) => t.up).map((t) => t.name);
  }
  close() {
    for (const t of this.all) t.close();
  }
}
/** Guest: race the candidates (MQTT first, WebRTC after a short head start), keep the winner;
 * if it stays down for 8 s, race again. */
export class ClientLink {
  private make: () => Transport[];
  active: Transport | null = null;
  private subs = new Set<string>();
  private downSince = 0;
  private timer = 0;
  private closed = false;
  onMessage: (topic: string, data: Uint8Array) => void = () => {};
  onState: (up: boolean, name: string) => void = () => {};
  constructor(make: () => Transport[]) {
    this.make = make;
  }
  async start(): Promise<string> {
    const list = this.make();
    const winner = await new Promise<Transport>((resolve, reject) => {
      let left = list.length;
      let done = false;
      list.forEach((t, i) => {
        const go = () =>
          t.start().then(
            () => {
              if (done || this.closed) return t.close();
              done = true;
              resolve(t);
            },
            () => --left === 0 && !done && reject(new Error("Keine Verbindung möglich")),
          );
        if (t instanceof PeerTransport) setTimeout(() => (done ? left-- : go()), 1500);
        else go();
        void i;
      });
    });
    for (const t of list) if (t !== winner) t.close();
    this.active = winner;
    for (const s of this.subs) winner.subscribe(s);
    winner.onMessage = (a, b) => this.onMessage(a, b);
    winner.onState = (up) => {
      this.downSince = up ? 0 : performance.now();
      this.onState(up, winner.name);
    };
    this.onState(true, winner.name);
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.downSince && performance.now() - this.downSince > 8000 && !this.closed) {
        this.downSince = 0;
        winner.close();
        this.start().catch(() => (this.downSince = performance.now()));
      }
    }, 1000) as unknown as number;
    return winner.name;
  }
  subscribe(topic: string) {
    this.subs.add(topic);
    this.active?.subscribe(topic);
  }
  publish(topic: string, data: Uint8Array) {
    return this.active?.publish(topic, data) ?? false;
  }
  get up() {
    return !!this.active?.up;
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
    this.active?.close();
  }
}
