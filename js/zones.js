// Hilfsfunktionen für die Scan-Vorlage (Zonen-OCR).
// Reines Parsing/Canvas – kein Netz. Wird sowohl vom Scanner als auch vom
// Kalibrier-Dialog genutzt und ist daher gut testbar gehalten.

import { toIsoDate } from './cardparse.js';

// Felder, die per Kästchen belegbar sind (frei wählbar pro Zone).
export const ZONE_FIELDS = [
  { key: 'abnr', label: 'AB-Nr.' },
  { key: 'position', label: 'Position' },
  { key: 'zeichnungsnummer', label: 'Zeichnungsnr.' },
  { key: 'index', label: 'Index' },
  { key: 'kunde', label: 'Kunde' },
  { key: 'teilebenennung', label: 'Benennung der Teile' },
  { key: 'stueckzahl', label: 'Stückzahl' },
  { key: 'datum', label: 'Datum' },
];

export function zoneLabel(key) {
  return (ZONE_FIELDS.find((f) => f.key === key) || {}).label || key;
}

// Bereinigt den (verrauschten) OCR-Text einer Zone passend zum Feldtyp.
export function cleanZoneValue(field, raw) {
  const t = (raw || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  switch (field) {
    case 'abnr': {
      const m = t.match(/AB\s?\d{5,9}/i);
      if (m) return m[0].replace(/\s+/g, '').toUpperCase();
      const d = t.match(/\d{5,9}/);
      return d ? 'AB' + d[0] : '';
    }
    case 'position': {
      const m = t.match(/\d{1,3}/);
      return m ? m[0] : '';
    }
    case 'zeichnungsnummer': {
      const nums = t.match(/\d{5,12}/g) || [];
      nums.sort((a, b) => b.length - a.length);
      return nums[0] || '';
    }
    case 'index': {
      const m = t.match(/[0-9A-Da-d]/);
      return m ? m[0].toUpperCase() : '';
    }
    case 'stueckzahl': {
      const m = t.match(/\d{1,5}/);
      return m ? m[0] : '';
    }
    case 'datum': {
      const m = t.match(/\d{2}\.\d{2}\.\d{4}/);
      return m ? m[0] : '';
    }
    default:
      // Text-Felder (Kunde, Benennung): erste sinnvolle Zeile
      return t.split('\n')[0].replace(/[|]+/g, ' ').trim();
  }
}

// Schneidet eine Zone aus dem (aufrecht gedrehten) Karten-Canvas heraus und
// vergrößert sie für bessere OCR der kleinen Schrift.
export function cropZone(canvas, zone, scale = 2) {
  const sx = Math.max(0, zone.x * canvas.width);
  const sy = Math.max(0, zone.y * canvas.height);
  const sw = Math.min(canvas.width - sx, zone.w * canvas.width);
  const sh = Math.min(canvas.height - sy, zone.h * canvas.height);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

// Liest alle Zonen per Worker aus und liefert die erkannten Felder.
// recognize: async (canvas) => text   (entkoppelt von Tesseract → testbar)
export async function readZones(canvas, items, recognize) {
  const fields = {};
  for (const z of items) {
    let text = '';
    try { text = await recognize(cropZone(canvas, z)); } catch { text = ''; }
    const val = cleanZoneValue(z.field, text);
    if (val) fields[z.field] = val;
  }
  if (fields.datum) fields.datumIso = toIsoDate(fields.datum);
  return fields;
}
