const { test, expect } = require('@playwright/test');

// Tests für das Schlaflicht (licht.html)

async function open(page) {
  await page.goto('/licht.html');
  await expect(page.locator('#panel')).toBeVisible();
}

// wartet, bis die Fläche komplett schwarz ist (Ausblenden dauert kurz)
async function expectDark(page) {
  await expect
    .poll(async () => page.locator('#light').evaluate((n) => getComputedStyle(n).backgroundColor), { timeout: 5000 })
    .toBe('rgb(0, 0, 0)');
}

function rgb(str) {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(str || '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// Die Leuchtfläche blendet Farbwechsel weich über – deshalb warten, bis
// sich der Farbwert nicht mehr ändert.
async function lightRgb(page) {
  let prev = null;
  let same = 0;
  for (let i = 0; i < 30; i++) {
    const cur = rgb(await page.locator('#light').evaluate((n) => getComputedStyle(n).backgroundColor));
    same = prev && cur && cur.join() === prev.join() ? same + 1 : 0;
    if (same >= 3) return cur;
    prev = cur;
    await page.waitForTimeout(60);
  }
  return prev;
}

test('Licht leuchtet warm und lässt sich dimmen', async ({ page }) => {
  await open(page);

  const start = await lightRgb(page);
  expect(start).not.toBeNull();
  expect(start[0]).toBeGreaterThan(start[2]); // warm: mehr Rot als Blau
  expect(start[0]).toBeGreaterThan(0);

  // Heller
  await page.click('.mini[data-bright="100"]');
  const bright = await lightRgb(page);
  expect(bright[0]).toBeGreaterThan(start[0]);
  await expect(page.locator('#brightnessOut')).toHaveText('100 %');

  // Dunkler – die kleinste Stufe bleibt gerade noch sichtbar
  await page.click('.mini[data-bright="1"]');
  const dim = await lightRgb(page);
  expect(dim[0]).toBeLessThan(bright[0]);
  expect(dim[0]).toBeGreaterThan(0);

  // 0 % ist komplett aus
  await page.locator('#brightness').fill('0');
  await page.locator('#brightness').dispatchEvent('input');
  await expectDark(page);
});

test('Lichtfarbe: Vorlagen und eigene Farbe', async ({ page }) => {
  await open(page);
  await page.click('.mini[data-bright="100"]');

  await page.click('.chip[data-kelvin="6500"]');
  const cold = await lightRgb(page);
  await page.click('.chip[data-kelvin="1500"]');
  const warm = await lightRgb(page);
  expect(warm[2]).toBeLessThan(cold[2]); // Kerze hat deutlich weniger Blau
  await expect(page.locator('#kelvinOut')).toHaveText('1500 K');

  await page.click('.chip[data-color="#ff2d00"]');
  const red = await lightRgb(page);
  expect(red[0]).toBeGreaterThan(red[1]);
  expect(red[2]).toBeLessThan(30);
});

test('Einstellungen bleiben nach Neustart erhalten', async ({ page }) => {
  await open(page);
  await page.click('.mini[data-bright="10"]');
  await page.click('.chip[data-kelvin="2700"]');

  await page.reload();
  await expect(page.locator('#brightnessOut')).toHaveText('10 %');
  await expect(page.locator('#kelvinOut')).toHaveText('2700 K');
});

test('Einschlaf-Timer läuft und schaltet ab', async ({ page }) => {
  await open(page);
  await page.click('.chip[data-min="30"]');
  await expect(page.locator('#timerState')).toBeVisible();
  await expect(page.locator('#timerState')).toContainText('min');

  // Ablauf simulieren
  await page.evaluate(() => window.__licht.turnOff());
  await expect(page.locator('#offScreen')).toBeVisible();
  await expectDark(page);

  await page.click('#restartBtn');
  await expect(page.locator('#offScreen')).toBeHidden();
  const on = await lightRgb(page);
  expect(on[0]).toBeGreaterThan(0);
});

test('Sperre verhindert versehentliches Verstellen', async ({ page }) => {
  await open(page);
  await page.click('#lockBtn');
  await expect(page.locator('#panel')).toHaveClass(/faded/);

  // Tippen auf die Fläche holt die Bedienung nicht zurück
  await page.locator('#light').click({ position: { x: 30, y: 30 } });
  await expect(page.locator('#panel')).toHaveClass(/faded/);
  await expect(page.locator('#toast')).toContainText('Gesperrt');

  // Langer Druck entsperrt
  await page.locator('#light').dispatchEvent('pointerdown');
  await page.waitForTimeout(2300);
  await page.locator('#light').dispatchEvent('pointerup');
  await expect(page.locator('#panel')).not.toHaveClass(/faded/);
});

test('Bedienung blendet sich per Tippen aus und wieder ein', async ({ page }) => {
  await open(page);
  await page.locator('#light').click({ position: { x: 30, y: 30 } });
  await expect(page.locator('#panel')).toHaveClass(/faded/);
  await page.locator('#light').click({ position: { x: 30, y: 30 } });
  await expect(page.locator('#panel')).not.toHaveClass(/faded/);
});

test('Uhr lässt sich einblenden', async ({ page }) => {
  await open(page);
  await expect(page.locator('#clock')).toBeHidden();
  await page.locator('#showClock').check();
  await expect(page.locator('#clock')).toBeVisible();
  await expect(page.locator('#clock')).toHaveText(/^\d{2}:\d{2}$/);
});
