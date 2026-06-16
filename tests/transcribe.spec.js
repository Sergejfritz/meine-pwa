const { test, expect } = require('@playwright/test');

// Die Live-Mitschrift nutzt die Web Speech API, die es im Headless-Chromium
// nicht gibt. Wir spielen vor dem Laden eine schlanke Fake-Erkennung ein,
// damit wir die Oberfläche und den Ablauf testen können.
async function injectFakeSpeech(page) {
  await page.addInitScript(() => {
    class FakeSR {
      constructor() { this.lang = ''; this.continuous = false; this.interimResults = false; window.__lastSR = this; }
      start() { this._on = true; if (this.onstart) this.onstart(); }
      stop() { this._on = false; if (this.onend) this.onend(); }
      abort() { this.stop(); }
    }
    window.SpeechRecognition = FakeSR;
  });
}

async function fireFinal(page, text) {
  await page.evaluate((t) => {
    const r = window.__lastSR;
    const item = Object.assign([{ transcript: t }], { isFinal: true });
    r.onresult({ resultIndex: 0, results: Object.assign([item], { length: 1 }) });
  }, text);
}

test('Live-Mitschrift: Knopf, Aufnahme, Live-Text und Speichern', async ({ page }) => {
  await injectFakeSpeech(page);
  await page.goto('/');

  // Schwebe-Knopf ist da (Spracherkennung vorhanden) und öffnet das Fenster
  await expect(page.locator('#fabRec')).toBeVisible();
  await page.click('#fabRec');
  await expect(page.locator('#trModal')).toBeVisible();

  // Aufnahme starten -> Status wechselt
  await page.click('#trToggle');
  await expect(page.locator('#trState')).toHaveText('Nimmt auf …');
  await expect(page.locator('#trDot')).toHaveClass(/live/);

  // Erkanntes Wort erscheint live
  await fireFinal(page, 'Reklamation an Maschine fünf');
  await expect(page.locator('#trText')).toContainText('Reklamation an Maschine fünf');

  // Stoppen
  await page.click('#trToggle');
  await expect(page.locator('#trState')).toHaveText('Pausiert');

  // Speichern legt einen Eintrag in der Liste an
  await page.click('#trSave');
  await expect(page.locator('#trList .tr-item')).toHaveCount(1);

  // In Bemerkung übernehmen schreibt den Text ins Formular
  await page.click('#trToBemerkung');
  await expect(page.locator('#trModal')).toBeHidden();
  await expect(page.locator('#bemerkung')).toHaveValue(/Reklamation an Maschine fünf/);
});

test('Live-Mitschrift: ohne Spracherkennung bleibt der Knopf verborgen', async ({ page }) => {
  await page.addInitScript(() => {
    try { delete window.SpeechRecognition; } catch {}
    try { delete window.webkitSpeechRecognition; } catch {}
    Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
  });
  await page.goto('/');
  await expect(page.locator('#fabRec')).toBeHidden();
});
