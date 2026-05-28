const { test, expect } = require('@playwright/test');

// 1x1 JPEG/PNG als Test-Foto
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function addPhoto(page, n = 1) {
  const files = Array.from({ length: n }, (_, i) => ({ name: `f${i}.png`, mimeType: 'image/png', buffer: PNG }));
  await page.setInputFiles('#photoInput', files);
  await expect(page.locator('#photoGrid .thumb')).toHaveCount(n);
}

async function fillValid(page, { typ = 'typRekl' } = {}) {
  await page.click(`label[for=${typ}]`);
  await page.fill('#kunde', 'Mustermann GmbH');
  await page.fill('#maschine', 'CNC-500');
  await page.fill('#abnr', '12345');
  await page.fill('#zeichnungsnummer', 'ZN-987');
  await page.fill('#index', 'A');
  await page.fill('#verantwortlich', 'S. Fritz');
  await page.fill('#teilebenennung', 'Welle');
  await page.fill('#stueckzahl', '4');
  if (typ === 'typRekl') await page.fill('#version', 'V2');
  else await page.fill('#spanndruck', '120 bar');
  await page.fill('#bemerkung', 'Testbemerkung.');
  await addPhoto(page, 1);
}

test('lädt ohne Konsolenfehler und zeigt die Überschrift', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.brand-text h1')).toHaveText('Technische Dokumentation');
  await expect(page.locator('.brand-logo svg')).toBeVisible();
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});

test('Validierung markiert leere Pflichtfelder', async ({ page }) => {
  await page.goto('/');
  await page.click('#btnPdf');
  await expect(page.locator('#errorBox')).toBeVisible();
  await expect(page.locator('#kunde')).toHaveClass(/invalid/);
  await expect(page.locator('.seg')).toHaveClass(/invalid/);
  await expect(page.locator('#photoMsg')).toBeVisible();
  // Korrektur entfernt die Markierung
  await page.fill('#kunde', 'Test');
  await expect(page.locator('#kunde')).not.toHaveClass(/invalid/);
});

test('erzeugt ein PDF mit korrektem Dateinamen', async ({ page }) => {
  await page.goto('/');
  await fillValid(page);
  const dl = page.waitForEvent('download');
  await page.click('#btnPdf');
  const download = await dl;
  expect(download.suggestedFilename()).toBe('AB12345_ZZN-987_IA_' + new Date().toISOString().slice(0, 10) + '.pdf');
});

test('Teilen erzeugt im Desktop-Browser einen PDF-Download (Fallback)', async ({ page }) => {
  await page.goto('/');
  await fillValid(page, { typ: 'typFert' });
  const dl = page.waitForEvent('download');
  await page.click('#btnShare');
  const download = await dl;
  expect(download.suggestedFilename()).toContain('.pdf');
});

test('Theme-Umschalter wechselt und bleibt nach Reload erhalten', async ({ page }) => {
  await page.goto('/');
  await page.click('#themeToggle');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('Auftragstyp blendet das passende Zusatzfeld ein', async ({ page }) => {
  await page.goto('/');
  await page.click('label[for=typRekl]');
  await expect(page.locator('#versionField')).toBeVisible();
  await expect(page.locator('#spanndruckField')).toBeHidden();
  await page.click('label[for=typFert]');
  await expect(page.locator('#spanndruckField')).toBeVisible();
  await expect(page.locator('#versionField')).toBeHidden();
});

test('Fotos: Hinzufügen, Zähler, Sortieren und Löschen', async ({ page }) => {
  await page.goto('/');
  await addPhoto(page, 3);
  await expect(page.locator('#photoCount')).toHaveText('3 / 9');
  // erstes Thumbnail kann nicht nach vorne, letztes nicht nach hinten
  await expect(page.locator('.thumb').first().locator('[data-act=left]')).toBeDisabled();
  await expect(page.locator('.thumb').last().locator('[data-act=right]')).toBeDisabled();
  // löschen
  await page.locator('.thumb').first().locator('[data-act=del]').click();
  await expect(page.locator('#photoGrid .thumb')).toHaveCount(2);
  await expect(page.locator('#photoCount')).toHaveText('2 / 9');
});

test('Entwurf wird nach versehentlichem Schließen wiederhergestellt', async ({ page }) => {
  await page.goto('/');
  await page.fill('#kunde', 'Entwurf AG');
  await page.fill('#abnr', '999');
  await page.waitForTimeout(800); // Debounce abwarten
  await page.reload();
  await expect(page.locator('#draftBanner')).toBeVisible();
  await expect(page.locator('#kunde')).toHaveValue('Entwurf AG');
  await expect(page.locator('#abnr')).toHaveValue('999');
  // Verwerfen leert das Formular
  await page.click('#draftDiscard');
  await expect(page.locator('#draftBanner')).toBeHidden();
  await expect(page.locator('#kunde')).toHaveValue('');
});

test('Foto-Editor öffnet, zeichnet und schließt', async ({ page }) => {
  await page.goto('/');
  await addPhoto(page, 1);
  await page.locator('.thumb [data-act=edit]').click();
  await expect(page.locator('#annoModal')).toHaveClass(/open/);
  const box = await page.locator('#annoCanvas').boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 60, { steps: 5 });
  await page.mouse.up();
  await page.click('#annoSave');
  await expect(page.locator('#annoModal')).not.toHaveClass(/open/);
  await expect(page.locator('#photoGrid .thumb')).toHaveCount(1);
});

test('Vollbild-Vorschau öffnet und schließt', async ({ page }) => {
  await page.goto('/');
  await addPhoto(page, 1);
  await page.locator('.thumb img').click();
  await expect(page.locator('#lightbox')).toHaveClass(/open/);
  await page.click('#lightboxClose');
  await expect(page.locator('#lightbox')).not.toHaveClass(/open/);
});
