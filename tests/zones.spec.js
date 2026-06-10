const { test, expect } = require('@playwright/test');

// --- Reine Hilfsfunktionen (im Browser als ES-Modul geladen) ---
test('cleanZoneValue bereinigt je Feldtyp korrekt', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { cleanZoneValue } = await import('/js/zones.js');
    return {
      abnr: cleanZoneValue('abnr', 'Auftrag AB260327 x'),
      abnrDigits: cleanZoneValue('abnr', '260327'),
      position: cleanZoneValue('position', 'Pos 2von2'),
      zeichnung: cleanZoneValue('zeichnungsnummer', 'xx 704097971 0'),
      index: cleanZoneValue('index', ' 0 '),
      stk: cleanZoneValue('stueckzahl', '48 Stk'),
      datum: cleanZoneValue('datum', 'Liefertermin 27.05.2026 (KW22)'),
      kunde: cleanZoneValue('kunde', 'Andritz Hydro GmbH | Ravensburg'),
    };
  });
  expect(r.abnr).toBe('AB260327');
  expect(r.abnrDigits).toBe('AB260327');
  expect(r.position).toBe('2');
  expect(r.zeichnung).toBe('704097971');
  expect(r.index).toBe('0');
  expect(r.stk).toBe('48');
  expect(r.datum).toBe('27.05.2026');
  expect(r.kunde).toContain('Andritz Hydro GmbH');
});

test('readZones liest alle Zonen über die übergebene recognize-Funktion', async ({ page }) => {
  await page.goto('/');
  const fields = await page.evaluate(async () => {
    const { readZones } = await import('/js/zones.js');
    const cv = document.createElement('canvas'); cv.width = 100; cv.height = 100;
    const items = [
      { field: 'abnr', x: 0, y: 0, w: .5, h: .2 },
      { field: 'datum', x: 0, y: .3, w: .5, h: .2 },
    ];
    const map = { abnr: 'AB260327', datum: '27.05.2026' };
    let i = 0;
    const recognize = async () => (i++ === 0 ? map.abnr : map.datum);
    return readZones(cv, items, recognize);
  });
  expect(fields.abnr).toBe('AB260327');
  expect(fields.datum).toBe('27.05.2026');
  expect(fields.datumIso).toBe('2026-05-27');
});

// --- Kalibrier-Dialog: Foto wählen, Kästchen ziehen, speichern ---
async function loadBigPhoto(page) {
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 800;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 600, 800);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const file = new File([blob], 'card.png', { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(file);
    const input = document.getElementById('zoneInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => {
    const c = document.getElementById('zoneCanvas');
    return c && c.width > 100;
  });
}

test('Scan-Vorlage: Kästchen ziehen, speichern und Status anzeigen', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(2300); // Splash entfernt

  await page.click('#zoneSetup');
  await expect(page.locator('#zoneModal')).toHaveClass(/open/);

  await loadBigPhoto(page);

  // Kästchen über den Canvas ziehen (Feld = AB-Nr. als Default)
  const box = await page.locator('#zoneCanvas').boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.15);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.30);
  await page.mouse.up();

  await expect(page.locator('.zone-item')).toHaveCount(1);

  await page.click('#zoneSave');
  await expect(page.locator('#zoneModal')).not.toHaveClass(/open/);

  // In localStorage gespeichert
  const tpl = await page.evaluate(() => JSON.parse(localStorage.getItem('techdoku_zones')));
  expect(tpl.items.length).toBe(1);
  expect(tpl.items[0].field).toBe('abnr');

  // Status in der Scan-Karte zeigt die aktive Vorlage
  await expect(page.locator('#zoneStatus')).toContainText('aktiv');

  // Erneut öffnen lädt die Vorlage (Kästchen ist wieder da)
  await page.click('#zoneSetup');
  await expect(page.locator('.zone-item')).toHaveCount(1);
});
