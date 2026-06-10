// Archiv abgeschlossener Dokumentationen – inkl. Fotos. Nutzt IndexedDB, da
// Fotos (Daten-URLs) für localStorage zu groß wären. Rein lokal, kein Netz.

const DB = 'techdoku-db';
const STORE = 'docs';
const MAX = 40; // älteste darüber hinaus werden beim Speichern entfernt

function openDB() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}

function withStore(mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const out = fn(store);
    tx.oncomplete = () => resolve(out && out._result !== undefined ? out._result : out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const Archive = {
  async list() {
    return withStore('readonly', (store) => {
      const holder = {};
      store.getAll().onsuccess = (e) => { holder._result = (e.target.result || []).sort((a, b) => b.createdAt - a.createdAt); };
      return holder;
    });
  },
  async get(id) {
    return withStore('readonly', (store) => {
      const holder = {};
      store.get(id).onsuccess = (e) => { holder._result = e.target.result; };
      return holder;
    });
  },
  async add(rec) {
    await withStore('readwrite', (store) => { store.put(rec); });
    // Auf MAX begrenzen (älteste löschen)
    const all = await this.list();
    if (all.length > MAX) {
      const drop = all.slice(MAX);
      await withStore('readwrite', (store) => { drop.forEach((d) => store.delete(d.id)); });
    }
    return rec;
  },
  async remove(id) {
    return withStore('readwrite', (store) => { store.delete(id); });
  },
  async clear() {
    return withStore('readwrite', (store) => { store.clear(); });
  },
};
