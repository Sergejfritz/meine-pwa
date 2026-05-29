const { test, expect } = require('@playwright/test');

// Echter OCR-Text der Beispiel-Arbeitskarte (Andritz Hydro), wie von Tesseract
// erkannt – stabile Grundlage für den Parser-Test. Der Parser wird im Browser
// als echtes ES-Modul geladen.
const SAMPLE = `Arbeitskarte
Auftrags-Nr.: AB260327 Standard Kunde: Andritz Hydro GmbH - Ravensburg
Benennung Zeichnungs-Nr. Stk Liefertermin
Nr. 2 Sensor Kontakt 704097971 48 |27.05.2026 (KW 22)
Auftragsbezeichnung Artikel-Nr.
Material 1.4301
Flachmaterial h11 blank
15x40 x 34 mm
48 Stück sägen`;

async function parseInBrowser(page, text) {
  await page.goto('/');
  return page.evaluate(async (t) => {
    const { parseArbeitskarte, toIsoDate } = await import('/js/cardparse.js');
    const r = parseArbeitskarte(t);
    r._iso = toIsoDate(r.datum);
    return r;
  }, text);
}

test('extrahiert die Kernfelder der Arbeitskarte korrekt', async ({ page }) => {
  const r = await parseInBrowser(page, SAMPLE);
  expect(r.kunde).toBe('Andritz Hydro GmbH - Ravensburg');
  expect(r.abnr).toBe('AB260327');
  expect(r.zeichnungsnummer).toBe('704097971');
  expect(r.teilebenennung).toBe('Sensor Kontakt');
  expect(r.stueckzahl).toBe('48');
  expect(r.datum).toBe('27.05.2026');
  expect(r._iso).toBe('2026-05-27');
});

test('liefert leere Felder bei unbrauchbarem Text – ohne Fehler', async ({ page }) => {
  const r = await parseInBrowser(page, 'xxxxx keine daten hier');
  expect(r.abnr).toBe('');
  expect(r.zeichnungsnummer).toBe('');
  expect(r.kunde).toBe('');
});
