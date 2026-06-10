const { test, expect } = require('@playwright/test');

// Testet die Scan-Übernahme-UI ohne echtes (langsames) OCR: Wir stubben das
// scan-Modul über einen Import-Map-Eintrag, der vor dem App-Modul injiziert wird.
const STUB = `
export async function scanArbeitskarte(_dataUrl, onProgress) {
  if (onProgress) { onProgress(0.5); onProgress(1); }
  return { confidence: 60, hits: 7, text: 'stub', fields: {
    kunde: 'Andritz Hydro GmbH - Ravensburg',
    abnr: 'AB260327',
    position: '2',
    zeichnungsnummer: '704097971',
    teilebenennung: 'Sensor Kontakt',
    index: '0',
    stueckzahl: '48',
    datum: '27.05.2026',
    datumIso: '2026-05-27'
  }};
}
export function prewarmScanner() {}
export async function disposeScanner() {}
`;

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test.beforeEach(async ({ page }) => {
  // scan.js durch Stub ersetzen, bevor die App lädt
  await page.route('**/js/scan.js', (route) => route.fulfill({ contentType: 'text/javascript', body: STUB }));
});

test('Scan-Übernahme füllt die erkannten Felder ins Formular', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.scan-card')).toBeVisible();

  await page.setInputFiles('#scanInput', { name: 'karte.jpg', mimeType: 'image/jpeg', buffer: PNG });
  await expect(page.locator('#scanSheet')).toHaveClass(/open/);

  // Alle erkannten Felder werden angeboten (inkl. Position & Index)
  await expect(page.locator('#scanResults .scan-row')).toHaveCount(8);

  await page.click('#scanApply');
  await expect(page.locator('#scanSheet')).not.toHaveClass(/open/);

  await expect(page.locator('#kunde')).toHaveValue('Andritz Hydro GmbH - Ravensburg');
  await expect(page.locator('#abnr')).toHaveValue('AB260327');
  await expect(page.locator('#position')).toHaveValue('2');
  await expect(page.locator('#zeichnungsnummer')).toHaveValue('704097971');
  await expect(page.locator('#index')).toHaveValue('0');
  await expect(page.locator('#teilebenennung')).toHaveValue('Sensor Kontakt');
  await expect(page.locator('#stueckzahl')).toHaveValue('48');
  await expect(page.locator('#datum')).toHaveValue('2026-05-27');
});

test('Galerie-Eingang löst die Auto-Erkennung ebenfalls aus', async ({ page }) => {
  await page.goto('/');
  // Bild aus der Galerie (kein capture) statt Kamera
  expect(await page.locator('#scanGalleryInput').getAttribute('capture')).toBeNull();
  await page.setInputFiles('#scanGalleryInput', { name: 'gespeicherte_karte.jpg', mimeType: 'image/jpeg', buffer: PNG });
  await expect(page.locator('#scanSheet')).toHaveClass(/open/);
  await expect(page.locator('#scanResults .scan-row')).toHaveCount(8);
});

test('abgewählte Felder werden nicht übernommen', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#scanInput', { name: 'karte.jpg', mimeType: 'image/jpeg', buffer: PNG });
  await expect(page.locator('#scanSheet')).toHaveClass(/open/);

  // Kunde abwählen
  await page.locator('#scanResults input[data-key=kunde]').uncheck();
  await page.click('#scanApply');

  await expect(page.locator('#kunde')).toHaveValue('');
  await expect(page.locator('#abnr')).toHaveValue('AB260327');
});

test('Abbrechen verwirft die Übernahme', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#scanInput', { name: 'karte.jpg', mimeType: 'image/jpeg', buffer: PNG });
  await expect(page.locator('#scanSheet')).toHaveClass(/open/);
  await page.click('#scanCancel');
  await expect(page.locator('#scanSheet')).not.toHaveClass(/open/);
  await expect(page.locator('#abnr')).toHaveValue('');
});
