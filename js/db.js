// IndexedDB-Wrapper – speichert alle Dokumentationen lokal auf dem Gerät
const DB_NAME = 'techdoku';
const DB_VERSION = 1;
const STORE = 'docs';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('updatedAt', 'updatedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const res = fn(store);
    t.oncomplete = () => resolve(res?.result ?? res);
    t.onerror = () => reject(t.error);
  });
}

export const DB = {
  async save(doc) {
    doc.updatedAt = Date.now();
    if (!doc.id) doc.id = 'doc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    if (!doc.createdAt) doc.createdAt = doc.updatedAt;
    await tx('readwrite', (s) => s.put(doc));
    return doc;
  },
  async all() {
    const docs = await tx('readonly', (s) => {
      return new Promise((resolve) => {
        const out = [];
        s.openCursor().onsuccess = (e) => {
          const cur = e.target.result;
          if (cur) { out.push(cur.value); cur.continue(); }
          else resolve(out);
        };
      });
    });
    return docs.sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async get(id) {
    return tx('readonly', (s) => new Promise((r) => { s.get(id).onsuccess = (e) => r(e.target.result); }));
  },
  async remove(id) {
    return tx('readwrite', (s) => s.delete(id));
  }
};
