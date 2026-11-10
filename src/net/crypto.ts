// End-to-end encryption of every message (AES-GCM 128). The key lives only in the QR link's
// fragment (#k=…), which browsers never send to any server, so the broker / signalling service
// only ever relays ciphertext. AAD binds each message to its session.
const te = new TextEncoder();
const td = new TextDecoder();
export const b64u = {
  enc(b: Uint8Array) {
    let s = "";
    for (const x of b) s += String.fromCharCode(x);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  dec(s: string) {
    const t = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    return Uint8Array.from(t, (c) => c.charCodeAt(0));
  },
};
// Crockford base32 without I, L, O, U: readable short codes.
const ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function randomCode(len: number): string {
  const b = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(b, (x) => ALPHA[x & 31]).join("");
}
export const normCode = (s: string) =>
  s.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1").replace(/U/g, "V");
export const newKey = () => b64u.enc(crypto.getRandomValues(new Uint8Array(16)));
export class Box {
  private key: CryptoKey;
  private aad: Uint8Array;
  private constructor(key: CryptoKey, aad: Uint8Array) {
    this.key = key;
    this.aad = aad;
  }
  static async fromRaw(raw: Uint8Array, aad: string) {
    const key = await crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
    return new Box(key, te.encode(aad));
  }
  static fromKey(k: string, aad: string) {
    return Box.fromRaw(b64u.dec(k), aad);
  }
  /** Key derived from a short code (lobby): PBKDF2, so guessing codes offline is slow. */
  static async fromCode(code: string, aad: string) {
    const base = await crypto.subtle.importKey("raw", te.encode(code), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: te.encode("schwarm-lobby-v1"), iterations: 150000 },
      base,
      { name: "AES-GCM", length: 128 },
      false,
      ["encrypt", "decrypt"],
    );
    return new Box(key, te.encode(aad));
  }
  async seal(obj: unknown): Promise<Uint8Array> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: this.aad as BufferSource }, this.key, te.encode(JSON.stringify(obj))));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv);
    out.set(ct, 12);
    return out;
  }
  /** null if the message was not made with this key (foreign or tampered). */
  async open<T = unknown>(data: Uint8Array): Promise<T | null> {
    if (data.length < 29) return null;
    try {
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.subarray(0, 12) as BufferSource, additionalData: this.aad as BufferSource }, this.key, data.subarray(12) as BufferSource);
      return JSON.parse(td.decode(pt)) as T;
    } catch {
      return null;
    }
  }
}
/** Topic id for the lobby of a short code: a hash, so the broker never sees the code. */
export async function codeTopic(code: string) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(`schwarm-lobby:${code}`)));
  return b64u.enc(h.subarray(0, 12));
}
