const { test, expect } = require('@playwright/test');

// Das KI-Modell (WebLLM) braucht WebGPU, das es im Headless-Chromium nicht
// gibt. Wir gaukeln WebGPU vor und ersetzen die Engine durch eine schlanke
// Fake-Antwort (window.__AI_MOCK), die js/aiengine.js bevorzugt nutzt. So
// lassen sich Oberfläche, Gedächtnis und das Übernehmen in die Bemerkung
// testen – ohne echten Modell-Download.
async function injectFakeAI(page) {
  await page.addInitScript(() => {
    try { Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true }); } catch {}
    window.__AI_MOCK = {
      chatStream(messages, onToken) {
        const last = messages[messages.length - 1].content || '';
        const reply = 'Antwort auf: ' + last.slice(0, 30);
        for (const ch of reply) { if (onToken) onToken(ch); }
        return Promise.resolve(reply);
      },
    };
  });
}

test('KI-Assistent: Knopf öffnet Chat und beantwortet eine Frage', async ({ page }) => {
  await injectFakeAI(page);
  await page.goto('/');

  await expect(page.locator('#fabChat')).toBeVisible();
  await page.click('#fabChat');
  await expect(page.locator('#chatModal')).toHaveClass(/open/);

  await page.fill('#chatInput', 'Was ist eine Reklamation?');
  await page.click('#chatSend');

  await expect(page.locator('#chatMessages .msg-user')).toContainText('Was ist eine Reklamation?');
  await expect(page.locator('#chatMessages .msg-ai')).toContainText('Antwort auf:');
});

test('KI-Assistent: lernt per „merke dir“ und zeigt es im Gedächtnis', async ({ page }) => {
  await injectFakeAI(page);
  await page.goto('/');
  await page.click('#fabChat');

  await page.fill('#chatInput', 'merke dir: Kunde Müller bekommt PDFs ohne Fotos');
  await page.click('#chatSend');

  await expect(page.locator('#chatMessages .msg-ai')).toContainText('Gemerkt');

  await page.click('#chatMemToggle');
  await expect(page.locator('#chatMemPanel')).toHaveClass(/open/);
  await expect(page.locator('#chatMemList')).toContainText('Kunde Müller bekommt PDFs ohne Fotos');

  // Vergessen-Knopf entfernt den Eintrag wieder
  await page.click('#chatMemList .chat-mem-del');
  await expect(page.locator('#chatMemList')).toContainText('Noch nichts gemerkt');
});

test('KI-Assistent: Schnellaktion schreibt Ergebnis in die Bemerkung', async ({ page }) => {
  await injectFakeAI(page);
  await page.goto('/');

  await page.fill('#bemerkung', 'Werkstück hat Riss an der Kante, Maß außerhalb Toleranz.');
  await page.click('#fabChat');

  await page.click('.chat-quick button[data-kind="summary"]');
  await expect(page.locator('#chatMessages .msg-user')).toContainText('Bemerkung kürzen');
  await expect(page.locator('#chatMessages .msg-ai')).toContainText('Antwort auf:');

  // Antwort in die Bemerkung übernehmen (wird angehängt)
  await page.click('#chatMessages .msg-ai [data-act="toBemerkung"]');
  await expect(page.locator('#bemerkung')).toHaveValue(/Werkstück hat Riss[\s\S]*Antwort auf:/);
});

test('KI-Assistent: Handy bekommt automatisch ein kleines Modell', async ({ page }, testInfo) => {
  await injectFakeAI(page);
  await page.goto('/');
  await page.click('#fabChat');

  // Das Handy-Modell steht immer zur Auswahl …
  await expect(page.locator('#chatModel option[value="winzig"]')).toHaveCount(1);

  // … und ist auf dem Handy automatisch vorgewählt (Desktop: starkes Modell).
  const val = await page.locator('#chatModel').inputValue();
  if (testInfo.project.name.includes('mobile')) expect(val).toBe('winzig');
  else expect(val).toBe('standard');
});

test('KI-Assistent: Schnellaktion ohne Bemerkung gibt Hinweis', async ({ page }) => {
  await injectFakeAI(page);
  await page.goto('/');
  await page.click('#fabChat');

  await page.click('.chat-quick button[data-kind="bullets"]');
  await expect(page.locator('#toast')).toContainText('Bemerkungsfeld');
});
