const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Tests für den Lotto-Simulator (/lotto/). Die Live-Quellen (WestLotto,
// LottoNumberArchive) werden gemockt – die Tests laufen komplett offline.
test.use({ serviceWorkers: 'block' });

const LINES = fs.readFileSync(path.join(__dirname, '..', 'lotto', 'ziehungen.txt'), 'utf8').trim().split('\n');
const BUNDLED_LAST = LINES[LINES.length - 1].slice(0, 10);

// nächster Mittwoch/Samstag nach der letzten mitgelieferten Ziehung
function naechsterZiehungstag(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1); while (![3, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}
const NEU = naechsterZiehungstag(BUNDLED_LAST);
const deDatum = (iso) => iso.split('-').reverse().join('.');
const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function westlotto(datum, nums, sz, waehrung = 'EUR') {
  return {
    error: null,
    head: { datum, folgeZiehung: { datum: naechsterZiehungstag(datum), annahmeschluss: `${naechsterZiehungstag(datum)}T18:00:00+02:00` } },
    zahlen: { hauptlotterie: { ziehungen: [{ zahlenSortiert: nums.map(String), superzahl: sz === null ? '' : String(sz), zusatzzahl: '' }] } },
    auswertung: { quoten: { hauptlotterie: { ziehungen: [{ waehrung, gewinnklassen: [
      { klasse: 1, kurzbeschreibung: '6 + SZ', anzahl: 0, quote: 0, jackpot: 5842000.2 },
      { klasse: 2, kurzbeschreibung: '6', anzahl: 2, quote: 302528.1, jackpot: null },
      { klasse: 3, kurzbeschreibung: '5 + SZ', anzahl: 33, quote: 13028.5, jackpot: null },
      { klasse: 4, kurzbeschreibung: '5', anzahl: 316, quote: 4055.5, jackpot: null },
      { klasse: 5, kurzbeschreibung: '4 + SZ', anzahl: 1406, quote: 252.8, jackpot: null },
      { klasse: 6, kurzbeschreibung: '4', anzahl: 15807, quote: 53.3, jackpot: null },
      { klasse: 7, kurzbeschreibung: '3 + SZ', anzahl: 25745, quote: 27.9, jackpot: null },
      { klasse: 8, kurzbeschreibung: '3', anzahl: 286271, quote: 11.8, jackpot: null },
      { klasse: 9, kurzbeschreibung: '2 + SZ', anzahl: 194811, quote: 6, jackpot: null },
    ] }] } } },
  };
}
const KEINE_DATEN = { error: 'Für den gewählten Ziehungstag liegen keine Daten vor.', head: null };
const isWestlotto = (url) => url.hostname === 'www.westlotto.de';
const isArchiv = (url) => url.hostname === 'johannesfriedrich.github.io';

// Standard: WestLotto liefert eine neue Ziehung (1 2 3 4 5 6, SZ 7) und für
// Datumsabfragen Quoten in DM (vor 2002) bzw. Euro.
async function mockLive(page, { latest = true } = {}) {
  await page.route(isWestlotto, (route) => {
    const datum = new URL(route.request().url()).searchParams.get('datum');
    let body;
    if (!datum) body = latest ? westlotto(NEU, [1, 2, 3, 4, 5, 6], 7) : KEINE_DATEN;
    else if (datum === NEU) body = westlotto(NEU, [1, 2, 3, 4, 5, 6], 7);
    else body = westlotto(datum, [7, 8, 9, 10, 11, 12], null, datum < '2002' ? 'DM' : 'EUR');
    route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  });
  await page.route(isArchiv, (route) => route.abort());
}

async function tippe(page, text) {
  await page.fill('#tipInput', text);
  await expect(page.locator('#tipHint')).toContainText('6 Zahlen gewählt');
}

test('lädt alle Ziehungen und holt die neueste Ziehung live von WestLotto', async ({ page }) => {
  await mockLive(page);
  await page.goto('/lotto/');
  await expect(page.locator('#dataInfo')).toContainText('1955–');
  await expect(page.locator('#dataInfo .live-dot')).toBeVisible();

  await page.click('[data-tab=archiv]');
  await expect(page.locator('#lastDraw .when')).toContainText(deDatum(NEU));
  await expect(page.locator('#lastDraw .ball:not(.sz)')).toHaveText(['1', '2', '3', '4', '5', '6']);
  // echte Quoten der letzten Ziehung + Annahmeschluss
  await expect(page.locator('#lastDraw table.quoten')).toContainText('11,80 €');
  await expect(page.locator('#lastDraw')).toContainText(`Nächste Ziehung: ${WT[new Date(`${naechsterZiehungstag(NEU)}T12:00:00Z`).getUTCDay()]}, ${deDatum(naechsterZiehungstag(NEU))}`);
  await expect(page.locator('#lastDraw')).toContainText('Annahmeschluss');

  // die neue Ziehung wird für den Tipp mitgeprüft
  await page.click('[data-tab=tipp]');
  await tippe(page, '1 2 3 4 5 6');
  await page.click('#szPicker button[data-sz="7"]');
  await expect(page.locator('.verdict')).toContainText('Jackpot');
  await expect(page.locator('.verdict')).toContainText(deDatum(NEU));

  // gespeichert → auch nach dem Neuladen ohne Netz noch da
  await page.unroute(isWestlotto);
  await page.route(isWestlotto, (route) => route.abort());
  await page.reload();
  await page.click('[data-tab=archiv]');
  await expect(page.locator('#lastDraw .when')).toContainText(deDatum(NEU));
});

test('Ersatzquelle: ohne WestLotto werden neue Ziehungen aus dem Archiv geladen', async ({ page }) => {
  await page.route(isWestlotto, (route) => route.abort());
  const [d, m, y] = deDatum(NEU).split('.');
  await page.route(isArchiv, (route) => route.fulfill({
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ data: [{ id: 1, date: `${d}.${m}.${y}`, Lottozahl: [44, 9, 17, 23, 31, 40], Superzahl: 3 }] }),
  }));
  await page.goto('/lotto/');
  await page.click('[data-tab=archiv]');
  await expect(page.locator('#lastDraw .when')).toContainText(deDatum(NEU));
  await expect(page.locator('#updateStatus')).toContainText('LottoNumberArchive');
});

test('ohne Verbindung: gespeicherte Ziehungen bleiben nutzbar', async ({ page }) => {
  await page.route(isWestlotto, (route) => route.abort());
  await page.route(isArchiv, (route) => route.abort());
  await page.goto('/lotto/');
  await page.click('[data-tab=archiv]');
  await page.click('#btnUpdate');
  await expect(page.locator('#updateStatus')).toContainText('Keine Verbindung');
  await expect(page.locator('#lastDraw .when')).toContainText(deDatum(BUNDLED_LAST));
});

test('Tipp eintippen: erste Ziehung 1955 wird als 6 Richtige erkannt, inkl. echter Quote', async ({ page }) => {
  await mockLive(page, { latest: false });
  await page.goto('/lotto/');
  await tippe(page, '3, 12, 13, 16, 23, 41');
  const verdict = page.locator('.verdict');
  await expect(verdict).toContainText('6 Richtige');
  await expect(verdict).toContainText('09.10.1955');

  // Jahres-Übersicht: 1955 = höchste Stufe; antippen öffnet das Jahr
  const y1955 = page.locator('#yearStrip button[data-jahr="1955"]');
  await expect(y1955).toHaveAttribute('data-lvl', '4');
  await y1955.click();
  await expect(page.locator('#jahr-1955')).toHaveAttribute('open', '');

  // echte Auszahlung (damals in DM) wird live nachgeladen
  const erster = page.locator('.top-wins .win-row').first();
  await expect(erster).toContainText('09.10.1955');
  await expect(erster.locator('.real')).toContainText('Damals: 6 Richtige');
  await expect(erster.locator('.real')).toContainText('DM');
});

test('Eingabe prüft ungültige und doppelte Zahlen', async ({ page }) => {
  await mockLive(page, { latest: false });
  await page.goto('/lotto/');
  await page.fill('#tipInput', '3 50 3');
  await expect(page.locator('#tipHint')).toContainText('50 ist keine Lottozahl');
  await expect(page.locator('#tipHint')).toContainText('3 doppelt');
  await expect(page.locator('#tipGrid button[aria-pressed=true]')).toHaveCount(1);
});

test('Lottoschein antippen, Superzahl, Quicktipp und gemerkte Tipps', async ({ page }) => {
  await mockLive(page, { latest: false });
  await page.goto('/lotto/');
  for (const n of [5, 9, 17, 22, 38, 44]) await page.click(`#tipGrid button[data-n="${n}"]`);
  await expect(page.locator('#tipInput')).toHaveValue('5 9 17 22 38 44');
  await page.click('#tipGrid button[data-n="1"]'); // 7. Zahl geht nicht
  await expect(page.locator('#tipHint')).toContainText('Schon 6 Zahlen');
  await page.click('#szPicker button[data-sz="3"]');
  await expect(page.locator('#szPicker button[data-sz="3"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.verdict')).toBeVisible();

  await page.click('#saveTip');
  await expect(page.locator('#favList')).toContainText('5 9 17 22 38 44 · SZ 3');

  await page.click('#quickTip');
  const quick = (await page.inputValue('#tipInput')).split(' ').map(Number);
  expect(new Set(quick).size).toBe(6);
  expect(quick.every((n) => n >= 1 && n <= 49)).toBe(true);

  // gemerkter Tipp + letzter Tipp überleben das Neuladen
  await page.reload();
  await expect(page.locator('#tipInput')).toHaveValue(quick.slice().sort((a, b) => a - b).join(' '));
  await page.click('#favList button[data-load="0"]');
  await expect(page.locator('#tipInput')).toHaveValue('5 9 17 22 38 44');
});

test('Archiv: Jahr wählen zeigt dessen Ziehungen', async ({ page }) => {
  await mockLive(page, { latest: false });
  await page.goto('/lotto/');
  await page.click('[data-tab=archiv]');
  await page.selectOption('#yearSelect', '1955');
  await expect(page.locator('#drawList .draw-row')).toHaveCount(12);
  await expect(page.locator('#drawList .draw-row').last()).toContainText('09.10.');
  await expect(page.locator('#drawList .draw-row').last().locator('.ball')).toHaveText(['3', '12', '13', '16', '23', '41']);
});

test('Statistik: Häufigkeit aller 49 Zahlen', async ({ page }) => {
  await mockLive(page, { latest: false });
  await page.goto('/lotto/');
  await page.click('[data-tab=statistik]');
  await expect(page.locator('#heat button')).toHaveCount(49);
  await page.click('#heat button[data-n="13"]');
  await expect(page.locator('#numInfo')).toContainText('Zahl 13');
  await page.selectOption('#statRange', '100');
  await expect(page.locator('#statInfo')).toContainText('100 Ziehungen');
  await expect(page.locator('#szBars .bar-row')).toHaveCount(10);
});

test('Simulator: einzelne Ziehung und Dauerlauf bis 4 Richtige', async ({ page }) => {
  await mockLive(page, { latest: false });
  await page.goto('/lotto/');
  await page.click('[data-tab=simulator]');
  await expect(page.locator('#btnLive')).toBeDisabled();
  await page.click('#simTip button[data-act=quick]');
  await page.click('#btnLive');
  await expect(page.locator('#liveBalls .ball')).toHaveCount(7);
  const gezogen = (await page.locator('#liveBalls .ball:not(.sz)').allTextContents()).map(Number);
  expect(new Set(gezogen).size).toBe(6);
  await expect(page.locator('#liveResult')).toContainText('Richtige');

  await page.selectOption('#simTarget', '6');
  await page.click('#btnSim');
  await expect(page.locator('#simMsg.done')).toContainText('Geschafft', { timeout: 20000 });
});

// ---------- Android-App (window.LottoApp wird von der App bereitgestellt) ----------
async function mockApp(page) {
  await page.addInitScript(() => {
    const log = [];
    let an = false;
    window.__appLog = log;
    window.LottoApp = {
      version: () => '1.0.test',
      theme: (t) => log.push(['theme', t]),
      tipps: (json) => log.push(['tipps', JSON.parse(json)]),
      benachrichtigungen: () => an,
      setBenachrichtigungen: (x, datum) => { an = x; log.push(['benachrichtigen', x, datum]); },
      testBenachrichtigung: () => log.push(['test']),
    };
  });
}
const appLog = (page, art) => page.evaluate((a) => window.__appLog.filter((e) => e[0] === a), art);

test('App: Benachrichtigungen schalten, Tipps und Theme gehen an die App', async ({ page }) => {
  await mockApp(page);
  await mockLive(page, { latest: false });
  await page.goto('/lotto/');
  await expect(page.locator('#apkLink')).toBeHidden(); // in der App kein Download-Hinweis

  await page.click('[data-tab=archiv]');
  await expect(page.locator('#appCard')).toBeVisible();
  await expect(page.locator('#appInfo')).toContainText('1.0.test');
  await page.click('#btnNotify');
  await expect(page.locator('#btnNotify')).toContainText('Ausschalten');
  const an = await appLog(page, 'benachrichtigen');
  expect(an[0][1]).toBe(true);
  expect(an[0][2]).toBe(BUNDLED_LAST); // schon bekannte Ziehung wird nicht noch einmal gemeldet
  await page.click('#btnNotifyTest');
  expect(await appLog(page, 'test')).toHaveLength(1);

  await page.click('[data-tab=tipp]');
  await tippe(page, '5 9 17 22 38 44');
  await page.click('#saveTip');
  const tipps = await appLog(page, 'tipps');
  const letzter = tipps[tipps.length - 1][1];
  expect(letzter.tipp.nums).toEqual([5, 9, 17, 22, 38, 44]);
  expect(letzter.favoriten[0].nums).toEqual([5, 9, 17, 22, 38, 44]);

  await page.click('#themeToggle');
  const themes = await appLog(page, 'theme');
  expect(themes.length).toBeGreaterThanOrEqual(2); // beim Start + Umschalten
  expect(themes[themes.length - 1][1]).toBe(await page.evaluate(() => document.documentElement.dataset.theme));
});

test('App: Zurück-Taste und Sprung per #Bereich', async ({ page }) => {
  await mockApp(page);
  await mockLive(page, { latest: false });
  await page.goto('/lotto/#statistik');
  await expect(page.locator('#tab-statistik')).toBeVisible();
  expect(await page.evaluate(() => window.lottoZurueck())).toBe(true);
  await expect(page.locator('#tab-tipp')).toBeVisible();
  expect(await page.evaluate(() => window.lottoZurueck())).toBe(false); // App darf schließen
  await page.evaluate(() => window.lottoZeigeTab('archiv'));
  await expect(page.locator('#tab-archiv')).toBeVisible();
});

test('Browser: APK-Download nur auf Android, App-Karte nie', async ({ page }) => {
  await mockLive(page, { latest: false });
  await page.goto('/lotto/');
  const android = /Android/i.test(await page.evaluate(() => navigator.userAgent));
  await expect(page.locator('#apkLink')).toBeVisible({ visible: android });
  await expect(page.locator('#apkLink')).toHaveAttribute('href', '../downloads/lotto.apk');
  await page.click('[data-tab=archiv]');
  await expect(page.locator('#appCard')).toBeHidden();
});

// ---------- Chancen & Muster-Check ----------
test('Chancen: Muster-Check rechnet live und findet kein Muster', async ({ page }) => {
  await mockLive(page, { latest: false });
  await page.goto('/lotto/#chancen');
  await expect(page.locator('#musterUrteil')).toContainText('kein Muster');
  await expect(page.locator('#musterTests .check')).toHaveCount(4);
  await expect(page.locator('#musterTests')).toContainText('am häufigsten');
  // Rückrechnung: 4 Strategien + Zufall als Vergleich
  await expect(page.locator('#backtestTabelle tbody tr')).toHaveCount(5);
  await expect(page.locator('#backtestUrteil')).toContainText('Keine Strategie schlägt den Zufall');
  // exakte Chancen
  await expect(page.locator('#chancenTabelle')).toContainText('1 : 139.838.160');
  await expect(page.locator('#chancenTabelle')).toContainText('1 : 63');
  await expect(page.locator('#chancenTabelle')).toContainText('Irgendein Gewinn');
});

test('Kluger Tipp: kaum Geburtstagszahlen, keine Reihen, gültige Zahlen', async ({ page }) => {
  await mockLive(page, { latest: false });
  await page.goto('/lotto/');
  for (let i = 0; i < 15; i++) {
    await page.click('#klugTip');
    const t = (await page.inputValue('#tipInput')).split(' ').map(Number);
    expect(new Set(t).size).toBe(6);
    expect(t.every((n) => n >= 1 && n <= 49)).toBe(true);
    expect(t.filter((n) => n <= 31).length).toBeLessThanOrEqual(2);
    expect(t.some((n, j) => j >= 2 && t[j - 1] === n - 1 && t[j - 2] === n - 2)).toBe(false);
  }
  await expect(page.locator('#tipHint')).toContainText('Kluger Tipp');
  await expect(page.locator('.verdict')).toBeVisible(); // Auswertung läuft sofort
  // Knopf im Chancen-Bereich übernimmt den Tipp und springt zu „Mein Tipp“
  await page.click('[data-tab=chancen]');
  await page.click('#klugTip2');
  await expect(page.locator('#tab-tipp')).toBeVisible();
});
