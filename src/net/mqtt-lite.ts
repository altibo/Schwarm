// Minimal MQTT 3.1.1 client over WebSocket (QoS 0 only): CONNECT, SUBSCRIBE, PUBLISH, PING.
// No dependency, runs in browsers and in Node ≥ 22 (global WebSocket). Payloads are opaque
// bytes; SCHWARM encrypts them before they get here (the broker only sees ciphertext).
const te = new TextEncoder();
const td = new TextDecoder();
function varint(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 128;
    out.push(b);
  } while (n > 0);
  return out;
}
const str = (s: string) => {
  const b = te.encode(s);
  return [b.length >> 8, b.length & 255, ...b];
};
function packet(type: number, flags: number, body: number[] | Uint8Array): Uint8Array {
  const head = [(type << 4) | flags, ...varint(body.length)];
  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);
  return out;
}
export interface MqttOptions {
  url: string;
  clientId: string;
  username?: string;
  password?: string;
  keepalive?: number;
  timeoutMs?: number;
}
export class MqttLite {
  private ws: WebSocket | null = null;
  private buf = new Uint8Array(0);
  private pid = 1;
  private ping = 0;
  private readonly o: MqttOptions;
  onMessage: (topic: string, payload: Uint8Array) => void = () => {};
  onClose: (reason: string) => void = () => {};
  connected = false;
  constructor(o: MqttOptions) {
    this.o = o;
  }
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.o.url, ["mqtt"]);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      let settled = false;
      const fail = (why: string) => {
        if (!settled) {
          settled = true;
          reject(new Error(why));
        }
        this.close(why);
      };
      const timer = setTimeout(() => fail("timeout"), this.o.timeoutMs ?? 8000);
      ws.onerror = () => fail("websocket error");
      ws.onclose = () => fail("closed");
      ws.onopen = () => {
        const flags = 0x02 | (this.o.username ? 0x80 : 0) | (this.o.password ? 0x40 : 0);
        const ka = this.o.keepalive ?? 30;
        const body = [...str("MQTT"), 4, flags, ka >> 8, ka & 255, ...str(this.o.clientId)];
        if (this.o.username) body.push(...str(this.o.username));
        if (this.o.password) body.push(...str(this.o.password));
        ws.send(packet(1, 0, body));
      };
      ws.onmessage = (ev) => {
        const chunk = new Uint8Array(ev.data as ArrayBuffer);
        const merged = new Uint8Array(this.buf.length + chunk.length);
        merged.set(this.buf);
        merged.set(chunk, this.buf.length);
        this.buf = merged;
        this.drain((type, flags, body) => {
          if (type === 2) {
            clearTimeout(timer);
            if (body[1] !== 0) return fail(`connack ${body[1]}`);
            settled = true;
            this.connected = true;
            const ka = (this.o.keepalive ?? 30) * 1000;
            this.ping = setInterval(() => this.ws?.readyState === 1 && this.ws.send(new Uint8Array([0xc0, 0])), ka * 0.75) as unknown as number;
            resolve();
          } else if (type === 3) {
            const tl = (body[0] << 8) | body[1];
            const topic = td.decode(body.subarray(2, 2 + tl));
            let off = 2 + tl;
            if ((flags >> 1) & 3) off += 2; // packet id (QoS > 0, not used by us)
            this.onMessage(topic, body.slice(off));
          }
        });
      };
    });
  }
  private drain(on: (type: number, flags: number, body: Uint8Array) => void) {
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      let len = 0;
      let mul = 1;
      let i = 1;
      for (;;) {
        if (i >= b.length) return;
        const d = b[i++];
        len += (d & 127) * mul;
        mul *= 128;
        if (!(d & 128)) break;
        if (i > 4) return this.close("bad length");
      }
      if (b.length < i + len) return;
      const body = b.subarray(i, i + len);
      this.buf = b.slice(i + len);
      on(b[0] >> 4, b[0] & 15, body);
    }
  }
  subscribe(topic: string) {
    const id = this.pid++ & 0xffff || 1;
    this.ws?.send(packet(8, 2, [id >> 8, id & 255, ...str(topic), 0]));
  }
  publish(topic: string, payload: Uint8Array) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    const t = str(topic);
    const body = new Uint8Array(t.length + payload.length);
    body.set(t);
    body.set(payload, t.length);
    this.ws.send(packet(3, 0, body));
    return true;
  }
  close(reason = "closed") {
    clearInterval(this.ping);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = ws.onerror = ws.onmessage = null;
      try {
        if (ws.readyState === 1) ws.send(new Uint8Array([0xe0, 0]));
        ws.close();
      } catch {
        /* ignore */
      }
    }
    if (this.connected) {
      this.connected = false;
      this.onClose(reason);
    }
  }
}
