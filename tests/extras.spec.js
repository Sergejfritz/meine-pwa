const { test, expect } = require('@playwright/test');

// Tests für Fortschrittsring, Verlauf (Vorlagen) und Erfolgs-Animation
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function fillValid(page) {
  await page.click('label[for=typRekl]');
  await page.fill('#kunde', 'Andritz Hydro GmbH');
  await page.fill('#maschine', 'CNC-500');
  await page.fill('#abnr', 'AB260327');
  await page.fill('#zeichnungsnummer', '704097971');
  await page.fill('#index', '0');
  await page.fill('#verantwortlich', 'S. Fritz');
  await page.fill('#teilebenennung', 'Sensor Kontakt');
  await page.fill('#stueckzahl', '48');
  await page.fill('#version', 'V2');
  await page.fill('#bemerkung', 'Test.');
  await page.setInputFiles('#galleryInput', { name: 'f.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('#photoGrid .thumb')).toHaveCount(1);
}

test('Install-Banner: versteckt ohne Prompt, erscheint bei beforeinstallprompt', async ({ page }) => {
  await page.goto('/');
  // Ohne Installierbarkeit (Desktop-Chromium, kein iOS) bleibt es versteckt
  await expect(page.locator('#installCard')).toBeHidden();

  // Android/Chrome-Verhalten simulieren
  const choice = await page.evaluate(() => {
    let prompted = false;
    const e = new Event('beforeinstallprompt');
    e.prompt = () => { prompted = true; };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
    window.__wasPrompted = () => prompted;
    return document.getElementById('installCard').classList.contains('hidden');
  });
  expect(choice).toBe(false); // Banner ist jetzt sichtbar
  await expect(page.locator('#installCard')).toBeVisible();

  // Klick löst das native Prompt aus
  await page.click('#installBtn');
  expect(await page.evaluate(() => window.__wasPrompted())).toBe(true);
});

test('Install-Banner: Schließen merkt sich die Entscheidung', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt');
    e.prompt = () => {}; e.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(e);
  });
  await expect(page.locator('#installCard')).toBeVisible();
  await page.click('#installClose');
  await expect(page.locator('#installCard')).toBeHidden();
  // Nach Reload bleibt es weg (Entscheidung gemerkt)
  await page.reload();
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt');
    e.prompt = () => {}; e.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(e);
  });
  await expect(page.locator('#installCard')).toBeHidden();
});

test('gültig befülltes Pflichtfeld bekommt einen grünen Impuls', async ({ page }) => {
  await page.goto('/');
  await page.fill('#kunde', 'Andritz Hydro GmbH');
  // Der Impuls (ok-flash) erscheint kurz nach gültiger Eingabe
  await expect(page.locator('#kunde')).toHaveClass(/ok-flash/);
});

test('Fortschrittsring steigt beim Ausfüllen und erreicht 100 %', async ({ page }) => {
  await page.goto('/');
  // Datum ist vorbelegt → Start > 0, aber klein
  const start = parseInt(await page.locator('#progressPct').textContent());
  expect(start).toBeLessThan(30);

  await fillValid(page);
  await expect(page.locator('#progressPct')).toHaveText('100%');
  await expect(page.locator('#progressRing')).toHaveClass(/done/);
});

test('Verlauf: nach PDF-Erstellung erscheint die Doku als Vorlage', async ({ page }) => {
  await page.goto('/');
  await fillValid(page);
  const dl = page.waitForEvent('download');
  await page.click('#btnPdf');
  await dl;

  // Erfolgs-Overlay erscheint und verschwindet von selbst
  await expect(page.locator('#successOverlay')).toBeVisible();
  await expect(page.locator('#successOverlay')).toBeHidden({ timeout: 5000 });

  // Verlauf zeigt den Eintrag
  await expect(page.locator('#historyCard')).toBeVisible();
  await expect(page.locator('.hist-txt strong').first()).toHaveText('Sensor Kontakt');

  // Verlauf überlebt einen Reload
  await page.reload();
  await expect(page.locator('#historyCard')).toBeVisible();
});

test('Verlauf: Antippen übernimmt die Daten als Vorlage (ohne Fotos)', async ({ page }) => {
  await page.goto('/');
  await fillValid(page);
  const dl = page.waitForEvent('download');
  await page.click('#btnPdf');
  await dl;
  await expect(page.locator('#successOverlay')).toBeHidden({ timeout: 5000 });

  // Formular leeren, dann Vorlage anwenden
  page.on('dialog', (d) => d.accept());
  await page.click('#btnNew');
  await expect(page.locator('#kunde')).toHaveValue('');

  await page.click('.hist-main');
  await expect(page.locator('#kunde')).toHaveValue('Andritz Hydro GmbH');
  await expect(page.locator('#zeichnungsnummer')).toHaveValue('704097971');
  await expect(page.locator('#typRekl')).toBeChecked();
  // Fotos kommen NICHT aus der Vorlage
  await expect(page.locator('#photoGrid .thumb')).toHaveCount(0);
});

test('Verlauf: Eintrag löschen entfernt ihn dauerhaft', async ({ page }) => {
  await page.goto('/');
  await fillValid(page);
  const dl = page.waitForEvent('download');
  await page.click('#btnPdf');
  await dl;
  await expect(page.locator('#successOverlay')).toBeHidden({ timeout: 5000 });

  await page.click('.hist-del');
  await expect(page.locator('#historyCard')).toBeHidden();
  await page.reload();
  await expect(page.locator('#historyCard')).toBeHidden();
});
