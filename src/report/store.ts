// Past nights on this device only: IndexedDB "schwarm" → store "parties" (keyPath id).
import type { PartyRecord } from "./model.ts";
const DB = "schwarm";
const STORE = "parties";
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error ?? new Error("IndexedDB nicht verfügbar"));
  });
  return dbp;
}
function req<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((res, rej) => {
        const tx = d.transaction(STORE, mode);
        const r = f(tx.objectStore(STORE));
        tx.oncomplete = () => res(r.result as T);
        tx.onerror = () => rej(tx.error);
        tx.onabort = () => rej(tx.error);
      }),
  );
}
export const putParty = (p: PartyRecord) => req<IDBValidKey>("readwrite", (s) => s.put(p));
export const getParty = (id: string) => req<PartyRecord | undefined>("readonly", (s) => s.get(id));
export const deleteParty = (id: string) => req<undefined>("readwrite", (s) => s.delete(id));
export async function listParties(): Promise<PartyRecord[]> {
  const all = await req<PartyRecord[]>("readonly", (s) => s.getAll());
  return all.sort((a, b) => b.startedAt - a.startedAt);
}
