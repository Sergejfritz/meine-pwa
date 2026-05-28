// localStorage – Einstellungen (Theme) + Vorschläge für Auto-Vervollständigung
const KEY_SETTINGS = 'techdoku_settings';
const KEY_SUGGEST = 'techdoku_suggest';

export const Settings = {
  get() {
    try { return JSON.parse(localStorage.getItem(KEY_SETTINGS)) || {}; }
    catch { return {}; }
  },
  set(patch) {
    const s = { ...this.get(), ...patch };
    localStorage.setItem(KEY_SETTINGS, JSON.stringify(s));
    return s;
  }
};

// Merkt sich frühere Eingaben pro Feld (z.B. Kunden, Maschinen, Verantwortliche)
export const Suggest = {
  _all() {
    try { return JSON.parse(localStorage.getItem(KEY_SUGGEST)) || {}; }
    catch { return {}; }
  },
  get(field) {
    return (this._all()[field] || []);
  },
  remember(field, value) {
    value = (value || '').trim();
    if (!value) return;
    const all = this._all();
    const list = all[field] || [];
    const idx = list.findIndex((v) => v.toLowerCase() === value.toLowerCase());
    if (idx > -1) list.splice(idx, 1);
    list.unshift(value);
    all[field] = list.slice(0, 25); // nur die letzten 25 behalten
    localStorage.setItem(KEY_SUGGEST, JSON.stringify(all));
  }
};
