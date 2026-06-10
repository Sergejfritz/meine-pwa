// localStorage – Einstellungen, Eingabe-Vorschläge (Tipphilfe), Entwurf-Sicherung
// und ein kleiner Verlauf erstellter Dokumentationen (nur Textfelder als
// Vorlage zum Wiederverwenden – KEINE Fotos, bleibt also klein und schnell).
const KEY_SETTINGS = 'techdoku_settings';
const KEY_SUGGEST = 'techdoku_suggest';
const KEY_DRAFT = 'techdoku_draft';
const KEY_HISTORY = 'techdoku_history';

function read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function write(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

export const Settings = {
  get() { return read(KEY_SETTINGS) || {}; },
  set(patch) { const s = { ...this.get(), ...patch }; write(KEY_SETTINGS, s); return s; }
};

// Merkt sich frühere Eingaben pro Feld (z.B. Kunden, Maschinen, Verantwortliche)
export const Suggest = {
  _all() { return read(KEY_SUGGEST) || {}; },
  get(field) { return this._all()[field] || []; },
  remember(field, value) {
    value = (value || '').trim();
    if (!value) return;
    const all = this._all();
    const list = (all[field] || []).filter((v) => v.toLowerCase() !== value.toLowerCase());
    list.unshift(value);
    all[field] = list.slice(0, 25);
    write(KEY_SUGGEST, all);
  }
};

// Entwurf der AKTUELLEN, noch nicht geteilten Eingabe (nur Textfelder, keine Fotos).
// Schützt vor Datenverlust, wenn die App versehentlich geschlossen wird.
export const Draft = {
  save(fields) {
    const hasContent = Object.entries(fields).some(([k, v]) => k !== 'datum' && String(v || '').trim());
    if (!hasContent) { this.clear(); return; }
    write(KEY_DRAFT, { fields, savedAt: Date.now() });
  },
  load() { return read(KEY_DRAFT); },
  clear() { try { localStorage.removeItem(KEY_DRAFT); } catch {} }
};

// Verlauf erstellter Dokus – dient als Vorlage für Wiederholteile.
// Pro Eintrag nur die Textfelder + Zeitstempel (keine Bilder).
export const History = {
  list() { return read(KEY_HISTORY) || []; },
  add(fields) {
    const entry = { id: 'h' + Date.now(), fields, createdAt: Date.now() };
    const list = [entry, ...this.list()].slice(0, 25);
    write(KEY_HISTORY, list);
    return entry;
  },
  remove(id) {
    write(KEY_HISTORY, this.list().filter((e) => e.id !== id));
  },
  clear() { try { localStorage.removeItem(KEY_HISTORY); } catch {} }
};
