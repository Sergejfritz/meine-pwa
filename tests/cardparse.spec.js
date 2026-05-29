const { test, expect } = require('@playwright/test');

// Vereinfachter, sauberer Kopf (erste Karte).
const SAMPLE = `Arbeitskarte
Auftrags-Nr.: AB260327 Standard Kunde: Andritz Hydro GmbH - Ravensburg
Pos. 2 von 2 Benennung Zeichnungs-Nr. Index Stk Liefertermin
Nr. 2 Sensor Kontakt 704097971 0 48 27.05.2026 (KW 22)
Auftragsbezeichnung Artikel-Nr.
Arbeitsplan, Dokumentation, Selbstprüfung
Material 1.4301
48 Stück sägen
AKAB260327.2.10.1`;

// ECHTER, verrauschter OCR-Volltext des Fotos (inkl. Arbeitsplan-Teil mit
// Barcodes & Notizen). Der Parser MUSS die Kopffelder treffen und den
// Arbeitsplan-Teil (AKAB…, "Länge Sergej fragen", 4505003348) ignorieren.
const NOISY = `Ss Arbeitskarte SZ
=< Auftrage-NT) AB260327 Standard Kunde: Andritz Hydro GmbH - Ravensburg Kr
ss Pos. 2von2 |/ Benennung Zeichnungs-Nr. = 6 | Liefertermin PL
=— Nr. 2 Sensor Kontakt 704097971 0 27.05.2026 (KW 22) Er
SS <a ext. Bestell-Nr 4505003348/510 ZZ
— —Arbeitsplan, Dokumentation, Selbstprüfung:
ZZ AG-Nr. |Arbeitsgang | Arbeitsgang - Erläuterung
An AKAB260327.2.10.1 A
Material 1.4301
48 Stück sägen
Länge Sergej fragen
ma | akaBze0s27.2204`;

async function parseInBrowser(page, text) {
  await page.goto('/');
  return page.evaluate(async (t) => {
    const { parseArbeitskarte, toIsoDate } = await import('/js/cardparse.js');
    const r = parseArbeitskarte(t);
    r._iso = toIsoDate(r.datum);
    return r;
  }, text);
}

test('extrahiert die Kernfelder aus dem sauberen Kopf', async ({ page }) => {
  const r = await parseInBrowser(page, SAMPLE);
  expect(r.kunde).toBe('Andritz Hydro GmbH - Ravensburg');
  expect(r.abnr).toBe('AB260327');
  expect(r.position).toBe('2');
  expect(r.zeichnungsnummer).toBe('704097971');
  expect(r.teilebenennung).toBe('Sensor Kontakt');
  expect(r.datum).toBe('27.05.2026');
  expect(r._iso).toBe('2026-05-27');
});

test('liest den echten, verrauschten OCR-Text korrekt und ignoriert den Arbeitsplan', async ({ page }) => {
  const r = await parseInBrowser(page, NOISY);
  expect(r.abnr).toBe('AB260327');
  expect(r.position).toBe('2');
  expect(r.zeichnungsnummer).toBe('704097971'); // NICHT 4505003348 aus dem Bestell-Nr-Rauschen
  expect(r.kunde).toBe('Andritz Hydro GmbH - Ravensburg'); // ohne "Kr"-Rauschen
  expect(r.teilebenennung).toBe('Sensor Kontakt');
  expect(r.index).toBe('0');
  expect(r.datum).toBe('27.05.2026');
  // Barcode-Nummern dürfen nicht als Zeichnungsnr. auftauchen
  expect(r.zeichnungsnummer).not.toContain('260327');
});

test('liefert leere Felder bei unbrauchbarem Text – ohne Fehler', async ({ page }) => {
  const r = await parseInBrowser(page, 'xxxxx keine daten hier');
  expect(r.abnr).toBe('');
  expect(r.zeichnungsnummer).toBe('');
  expect(r.kunde).toBe('');
  expect(r.position).toBe('');
});
