const { test, expect } = require('@playwright/test');

// Sprachausgabe im Test durch eine Attrappe ersetzen, die mitschreibt, was gesprochen wird.
async function mockSpeech(page) {
  await page.addInitScript(() => {
    window.__spoken = [];
    const fake = {
      speaking: false,
      getVoices: () => [{ name: 'Deutsch', lang: 'de-DE', voiceURI: 'de-test', localService: true }],
      addEventListener() {},
      cancel() { this.speaking = false; },
      speak(u) {
        window.__spoken.push(u.text);
        setTimeout(() => u.onend && u.onend(), 20);
      },
    };
    Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
    window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  });
}

async function selectText(page, needle) {
  await page.evaluate((needle) => {
    const node = document.getElementById('reader').firstChild;
    const i = node.textContent.indexOf(needle);
    const r = document.createRange();
    r.setStart(node, i); r.setEnd(node, i + needle.length);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(r);
  }, needle);
}

test('Markieren zeigt den runden Knopf, Tippen liest die Markierung vor', async ({ page }) => {
  await mockSpeech(page);
  await page.goto('/vorlesen.html?text=' + encodeURIComponent('Hallo Welt. Das ist ein Test.'));
  await expect(page.locator('#reader')).toHaveText('Hallo Welt. Das ist ein Test.');

  const fab = page.locator('#speakFab');
  await expect(fab).not.toHaveClass(/show/);

  await selectText(page, 'Das ist ein Test.');
  await expect(fab).toHaveClass(/show/);

  await fab.click();
  await expect.poll(() => page.evaluate(() => window.__spoken)).toEqual(['Das ist ein Test.']);
});

test('Auswahl aufheben blendet den Knopf wieder aus', async ({ page }) => {
  await mockSpeech(page);
  await page.goto('/vorlesen.html?text=Eins%20zwei%20drei');
  await selectText(page, 'zwei');
  await expect(page.locator('#speakFab')).toHaveClass(/show/);
  await page.evaluate(() => window.getSelection().removeAllRanges());
  await expect(page.locator('#speakFab')).not.toHaveClass(/show/);
});

test('Alles vorlesen teilt langen Text in Sätze', async ({ page }) => {
  await mockSpeech(page);
  await page.goto('/vorlesen.html?text=' + encodeURIComponent('Erster Satz. Zweiter Satz! Dritter?'));
  await page.click('#readAllBtn');
  await expect.poll(() => page.evaluate(() => window.__spoken))
    .toEqual(['Erster Satz.', 'Zweiter Satz!', 'Dritter?']);
});

test('Manifest hat Teilen-Ziel', async ({ request }) => {
  const res = await request.get('/vorlesen.webmanifest');
  const m = await res.json();
  expect(m.share_target.params.text).toBe('text');
  expect(m.start_url).toBe('./vorlesen.html');
});

test('Runder Knopf sitzt unten rechts in der Ecke', async ({ page }) => {
  await mockSpeech(page);
  await page.goto('/vorlesen.html?text=Eins%20zwei%20drei');
  await selectText(page, 'zwei');
  const fab = page.locator('#speakFab');
  await expect(fab).toHaveClass(/show/);
  const box = await fab.boundingBox();
  const vp = page.viewportSize();
  expect(vp.width - (box.x + box.width)).toBeLessThan(40);
  expect(vp.height - (box.y + box.height)).toBeLessThan(60);
});
