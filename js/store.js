// localStorage – Einstellungen, Eingabe-Vorschläge (Tipphilfe), Entwurf-Sicherung
// und ein kleiner Verlauf erstellter Dokumentationen (nur Textfelder als
// Vorlage zum Wiederverwenden – KEINE Fotos, bleibt also klein und schnell).
const KEY_SETTINGS = 'techdoku_settings';
const KEY_SUGGEST = 'techdoku_suggest';
const KEY_DRAFT = 'techdoku_draft';
const KEY_ZONES = 'techdoku_zones';

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

// Hinweis: Das frühere localStorage-"History" (nur Text) wurde durch das
// vollwertige Archiv (js/archive.js, IndexedDB inkl. Fotos) ersetzt.

// Scan-Vorlage: vom Nutzer auf einem Karten-Foto eingezeichnete Zonen.
// Pro Zone: { field, x, y, w, h } – x/y/w/h als Anteil 0..1 des Bildes (so
// unabhängig von der Auflösung). 'aspect' = Breite/Höhe des Kalibrier-Bildes,
// hilft beim Zuordnen der richtigen Foto-Ausrichtung. 'image' = verkleinerte
// Karte zum erneuten Bearbeiten/Anzeigen.
export const Zones = {
  get() { return read(KEY_ZONES); },
  save(items, aspect, image) {
    write(KEY_ZONES, { items: items || [], aspect: aspect || null, image: image || null, savedAt: Date.now() });
  },
  clear() { try { localStorage.removeItem(KEY_ZONES); } catch {} }
};
