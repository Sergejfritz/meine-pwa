// Gedächtnis des KI-Assistenten – das "selbständige Lernen" ohne Server.
// Was der Nutzer der KI beibringt ("merke dir: …"), wird hier lokal gespeichert
// (IndexedDB, rein auf dem Gerät) und in jedem neuen Gespräch als Kontext
// vorangestellt. So wird der Assistent über die Zeit nützlicher, ohne je Daten
// nach außen zu senden. Aufbau analog zum Doku-Archiv (js/archive.js).

const DB = 'techdoku-ai';
const STORE = 'memory';
const MAX = 200; // älteste darüber hinaus werden beim Speichern entfernt

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

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export const Memory = {
  // Alle Einträge, neueste zuerst.
  async list() {
    return withStore('readonly', (store) => {
      const holder = {};
      store.getAll().onsuccess = (e) => { holder._result = (e.target.result || []).sort((a, b) => b.savedAt - a.savedAt); };
      return holder;
    });
  },

  // Nur die vom Nutzer beigebrachten Fakten (für den Gesprächs-Kontext).
  async facts() {
    return (await this.list()).filter((r) => r.kind === 'fact');
  },

  async add({ text, kind } = {}) {
    const rec = { id: newId(), text: String(text || '').trim(), kind: kind || 'fact', savedAt: Date.now() };
    if (!rec.text) return null;
    await withStore('readwrite', (store) => { store.put(rec); });
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

  // Kompakter System-Prompt-Block aus den gespeicherten Fakten.
  async buildContext() {
    const facts = await this.facts();
    if (!facts.length) return '';
    return 'Folgendes hat sich der Nutzer von dir merken lassen – berücksichtige es, wenn es passt:\n'
      + facts.map((f) => '- ' + f.text).join('\n');
  },
};

// Erkennt Lern-Befehle wie "merke dir: …", "lern …", "notiere …".
// Gibt den zu merkenden Text zurück (oder null).
export function detectTeach(text) {
  const m = String(text || '').match(/^\s*(?:merk(?:e)?\s+dir|lern(?:e)?|notiere|behalte)\b\s*[:,-]?\s*(.+)/is);
  return m ? m[1].trim() : null;
}
