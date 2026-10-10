// Lotto-Simulator 6aus49 – privat, läuft komplett im Browser.
// Daten: alle Ziehungen seit 1955 (ziehungen.txt, mitgeliefert). Neue Ziehungen
// kommen LIVE über die öffentliche Schnittstelle von WestLotto (offizielle
// Landeslotterie, Zahlen + echte Quoten, auch rückwirkend per Datum) und werden
// lokal gespeichert. Ersatzquelle: LottoNumberArchive. Mitgelieferte Datei neu
// erzeugen:  node scripts/lotto-daten.mjs

const LIVE = 'https://www.westlotto.de/wlinfo/WL_InfoService?client=jsn&gruppe=ZahlenUndQuoten&spielart=LOTTO';
const ARCHIV = 'https://johannesfriedrich.github.io/LottoNumberArchive/Lottonumbers_complete.json';
const PREIS = 1.2;               // € pro Tipp (seit 09/2020, ohne Gebühren)
const DM_KURS = 1.95583;         // 1 € = 1,95583 DM
const ZIEHUNGEN_PRO_JAHR = 104;  // mittwochs + samstags
const MIN = 60 * 1000;

const KEY = {
  tipp: 'lotto_tipp',
  favs: 'lotto_favoriten',
  neu: 'lotto_neue_ziehungen',
  check: 'lotto_letzter_check',
  live: 'lotto_live',
  quoten: 'lotto_quoten',
  theme: 'lotto_theme',
  tab: 'lotto_tab',
};

// In der Android-App gibt es window.LottoApp (Benachrichtigungen, Systemleisten).
// Im Browser fehlt es – dann laufen alle app()-Aufrufe ins Leere.
const APP = typeof window.LottoApp === 'object' && window.LottoApp ? window.LottoApp : null;
function app(methode, ...args) {
  if (!APP) return undefined;
  try { return APP[methode](...args); } catch { return undefined; }
}

// Gewinnklassen nach heutigem Schema (seit 2013). Quoten = grobe Durchschnitte.
const KLASSEN = [
  null,
  { label: '6 Richtige + Superzahl', kurz: '6+SZ', quote: 10_000_000 },
  { label: '6 Richtige', kurz: '6', quote: 800_000 },
  { label: '5 Richtige + Superzahl', kurz: '5+SZ', quote: 12_000 },
  { label: '5 Richtige', kurz: '5', quote: 4_000 },
  { label: '4 Richtige + Superzahl', kurz: '4+SZ', quote: 180 },
  { label: '4 Richtige', kurz: '4', quote: 45 },
  { label: '3 Richtige + Superzahl', kurz: '3+SZ', quote: 20 },
  { label: '3 Richtige', kurz: '3', quote: 11 },
  { label: '2 Richtige + Superzahl', kurz: '2+SZ', quote: 6 },
];

function klasse(richtige, szTreffer) {
  if (richtige === 6) return szTreffer ? 1 : 2;
  if (richtige === 5) return szTreffer ? 3 : 4;
  if (richtige === 4) return szTreffer ? 5 : 6;
  if (richtige === 3) return szTreffer ? 7 : 8;
  if (richtige === 2 && szTreffer) return 9;
  return 0;
}

const $ = (id) => document.getElementById(id);
const zahl = new Intl.NumberFormat('de-DE');
// minimumFractionDigits mit angeben – ältere Browser/WebViews werfen sonst einen RangeError
const eurFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const eur = (v) => eurFmt.format(v);
const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const plural = (n, eins, mehr) => `${zahl.format(n)} ${n === 1 ? eins : mehr}`;
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function write(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

// ---------- Datum ----------
function datum(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const wt = WT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wt}, ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
}
function localIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Ziehungszeit: mittwochs 18:25, samstags 19:25 Uhr.
function ziehungsZeit(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, new Date(y, m - 1, d).getDay() === 3 ? 18 : 19, 25);
}
const LIVE_NACH = 20 * MIN; // so lange nach der Ziehung stehen die Zahlen meist online

// Letzter Ziehungstag, dessen Zahlen schon veröffentlicht sein sollten.
function letzteFaelligeZiehung(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 0; i < 8; i++, d.setDate(d.getDate() - 1)) {
    const wd = d.getDay();
    if ((wd === 3 || wd === 6) && (i > 0 || now - ziehungsZeit(localIso(d)) >= LIVE_NACH)) return localIso(d);
  }
  return localIso(d);
}
function naechsteZiehung(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 0; i < 8; i++, d.setDate(d.getDate() + 1)) {
    const wd = d.getDay();
    if ((wd === 3 || wd === 6) && (i > 0 || now < ziehungsZeit(localIso(d)))) return localIso(d);
  }
  return localIso(d);
}
// Alle Mittwoche/Samstage strikt zwischen zwei Daten (für verpasste Ziehungen).
function ziehungstageZwischen(von, bis) {
  const out = [];
  const [y, m, d] = von.split('-').map(Number);
  const t = new Date(y, m - 1, d + 1);
  for (let iso = localIso(t); iso < bis; t.setDate(t.getDate() + 1), iso = localIso(t)) {
    if (t.getDay() === 3 || t.getDay() === 6) out.push(iso);
  }
  return out;
}
const uhrzeit = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

// ---------- Daten ----------
let draws = [];        // [{ d: 'JJJJ-MM-TT', n: [6 Zahlen sortiert], sz: 0–9 oder -1 }]
let bundledLast = '';  // letzte Ziehung in der mitgelieferten Datei

function gueltig(n) {
  return n.length === 6 && new Set(n).size === 6 && n.every((x) => Number.isInteger(x) && x >= 1 && x <= 49);
}
function parseTxt(txt) {
  const out = [];
  for (const line of txt.split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p.length !== 8 || !/^\d{4}-\d{2}-\d{2}$/.test(p[0])) continue;
    const n = p.slice(1, 7).map(Number);
    const sz = p[7] === '-' ? -1 : Number(p[7]);
    if (!gueltig(n) || !(sz === -1 || (Number.isInteger(sz) && sz >= 0 && sz <= 9))) continue;
    out.push({ d: p[0], n, sz });
  }
  return out;
}
const toLine = (z) => `${z.d} ${z.n.join(' ')} ${z.sz < 0 ? '-' : z.sz}`;

// Ersatzquelle: komplettes LottoNumberArchive (eine Datei mit allen Ziehungen)
function parseArchiv(json) {
  const out = [];
  for (const r of (json && json.data) || []) {
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec((r && r.date) || '');
    if (!m || !Array.isArray(r.Lottozahl)) continue;
    const n = r.Lottozahl.slice().sort((a, b) => a - b);
    if (!gueltig(n)) continue;
    const sz = Number.isInteger(r.Superzahl) && r.Superzahl >= 0 && r.Superzahl <= 9 ? r.Superzahl : -1;
    out.push({ d: `${m[3]}-${m[2]}-${m[1]}`, n, sz });
  }
  return out;
}

// Live-Quelle: WestLotto → { z: Ziehung, quoten, folge: nächste Ziehung } oder null
function parseLive(json) {
  const h = json && json.head;
  const zg = json && json.zahlen && json.zahlen.hauptlotterie && (json.zahlen.hauptlotterie.ziehungen || [])[0];
  if (!h || !/^\d{4}-\d{2}-\d{2}$/.test(h.datum || '') || !zg || !Array.isArray(zg.zahlenSortiert)) return null;
  const n = zg.zahlenSortiert.map(Number).sort((a, b) => a - b);
  if (!gueltig(n)) return null;
  const ziffer = (v, lo, hi) => {
    const x = v === '' || v === null || v === undefined ? NaN : Number(v);
    return Number.isInteger(x) && x >= lo && x <= hi ? x : -1;
  };
  const sz = ziffer(zg.superzahl, 0, 9);
  const zz = ziffer(zg.zusatzzahl, 1, 49);
  const a = json.auswertung && json.auswertung.quoten && json.auswertung.quoten.hauptlotterie;
  const qz = a && (a.ziehungen || [])[0];
  let quoten = null;
  if (qz && Array.isArray(qz.gewinnklassen)) {
    const k = qz.gewinnklassen
      .filter((x) => x && typeof x.kurzbeschreibung === 'string' && Number.isFinite(x.quote))
      .map((x) => [x.kurzbeschreibung.replace(/\s+/g, ' ').trim(), x.quote,
        Number.isFinite(x.anzahl) ? x.anzahl : null, Number.isFinite(x.jackpot) ? x.jackpot : null]);
    // Direkt nach der Ziehung stehen die Quoten noch nicht fest (alle 0)
    if (k.some((x) => x[1] > 0)) quoten = { w: qz.waehrung === 'DM' ? 'DM' : 'EUR', zz, k };
  }
  const f = h.folgeZiehung;
  const folge = f && /^\d{4}-\d{2}-\d{2}$/.test(f.datum || '')
    ? { d: f.datum, schluss: typeof f.annahmeschluss === 'string' ? f.annahmeschluss : null } : null;
  return { z: { d: h.datum, n, sz }, quoten, folge };
}

async function holeJson(url, ms = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Ergänzt 'basis' um alle Ziehungen aus 'extra', die neuer als die mitgelieferten sind.
function merge(basis, extra) {
  const map = new Map(basis.map((z) => [z.d, z]));
  for (const z of extra) if (z.d > bundledLast) map.set(z.d, z);
  return [...map.values()].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}

// Fritz-Formel (scripts/lotto-formel.mjs) – optional: ohne sie fehlt nur die Formel-Karte
let FORMEL = null;
async function ladeFormel() {
  try {
    const f = await (await fetch('formel.json')).json();
    const ok = Array.isArray(f.beta) && f.beta.length === 49 && f.beta.every(Number.isFinite)
      && f.klassen && Object.values(f.klassen).every((k) => Number.isFinite(k.p) && Number.isFinite(k.r)
        && (Number.isFinite(k.fest) || (Number.isFinite(k.topf) && Number.isFinite(k.gewinner) && Number.isFinite(k.kappa))));
    if (ok) FORMEL = f;
  } catch {}
}

async function ladeDaten() {
  const formel = ladeFormel(); // parallel laden, wirft nie
  const res = await fetch('ziehungen.txt');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const basis = parseTxt(await res.text());
  if (!basis.length) throw new Error('Keine Ziehungen in ziehungen.txt');
  bundledLast = basis[basis.length - 1].d;
  const extra = parseTxt((read(KEY.neu) || []).join('\n'));
  draws = merge(basis, extra);
  await formel;
}

const letzte = () => draws[draws.length - 1];
const jahre = () => [...new Set(draws.map((z) => z.d.slice(0, 4)))];

// Echte Quoten je Ziehungstag (ändern sich nie mehr → dauerhaft gespeichert)
let quotenCache = {};
function ladeQuotenCache() {
  const q = read(KEY.quoten);
  quotenCache = q && typeof q === 'object' && !Array.isArray(q) ? q : {};
}
const quotenFuer = (d) => {
  const q = quotenCache[d];
  return q && Array.isArray(q.k) ? q : null;
};
const quotenLaden = new Set();
async function ladeQuoten(daten, fortschritt) {
  const offen = [...new Set(daten)].filter((d) => !quotenFuer(d) && !quotenLaden.has(d));
  offen.forEach((d) => quotenLaden.add(d));
  let i = 0;
  let fertig = 0;
  const arbeiter = async () => {
    while (i < offen.length) {
      const d = offen[i++];
      try {
        const r = parseLive(await holeJson(`${LIVE}&datum=${d}`));
        if (r && r.z.d === d && r.quoten) quotenCache[d] = r.quoten;
      } catch {}
      quotenLaden.delete(d);
      fertig++;
      if (fortschritt) fortschritt(fertig, offen.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, offen.length) }, arbeiter));
  if (offen.length) write(KEY.quoten, quotenCache);
}

let liveStand = read(KEY.live); // { d, folge, geprueft } der letzten erfolgreichen Live-Abfrage
const liveFrisch = () => !!(liveStand && Date.now() - liveStand.geprueft < 12 * 60 * MIN);

function zeigeDatenInfo() {
  const j = jahre();
  $('dataInfo').innerHTML = `${zahl.format(draws.length)} Ziehungen · ${j[0]}–${j[j.length - 1]}` +
    (liveFrisch() ? ' · <span class="live-dot" title="Live mit WestLotto abgeglichen">live</span>' : '');
}

// Holt die neueste Ziehung live (plus verpasste Ziehungen) – Ergebnis: Liste neuer Ziehungen.
async function holeLive() {
  const live = parseLive(await holeJson(LIVE));
  if (!live) throw new Error('Live-Daten unvollständig');
  liveStand = { d: live.z.d, folge: live.folge, geprueft: Date.now() };
  write(KEY.live, liveStand);
  if (live.quoten) { quotenCache[live.z.d] = live.quoten; write(KEY.quoten, quotenCache); }
  const out = [live.z];
  const vorhanden = new Set(draws.map((z) => z.d));
  const fehlend = ziehungstageZwischen(bundledLast, live.z.d).filter((d) => !vorhanden.has(d));
  if (fehlend.length > 8) {
    // längere Pause → alles auf einmal aus dem Archiv holen
    try { out.push(...parseArchiv(await holeJson(ARCHIV, 20000))); } catch {}
  } else if (fehlend.length) {
    const res = await Promise.all(fehlend.map((d) => holeJson(`${LIVE}&datum=${d}`).then(parseLive, () => null)));
    for (const r of res) {
      if (!r) continue;
      out.push(r.z);
      if (r.quoten) quotenCache[r.z.d] = r.quoten;
    }
    write(KEY.quoten, quotenCache);
  }
  return out;
}

let updating = false;
async function aktualisieren(manuell = false) {
  if (updating || !draws.length) return;
  const faellig = letzteFaelligeZiehung();
  if (!manuell) {
    const fehlt = letzte().d < faellig;
    if (!fehlt && quotenFuer(letzte().d) && liveFrisch()) { planeCheck(); return; }
    const seit = Date.now() - (Number(read(KEY.check)) || 0);
    if (seit < (fehlt ? 2 * MIN : 30 * MIN)) { planeCheck(); return; }
  }
  updating = true;
  $('btnUpdate').disabled = true;
  $('updateStatus').textContent = 'Live-Abgleich …';
  const quotenVorher = !!quotenFuer(letzte().d);
  try {
    write(KEY.check, Date.now());
    let neu;
    let quelle = 'live von WestLotto';
    try {
      neu = await holeLive();
    } catch {
      quelle = 'aus dem LottoNumberArchive';
      neu = parseArchiv(await holeJson(ARCHIV, 20000));
      if (!neu.length) throw new Error('Leere Antwort');
    }
    const gespeichert = merge([], [...parseTxt((read(KEY.neu) || []).join('\n')), ...neu]);
    write(KEY.neu, gespeichert.map(toLine));
    const vorher = draws.length;
    draws = merge(draws, gespeichert);
    const plus = draws.length - vorher;
    if (plus > 0) allesNeuZeichnen();
    else {
      zeigeDatenInfo();
      if (!quotenVorher && quotenFuer(letzte().d)) allesNeuZeichnen();
      else if (aktiverTab === 'archiv') renderLetzteZiehung();
    }
    $('updateStatus').textContent = plus
      ? `✓ ${plural(plus, 'neue Ziehung', 'neue Ziehungen')} ${quelle} geladen.`
      : letzte().d < faellig
        ? `Die Zahlen vom ${datum(faellig)} sind noch nicht da – ich schaue alle 2 Minuten nach.`
        : `✓ Aktuell – ${quelle} geprüft um ${uhrzeit(Date.now())} Uhr.`;
  } catch {
    $('updateStatus').textContent = 'Keine Verbindung – es werden die gespeicherten Ziehungen genutzt.';
  } finally {
    updating = false;
    $('btnUpdate').disabled = false;
    planeCheck();
  }
}

// Solange die Seite offen ist: nach jeder Ziehung automatisch live nachsehen.
let checkTimer = null;
function planeCheck() {
  clearTimeout(checkTimer);
  if (!draws.length) return;
  const now = new Date();
  const faellig = letzteFaelligeZiehung(now);
  let ms;
  if (letzte().d < faellig) ms = now - ziehungsZeit(faellig) > 12 * 60 * MIN ? 30 * MIN : 2 * MIN;
  else if (!quotenFuer(letzte().d)) ms = 30 * MIN;
  else ms = ziehungsZeit(naechsteZiehung(now)) - now + LIVE_NACH;
  checkTimer = setTimeout(() => aktualisieren(false), Math.min(Math.max(ms, MIN), 2 ** 31 - 1));
}

// ---------- Tipp ----------
let tipNums = new Set();
let tipSz = null;

const tippKomplett = () => tipNums.size === 6;
const sortiert = (set) => [...set].sort((a, b) => a - b);
function maskeVon(nums) {
  const m = new Uint8Array(50);
  for (const n of nums) m[n] = 1;
  return m;
}
function ziehe6() {
  const pool = Array.from({ length: 49 }, (_, i) => i + 1);
  const out = [];
  for (let j = 0; j < 6; j++) {
    const x = j + Math.floor(Math.random() * (49 - j));
    [pool[j], pool[x]] = [pool[x], pool[j]];
    out.push(pool[j]);
  }
  return out;
}
const gueltigeSz = (sz) => sz === null || (Number.isInteger(sz) && sz >= 0 && sz <= 9);

function baueSchein() {
  const g = $('tipGrid');
  for (let n = 1; n <= 49; n++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = n;
    b.dataset.n = n;
    b.setAttribute('aria-pressed', 'false');
    g.append(b);
  }
  g.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-n]');
    if (!b) return;
    const n = Number(b.dataset.n);
    if (tipNums.has(n)) tipNums.delete(n);
    else if (tipNums.size < 6) tipNums.add(n);
    else { setHinweis('Schon 6 Zahlen gewählt – erst eine abwählen.', 'warn'); return; }
    tippGeaendert(true);
  });

  const p = $('szPicker');
  const opts = [['keine', null], ...Array.from({ length: 10 }, (_, i) => [String(i), i])];
  for (const [txt, val] of opts) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = txt;
    b.setAttribute('role', 'radio');
    b.dataset.sz = val === null ? '' : val;
    b.setAttribute('aria-label', val === null ? 'Keine Superzahl' : `Superzahl ${val}`);
    p.append(b);
  }
  p.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    tipSz = b.dataset.sz === '' ? null : Number(b.dataset.sz);
    tippGeaendert(false);
  });
}

function setHinweis(text, art = '') {
  const h = $('tipHint');
  h.textContent = text;
  h.className = 'hint' + (art ? ' ' + art : '');
}

function tippGeaendert(inputSync, probleme = []) {
  for (const b of $('tipGrid').children) b.setAttribute('aria-pressed', String(tipNums.has(Number(b.dataset.n))));
  for (const b of $('szPicker').children) {
    const v = b.dataset.sz === '' ? null : Number(b.dataset.sz);
    b.setAttribute('aria-checked', String(v === tipSz));
  }
  if (inputSync) $('tipInput').value = sortiert(tipNums).join(' ');

  if (probleme.length) setHinweis(probleme.join(' · '), 'warn');
  else if (tippKomplett()) setHinweis('✓ 6 Zahlen gewählt – Auswertung siehe unten', 'ok');
  else setHinweis(`Noch ${plural(6 - tipNums.size, 'Zahl', 'Zahlen')} wählen.`);

  write(KEY.tipp, { nums: sortiert(tipNums), sz: tipSz });
  tippsAnApp();
  renderErgebnis();
}

// Die App prüft nach jeder Ziehung den aktuellen und alle gemerkten Tipps
function tippsAnApp() {
  if (!APP) return;
  app('tipps', JSON.stringify({ tipp: tippKomplett() ? { nums: sortiert(tipNums), sz: tipSz } : null, favoriten: favoriten() }));
}

function leseEingabe() {
  const tokens = $('tipInput').value.match(/\d+/g) || [];
  const nums = [];
  const probleme = [];
  for (const t of tokens) {
    const n = Number(t);
    if (n < 1 || n > 49) { probleme.push(`${t} ist keine Lottozahl (1–49)`); continue; }
    if (nums.includes(n)) { probleme.push(`${n} doppelt`); continue; }
    if (nums.length === 6) { probleme.push('mehr als 6 Zahlen – der Rest zählt nicht'); break; }
    nums.push(n);
  }
  tipNums = new Set(nums);
  tippGeaendert(false, probleme);
}

// ---------- Gemerkte Tipps ----------
function favoriten() {
  const f = read(KEY.favs);
  return Array.isArray(f) ? f.filter((x) => x && Array.isArray(x.nums) && gueltig(x.nums) && gueltigeSz(x.sz)) : [];
}
function renderFavs() {
  const favs = favoriten();
  $('favs').classList.toggle('hidden', !favs.length);
  $('favList').innerHTML = favs.map((f, i) =>
    `<span class="fav"><button type="button" data-load="${i}">${f.nums.join(' ')}${f.sz !== null ? ` · SZ ${f.sz}` : ''}</button>` +
    `<button type="button" class="fav-del" data-del="${i}" aria-label="Gemerkten Tipp löschen">✕</button></span>`).join('');
}
function merkeTipp() {
  if (!tippKomplett()) { setHinweis('Erst 6 Zahlen wählen, dann merken.', 'warn'); return; }
  const neu = { nums: sortiert(tipNums), sz: tipSz };
  const key = JSON.stringify(neu);
  const favs = favoriten().filter((f) => JSON.stringify({ nums: f.nums, sz: f.sz }) !== key);
  favs.unshift(neu);
  write(KEY.favs, favs.slice(0, 12));
  renderFavs();
  tippsAnApp();
  setHinweis('⭐ Tipp gemerkt.', 'ok');
}

// ---------- Auswertung über alle Ziehungen ----------
function auswerten(nums, sz) {
  const mask = maskeVon(nums);
  const anzahl = new Array(10).fill(0);
  const zuletzt = new Array(10).fill(null);
  const gewinne = [];
  const proJahr = new Map();
  for (const z of draws) {
    let r = 0;
    for (const n of z.n) r += mask[n];
    const szTreffer = sz !== null && z.sz === sz;
    const k = klasse(r, szTreffer);
    if (!k) continue;
    anzahl[k]++;
    zuletzt[k] = z;
    const g = { z, k, r, szTreffer };
    gewinne.push(g);
    const y = z.d.slice(0, 4);
    if (!proJahr.has(y)) proJahr.set(y, []);
    proJahr.get(y).push(g);
  }
  return { mask, anzahl, zuletzt, gewinne, proJahr };
}
// Stufe für die Jahres-Übersicht: 1 = kleiner Gewinn, 2 = 4 R., 3 = 5 R., 4 = 6 R.
const stufe = (r) => (r >= 6 ? 4 : r === 5 ? 3 : r === 4 ? 2 : 1);

function kugeln(z, mask, sz, gross = false) {
  const g = gross ? ' big' : '';
  let h = z.n.map((n) => `<span class="ball${g}${mask && mask[n] ? ' hit' : ''}">${n}</span>`).join('');
  if (z.sz >= 0) {
    const hit = sz !== null && sz !== undefined && z.sz === sz ? ' hit' : '';
    h += `<span class="ball sz${g}${hit}" title="Superzahl" aria-label="Superzahl ${z.sz}">${z.sz}</span>`;
  }
  return h;
}
function gewinnZeile(g, mask, sz) {
  return `<div class="win-row"><span class="d">${datum(g.z.d)}</span><span class="badge">${KLASSEN[g.k].label}</span>` +
    `<div class="balls">${kugeln(g.z, mask, sz)}</div>` +
    `<div class="real" data-d="${g.z.d}" data-r="${g.r}" data-s="${g.szTreffer ? 1 : 0}"></div></div>`;
}

// ---------- Echte Quoten (damalige Gewinnklassen, inkl. Zusatzzahl & DM) ----------
const zahl2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const geld = (v, w) => `${zahl2.format(v)} ${w === 'DM' ? 'DM' : '€'}`;
const inEuro = (v, w) => (w === 'DM' ? v / DM_KURS : v);

// Welche Gewinnklasse galt damals für r Richtige (+ SZ / + ZZ)?
function damals(r, szTreffer, q, mask) {
  const kand = [];
  if (szTreffer) kand.push(`${r} + SZ`);
  if (q.zz > 0 && mask[q.zz]) kand.push(`${r} + ZZ`);
  kand.push(`${r}`);
  for (const c of kand) {
    const k = q.k.find((x) => x[0] === c);
    if (k) return { kurz: c, quote: k[1], jackpot: k[3] };
  }
  return null;
}
function klassenText(kurz) {
  return esc(kurz).replace(/^(\d)/, '$1 Richtige').replace('+ SZ', '+ Superzahl').replace('+ ZZ', '+ Zusatzzahl');
}
function betragText(k, w) {
  if (k.quote > 0) return `<b>${geld(k.quote, w)}</b>${w === 'DM' ? ` (≈ ${geld(inEuro(k.quote, w), 'EUR')})` : ''}`;
  if (k.jackpot) return `<b>Jackpot ≈ ${geld(k.jackpot, w)}</b> (damals hat ihn niemand geknackt)`;
  return 'damals ohne Gewinner – keine Quote festgelegt';
}
function fuelleQuoten() {
  const mask = maskeVon(tipNums);
  for (const el of document.querySelectorAll('#result .real[data-d]')) {
    const q = quotenFuer(el.dataset.d);
    if (!q) continue;
    const k = damals(Number(el.dataset.r), el.dataset.s === '1', q, mask);
    el.innerHTML = k
      ? `Damals: ${klassenText(k.kurz)} → ${betragText(k, q.w)}`
      : 'Damals gab es für diesen Treffer noch keine Gewinnklasse.';
    el.classList.add('da');
  }
}

function renderErgebnis() {
  const box = $('result');
  if (!draws.length) return;
  if (!tippKomplett()) {
    box.innerHTML = `<div class="card muted">Wähle 6 Zahlen – dann siehst du sofort, ob und in welchem Jahr du mit ihnen gewonnen hättest. Geprüft wird gegen alle ${zahl.format(draws.length)} Ziehungen seit 1955.</div>`;
    return;
  }
  const nums = sortiert(tipNums);
  const sz = tipSz;
  const a = auswerten(nums, sz);
  const alleJahre = jahre();
  const besteListe = a.gewinne.slice().sort((x, y) => x.k - y.k || (x.z.d < y.z.d ? -1 : 1));
  const bester = besteListe[0];
  const sechser = a.anzahl[1] + a.anzahl[2];

  // 1) Urteil
  let kopf;
  let text;
  let cls = 'verdict card';
  if (sechser) {
    cls += ' jackpot';
    kopf = '🎉 Jackpot – 6 Richtige!';
    const tage = besteListe.filter((g) => g.k <= 2).map((g) => `<b>${datum(g.z.d)}</b>`);
    text = `Mit genau diesen Zahlen hättest du am ${tage.join(' und am ')} sechs Richtige gehabt.`;
  } else if (bester) {
    cls += ' win';
    kopf = `Ja – ${zahl.format(a.gewinne.length)}-mal gewonnen!`;
    const mal = a.anzahl[bester.k];
    text = `Bester Treffer: <b>${KLASSEN[bester.k].label}</b> am <b>${datum(bester.z.d)}</b>${mal > 1 ? ` (insgesamt ${mal}×)` : ''}.`;
  } else {
    kopf = 'Leider nie gewonnen.';
    text = 'Mit diesen Zahlen wäre in keiner einzigen Ziehung ein Gewinn herausgekommen.';
  }
  const lz = letzte();
  let rL = 0;
  for (const n of lz.n) rL += a.mask[n];
  const kL = klasse(rL, sz !== null && lz.sz === sz);
  let betragL = '';
  const qL = quotenFuer(lz.d);
  if (kL && qL) {
    const k = damals(rL, kL % 2 === 1, qL, a.mask);
    if (k) betragL = ` → ${betragText(k, qL.w)}`;
  }
  const letzteTxt = `Letzte Ziehung (${datum(lz.d)}): ${rL} Richtige${kL && kL % 2 === 1 ? ' + Superzahl' : ''} – ${kL ? `<b>Gewinn (${KLASSEN[kL].label})</b>${betragL}` : 'kein Gewinn'}.`;
  const verdict = `<div class="${cls}">
    <div class="verdict-big">${kopf}</div>
    <p>${text}</p>
    <p class="muted small">Gewonnen hättest du in ${a.proJahr.size} von ${alleJahre.length} Jahren – geprüft gegen ${zahl.format(draws.length)} Ziehungen (${alleJahre[0]}–${alleJahre[alleJahre.length - 1]}).</p>
    <p class="best small">${letzteTxt}</p>
    ${FORMEL ? `<p class="small" style="margin-top:6px">🧮 Fritz-Formel: Dein Tipp ist im Schnitt <b>${cent(fritzWert(nums))}</b> pro 1,20 € wert (Ø-Tipp ${cent(FORMEL.ev0)}) – besser als ${rangText(fritzRang(fritzWert(nums)))} aller Tipps.</p>` : ''}
  </div>`;

  // 2) Jahres-Übersicht
  const zellen = alleJahre.map((y) => {
    const liste = a.proJahr.get(y);
    if (!liste) return `<button type="button" data-lvl="0" disabled title="${y}: kein Gewinn">${y}</button>`;
    const bestR = Math.max(...liste.map((g) => g.r));
    const lvl = stufe(bestR);
    const best = liste.reduce((m, g) => (g.k < m.k ? g : m));
    return `<button type="button" data-lvl="${lvl}" data-jahr="${y}" title="${y}: ${plural(liste.length, 'Gewinn', 'Gewinne')}, bester: ${KLASSEN[best.k].label}" aria-label="${y}: ${plural(liste.length, 'Gewinn', 'Gewinne')}, bester ${KLASSEN[best.k].label}">${y}</button>`;
  }).join('');
  const jahresKarte = `<div class="card">
    <h3>In welchen Jahren hättest du gewonnen?</h3>
    <div class="year-strip" id="yearStrip">${zellen}</div>
    <div class="legend">
      <span><i style="background:var(--lvl0)"></i>kein Gewinn</span>
      <span><i style="background:var(--lvl1)"></i>3 Richtige / 2 + SZ</span>
      <span><i style="background:var(--lvl2)"></i>4 Richtige</span>
      <span><i style="background:var(--lvl3)"></i>5 Richtige</span>
      <span><i style="background:var(--lvl4)"></i>6 Richtige</span>
    </div>
    <p class="muted small" style="margin-top:8px">Jahr antippen → alle Gewinne dieses Jahres.</p>
  </div>`;

  // 3) Größte Treffer (ab 4 Richtigen)
  const gross = besteListe.filter((g) => g.r >= 4);
  const grossKarte = `<div class="card">
    <h3>Deine größten Treffer</h3>
    ${gross.length
      ? `<div class="top-wins">${gross.slice(0, 15).map((g) => gewinnZeile(g, a.mask, sz)).join('')}</div>${gross.length > 15 ? `<p class="muted small" style="margin-top:8px">… und ${gross.length - 15} weitere mit 4 Richtigen.</p>` : ''}`
      : '<p class="muted">Nie mehr als 3 Richtige.</p>'}
  </div>`;

  // 4) Gewinnklassen
  const zeilen = KLASSEN.slice(1).map((kl, i) => {
    const k = i + 1;
    const z = a.zuletzt[k];
    return `<tr class="${a.anzahl[k] ? '' : 'zero'}"><td>${kl.label}</td><td class="n">${zahl.format(a.anzahl[k])}×</td><td class="date">${z ? datum(z.d) : '–'}</td></tr>`;
  }).join('');
  const klassenKarte = `<div class="card">
    <h3>Gewinnklassen</h3>
    <table class="classes">
      <thead><tr><th>Treffer</th><th class="n">Anzahl</th><th class="n">zuletzt</th></tr></thead>
      <tbody>${zeilen}</tbody>
    </table>
    <p class="muted small" style="margin-top:8px">${sz === null
      ? 'Ohne Superzahl werden nur die Richtigen gewertet. Wähle oben deine Superzahl für die „+ SZ“-Klassen.'
      : 'Superzahl gibt es seit Dezember 1991 – ältere Ziehungen zählen nur mit Richtigen.'} Bewertet nach den heutigen Gewinnklassen; die frühere Zusatzzahl ist nicht berücksichtigt.</p>
  </div>`;

  // 5) Bilanz
  const einsatz = draws.length * PREIS;
  const gewinn = a.anzahl.reduce((s, n, k) => s + (k ? n * KLASSEN[k].quote : 0), 0);
  const saldo = gewinn - einsatz;
  const bilanzKarte = `<div class="card">
    <h3>Bilanz, wenn du jede Ziehung gespielt hättest</h3>
    <div class="money">
      <div><small>Einsatz</small><b>${eur(einsatz)}</b></div>
      <div><small>Gewinne ca.</small><b>${eur(gewinn)}</b></div>
      <div><small>Ergebnis ca.</small><b class="${saldo >= 0 ? 'pos' : 'neg'}">${saldo >= 0 ? '+' : '−'}${eur(Math.abs(saldo))}</b></div>
    </div>
    <p class="muted small" style="margin-top:8px">Grobe Schätzung zu heutigen Preisen (1,20 € pro Tipp) und mit durchschnittlichen Gewinnquoten – echte Quoten schwanken je Ziehung stark.</p>
    ${a.gewinne.length ? `<div class="echt" id="echtBox"><button class="btn" id="btnEcht" type="button">💶 Mit echten Quoten nachrechnen</button>
      <span class="muted small">lädt die damaligen Auszahlungen live (${plural(a.gewinne.length, 'Abruf', 'Abrufe')}, danach gespeichert)</span></div>` : ''}
  </div>`;

  // 6) Alle Gewinne nach Jahr
  const jahreMitGewinn = [...a.proJahr.keys()].sort().reverse();
  const details = jahreMitGewinn.map((y) => {
    const liste = a.proJahr.get(y);
    const best = liste.reduce((m, g) => (g.k < m.k ? g : m));
    return `<details class="year" id="jahr-${y}">
      <summary><span class="yr">${y}</span><span class="info">${plural(liste.length, 'Gewinn', 'Gewinne')} · bester: ${KLASSEN[best.k].label}</span></summary>
      <div class="rows">${liste.slice().reverse().map((g) => gewinnZeile(g, a.mask, sz)).join('')}</div>
    </details>`;
  }).join('');
  const jahrKarte = jahreMitGewinn.length ? `<div class="card"><h3>Alle Gewinne nach Jahr</h3>${details}</div>` : '';

  box.innerHTML = verdict + jahresKarte + grossKarte + klassenKarte + bilanzKarte + jahrKarte;
  auswertung = a;
  fuelleQuoten();
  if (a.gewinne.every((g) => quotenFuer(g.z.d))) zeigeEchteBilanz();
  // echte Beträge der größten Treffer gleich nachladen (gespeichert → nur einmal)
  ladeQuoten(gross.slice(0, 15).map((g) => g.z.d)).then(fuelleQuoten);
}

let auswertung = null;
// Summe der echten damaligen Auszahlungen aller Gewinne (DM in € umgerechnet)
function zeigeEchteBilanz() {
  const box = $('echtBox');
  if (!box || !auswertung) return;
  let summe = 0;
  let ohne = 0;
  let fehlt = 0;
  for (const g of auswertung.gewinne) {
    const q = quotenFuer(g.z.d);
    if (!q) { fehlt++; continue; }
    const k = damals(g.r, g.szTreffer, q, auswertung.mask);
    if (!k) ohne++;
    else summe += inEuro(k.quote > 0 ? k.quote : (k.jackpot || 0), q.w);
  }
  box.innerHTML = `<div class="echt-sum"><small>Echte Gewinne (damalige Quoten)</small><b>${geld(summe, 'EUR')}</b></div>
    <p class="muted small">${ohne ? `${plural(ohne, 'Treffer zählte', 'Treffer zählten')} damals noch nicht als Gewinn. ` : ''}${fehlt ? `${plural(fehlt, 'Quote', 'Quoten')} nicht abrufbar. ` : ''}DM-Beträge sind in Euro umgerechnet.</p>`;
}
async function echteBilanzLaden() {
  if (!auswertung) return;
  const btn = $('btnEcht');
  if (btn) btn.disabled = true;
  const a = auswertung;
  await ladeQuoten(a.gewinne.map((g) => g.z.d), (fertig, gesamt) => {
    const b = $('btnEcht');
    if (b) b.textContent = `Lade Quoten … ${fertig}/${gesamt}`;
  });
  if (auswertung !== a) return; // Tipp wurde inzwischen geändert
  fuelleQuoten();
  zeigeEchteBilanz();
}

function zeigeJahr(y) {
  const det = document.getElementById('jahr-' + y);
  if (!det) return;
  det.open = true;
  det.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
  det.classList.add('flash');
  setTimeout(() => det.classList.remove('flash'), 1400);
}

// ---------- Archiv ----------
function renderLetzteZiehung() {
  const z = letzte();
  const mask = tipNums.size ? maskeVon(tipNums) : null;
  const q = quotenFuer(z.d);
  const quotenTab = q
    ? `<table class="classes quoten"><thead><tr><th>Klasse</th><th class="n">Gewinner</th><th class="n">Quote</th></tr></thead><tbody>${
      q.k.map(([kurz, quote, anzahl, jackpot]) => `<tr><td>${esc(kurz)}</td><td class="n">${anzahl === null ? '–' : zahl.format(anzahl)}</td>` +
        `<td class="n">${quote > 0 ? geld(quote, q.w) : jackpot ? `Jackpot ${geld(jackpot, q.w)}` : '–'}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted small" style="margin-top:10px">Die Gewinnquoten stehen meist ein paar Stunden nach der Ziehung fest – sie werden automatisch nachgeladen.</p>';
  // nächste Ziehung: Angabe von WestLotto, sonst selbst berechnet (immer nach der letzten bekannten)
  const heute = localIso(new Date());
  const lf = liveStand && liveStand.folge;
  const folge = lf && typeof lf.d === 'string' && lf.d > z.d && lf.d >= heute ? lf : null;
  let naechste = folge ? folge.d : naechsteZiehung();
  if (naechste <= z.d) naechste = naechsteZiehung(new Date(ziehungsZeit(z.d).getTime() + MIN));
  const schluss = folge && folge.schluss && !Number.isNaN(Date.parse(folge.schluss))
    ? ` · Annahmeschluss ${uhrzeit(Date.parse(folge.schluss))} Uhr` : '';
  $('lastDraw').innerHTML = `<div class="when">${datum(z.d)}${z.sz >= 0 ? ` · Superzahl ${z.sz}` : ''}</div>
    <div class="balls">${kugeln(z, mask, tipSz, true)}</div>
    ${quotenTab}
    <p class="muted small" style="margin-top:10px">Nächste Ziehung: ${datum(naechste)}${schluss}</p>`;
}

function renderArchiv() {
  renderLetzteZiehung();
  const sel = $('yearSelect');
  const js = jahre().reverse();
  if (sel.options.length !== js.length) {
    const alt = sel.value;
    sel.innerHTML = js.map((y) => `<option value="${y}">${y}</option>`).join('');
    sel.value = js.includes(alt) ? alt : js[0];
  }
  const y = sel.value;
  const mask = tipNums.size ? maskeVon(tipNums) : null;
  const liste = draws.filter((z) => z.d.startsWith(y)).reverse();
  $('archivInfo').textContent = `${plural(liste.length, 'Ziehung', 'Ziehungen')} in ${y}` + (mask ? ' · deine Zahlen sind markiert' : '');
  $('drawList').innerHTML = liste.map((z) => {
    let badge = '';
    if (mask) {
      let r = 0;
      for (const n of z.n) r += mask[n];
      const k = tippKomplett() ? klasse(r, tipSz !== null && z.sz === tipSz) : 0;
      if (k) badge = `<span class="badge">${KLASSEN[k].kurz}</span>`;
    }
    const [, mm, dd] = z.d.split('-');
    return `<div class="draw-row"><span class="d">${dd}.${mm}.<small>${datum(z.d).slice(0, 2)}</small></span>` +
      `<div class="balls">${kugeln(z, mask, tipSz)}</div>${badge || '<span></span>'}</div>`;
  }).join('');
}

// ---------- Statistik ----------
function zeitraum(v) {
  const last = letzte().d;
  if (v === '100') return draws.slice(-100);
  if (v === '10j' || v === '1j') {
    const cut = `${Number(last.slice(0, 4)) - (v === '10j' ? 10 : 1)}${last.slice(4)}`;
    return draws.filter((z) => z.d > cut);
  }
  return draws;
}

let statAuswahl = null;
function renderStatistik() {
  const range = zeitraum($('statRange').value);
  const cnt = new Array(50).fill(0);
  for (const z of range) for (const n of z.n) cnt[n]++;
  const werte = cnt.slice(1);
  const min = Math.min(...werte);
  const max = Math.max(...werte);
  const zuletztIdx = new Array(50).fill(-1);
  draws.forEach((z, i) => { for (const n of z.n) zuletztIdx[n] = i; });

  $('statInfo').textContent = `${plural(range.length, 'Ziehung', 'Ziehungen')} vom ${datum(range[0].d)} bis ${datum(letzte().d)} – im Schnitt ${zahl.format(Math.round(range.length * 6 / 49))}× pro Zahl.`;

  let h = '';
  for (let n = 1; n <= 49; n++) {
    const p = max > min ? (cnt[n] - min) / (max - min) : 0.5;
    const mix = Math.round(8 + p * 84);
    h += `<button type="button" data-n="${n}" class="${mix > 55 ? 'hot' : ''}${statAuswahl === n ? ' sel' : ''}" ` +
      `style="background:rgba(193,98,60,${(mix / 100).toFixed(2)});background:color-mix(in srgb, var(--accent) ${mix}%, var(--surface))" aria-label="Zahl ${n}: ${cnt[n]}-mal gezogen">` +
      `<b>${n}</b><small>${zahl.format(cnt[n])}×</small></button>`;
  }
  $('heat').innerHTML = h;

  const nums = Array.from({ length: 49 }, (_, i) => i + 1);
  const rang = (liste, info) => `<div class="rank">${liste.map((n) => `<div><span class="ball">${n}</span>${info(n)}</div>`).join('')}</div>`;
  $('topHot').innerHTML = rang(nums.slice().sort((a, b) => cnt[b] - cnt[a] || a - b).slice(0, 6), (n) => `${zahl.format(cnt[n])}-mal`);
  $('topCold').innerHTML = rang(nums.slice().sort((a, b) => cnt[a] - cnt[b] || a - b).slice(0, 6), (n) => `${zahl.format(cnt[n])}-mal`);
  const seit = (n) => draws.length - 1 - zuletztIdx[n];
  $('topDue').innerHTML = rang(nums.slice().sort((a, b) => seit(b) - seit(a) || a - b).slice(0, 6),
    (n) => `seit ${plural(seit(n), 'Ziehung', 'Ziehungen')}`);

  const szCnt = new Array(10).fill(0);
  let szSumme = 0;
  for (const z of range) if (z.sz >= 0) { szCnt[z.sz]++; szSumme++; }
  const szMax = Math.max(...szCnt);
  $('szBars').innerHTML = szSumme
    ? szCnt.map((c, i) => `<div class="bar-row" title="Superzahl ${i}: ${c}-mal"><b>${i}</b><div class="track"><div class="fill" style="width:${szMax ? (c / szMax) * 100 : 0}%"></div></div><span class="v">${zahl.format(c)}×</span></div>`).join('')
    : '<p class="muted">Im gewählten Zeitraum gab es noch keine Superzahl.</p>';

  if (statAuswahl) zeigeZahlInfo(statAuswahl, cnt, range.length, zuletztIdx);
}

function zeigeZahlInfo(n, cnt, anzahl, zuletztIdx) {
  statAuswahl = n;
  for (const b of $('heat').children) b.classList.toggle('sel', Number(b.dataset.n) === n);
  const i = zuletztIdx[n];
  const vor = draws.length - 1 - i;
  $('numInfo').innerHTML = `<b>Zahl ${n}</b>: im Zeitraum ${zahl.format(cnt[n])}-mal gezogen ` +
    `(in ${(cnt[n] / anzahl * 100).toFixed(1).replace('.', ',')} % der Ziehungen). ` +
    `Zuletzt am ${datum(draws[i].d)}${vor ? ` – vor ${plural(vor, 'Ziehung', 'Ziehungen')}` : ' – in der letzten Ziehung'}.`;
}

// ---------- Chancen & Muster-Check ----------
// Alle Prüfungen rechnen live über sämtliche Ziehungen – kein fest eingebautes Ergebnis.
const binom = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
const KOMBIS = binom(49, 6); // 13.983.816
const pRichtige = (r) => (binom(6, r) * binom(43, 6 - r)) / KOMBIS;
const ERWARTET_RICHTIGE = 36 / 49; // Ø Richtige eines beliebigen Tipps

// Normalverteilung & Chi²-Restwahrscheinlichkeit (Wilson-Hilferty, für 9–48 Freiheitsgrade genau genug)
function phi(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const e = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return 0.5 * (1 + (z >= 0 ? e : -e));
}
function chi2p(x, k) {
  const z = (Math.pow(x / k, 1 / 3) - (1 - 2 / (9 * k))) / Math.sqrt(2 / (9 * k));
  return 1 - phi(z);
}
const prozent = (v, st = 0) => `${(v * 100).toFixed(st).replace('.', ',')} %`;
const chance = (p) => `1 : ${zahl.format(Math.round(1 / p))}`;

let musterCache = null;
function musterAnalyse() {
  if (musterCache && musterCache.n === draws.length) return musterCache;
  const N = draws.length;
  const p = 6 / 49;
  // 1) Kommen alle 49 Zahlen gleich oft? (Chi², korrigiert für „6 aus 49 ohne Zurücklegen“)
  const cnt = new Array(50).fill(0);
  for (const z of draws) for (const n of z.n) cnt[n]++;
  const werte = cnt.slice(1);
  const chi = werte.reduce((s, c) => s + (c - N * p) ** 2, 0) / (N * p * (1 - p)) * (48 / 49);
  // 2) Superzahl
  const sz = new Array(10).fill(0);
  let szN = 0;
  for (const z of draws) if (z.sz >= 0) { sz[z.sz]++; szN++; }
  const chiSz = sz.reduce((s, c) => s + (c - szN / 10) ** 2 / (szN / 10), 0);
  // 3) Wiederholer aus der Vorziehung
  let rep = 0;
  for (let i = 1; i < N; i++) {
    const vor = new Set(draws[i - 1].n);
    for (const n of draws[i].n) if (vor.has(n)) rep++;
  }
  // 4) Setzen sich Häufigkeiten fort? 1. Hälfte vs. 2. Hälfte
  const h = Math.floor(N / 2);
  const a = new Array(50).fill(0);
  const b = new Array(50).fill(0);
  draws.forEach((z, i) => { for (const n of z.n) (i < h ? a : b)[n]++; });
  const korr = pearson(a.slice(1), b.slice(1));
  // 5) Rückrechnung: hätten Strategien besser getroffen als Zufall?
  const START = 200;
  const strategien = backtest(START);
  musterCache = {
    n: N, min: Math.min(...werte), max: Math.max(...werte), minZ: werte.indexOf(Math.min(...werte)) + 1,
    maxZ: werte.indexOf(Math.max(...werte)) + 1, pZahlen: chi2p(chi, 48), pSz: szN ? chi2p(chiSz, 9) : null, szN,
    rep: rep / (N - 1), korr, strategien, getestet: N - START,
  };
  return musterCache;
}
function pearson(x, y) {
  const mx = x.reduce((s, v) => s + v, 0) / x.length;
  const my = y.reduce((s, v) => s + v, 0) / y.length;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}
// Spielt jede Strategie über alle Ziehungen nach: Tipp = die 6 Zahlen nach Regel,
// nur mit dem Wissen bis zum Vortag, gemessen an der echten Ziehung
function backtest(start) {
  const N = draws.length;
  const regeln = [
    { art: 'heiss100', name: '🔥 Heißeste 6 der letzten 100 Ziehungen' },
    { art: 'heissAlle', name: '🔥 Heißeste 6 aller bisherigen Ziehungen' },
    { art: 'kalt100', name: '🧊 Kälteste 6 der letzten 100 Ziehungen' },
    { art: 'ueberfaellig', name: '⏳ Die 6 am längsten nicht gezogenen' },
  ];
  const zuletzt = new Array(50).fill(-1);
  const gesamt = new Array(50).fill(0);
  const fenster = new Array(50).fill(0); // Häufigkeit in den letzten 100 Ziehungen
  const erg = regeln.map(() => ({ summe: 0, drei: 0 }));
  const nums = Array.from({ length: 49 }, (_, i) => i + 1);
  const top6 = (wert) => nums.slice().sort((x, y) => wert(y) - wert(x) || x - y).slice(0, 6);
  for (let t = 0; t < N; t++) {
    if (t >= start) {
      const tipps = {
        heiss100: top6((n) => fenster[n]),
        heissAlle: top6((n) => gesamt[n]),
        kalt100: top6((n) => -fenster[n]),
        ueberfaellig: top6((n) => -zuletzt[n]),
      };
      const gezogen = new Set(draws[t].n);
      regeln.forEach((r, i) => {
        const treffer = tipps[r.art].filter((n) => gezogen.has(n)).length;
        erg[i].summe += treffer;
        if (treffer >= 3) erg[i].drei++;
      });
    }
    for (const n of draws[t].n) { zuletzt[n] = t; gesamt[n]++; fenster[n]++; }
    if (t >= 100) for (const n of draws[t - 100].n) fenster[n]--;
  }
  return regeln.map((r, i) => ({ name: r.name, schnitt: erg[i].summe / (N - start), drei: erg[i].drei / (N - start) }));
}

function renderChancen() {
  const m = musterAnalyse();
  const pDrei = [3, 4, 5, 6].reduce((s, r) => s + pRichtige(r), 0);
  // Schwankung, die bei reinem Zufall normal ist: ±3 Standardfehler – bei 4 Strategien
  // × 2 Kennzahlen = 8 Vergleichen ist ein einzelner Ausreißer über 2 Standardfehler normal
  const band = 3 * Math.sqrt(6 * (6 / 49) * (43 / 49) * (43 / 48)) / Math.sqrt(m.getestet);
  const band3 = 3 * Math.sqrt(pDrei * (1 - pDrei) / m.getestet);
  const besser = m.strategien.filter((x) => x.schnitt > ERWARTET_RICHTIGE + band || x.drei > pDrei + band3);
  const auffaellig = m.pZahlen < 0.01 || (m.pSz !== null && m.pSz < 0.01) || besser.length > 0;

  $('musterUrteil').innerHTML = auffaellig
    ? '<div class="verdict-big">Auffälligkeit gefunden – genauer hinsehen</div><p>Mindestens eine Prüfung weicht stärker ab, als Zufall es erwarten lässt. Details unten.</p>'
    : `<div class="verdict-big">Nein – es gibt kein Muster.</div>
       <p>${zahl.format(m.n)} Ziehungen seit 1955 verhalten sich genau so, wie es reiner Zufall erwarten lässt. Für die nächste Ziehung hat <b>jede Zahl dieselbe Chance von 6 aus 49 = ${prozent(6 / 49, 1)}</b> – egal wie oft sie früher kam.</p>`;
  $('musterCard').classList.toggle('win', !auffaellig);

  const ok = (b) => (b ? '✅' : '⚠️');
  const tests = [
    [m.pZahlen >= 0.01, 'Kommen alle Zahlen gleich oft?',
      `Ja. Die ${m.maxZ} kam am häufigsten (${zahl.format(m.max)}×), die ${m.minZ} am seltensten (${zahl.format(m.min)}×). So große Unterschiede entstehen bei reinem Zufall in ${prozent(m.pZahlen)} der Fälle – völlig normal.`],
    [m.pSz === null || m.pSz >= 0.01, 'Ist die Superzahl gleichmäßig?',
      m.pSz === null ? 'Noch keine Superzahlen im Datenbestand.' : `Ja – ${zahl.format(m.szN)} Superzahlen, Abweichungen im Zufallsbereich (p = ${prozent(m.pSz)}).`],
    [Math.abs(m.rep - ERWARTET_RICHTIGE) < 0.05, 'Beeinflusst eine Ziehung die nächste?',
      `Nein. Im Schnitt tauchen ${m.rep.toFixed(3).replace('.', ',')} Zahlen der Vorziehung wieder auf – Zufall erwartet ${ERWARTET_RICHTIGE.toFixed(3).replace('.', ',')}.`],
    [Math.abs(m.korr) < 0.3, 'Setzen sich „heiße“ Zahlen fort?',
      `Nein. Wie oft eine Zahl in der ersten Hälfte aller Ziehungen kam, sagt nichts über die zweite Hälfte (Zusammenhang r = ${m.korr.toFixed(2).replace('.', ',')}; 0 = keiner).`],
  ];
  $('musterTests').innerHTML = tests.map(([gut, frage, text]) =>
    `<div class="check"><span class="ico" aria-hidden="true">${ok(gut)}</span><div><b>${frage}</b><span>${text}</span></div></div>`).join('');

  $('backtestInfo').textContent = `Jede Regel wurde über ${zahl.format(m.getestet)} echte Ziehungen nachgespielt – immer nur mit dem Wissen bis zum Vortag.`;
  $('backtestTabelle').innerHTML = `<thead><tr><th>Strategie</th><th class="n">Ø Richtige</th><th class="n">3+ Richtige</th></tr></thead><tbody>${
    m.strategien.map((x) => `<tr><td>${x.name}</td><td class="n">${x.schnitt.toFixed(3).replace('.', ',')}</td><td class="n">${prozent(x.drei, 2)}</td></tr>`).join('')
  }<tr class="ref"><td>🎲 Reiner Zufall (Mathematik)</td><td class="n">${ERWARTET_RICHTIGE.toFixed(3).replace('.', ',')}</td><td class="n">${prozent(pDrei, 2)}</td></tr></tbody>`;
  $('backtestUrteil').innerHTML = besser.length
    ? `⚠️ ${besser.map((x) => x.name).join(', ')} liegt über dem normalen Zufallsbereich – bei mehreren getesteten Regeln kann das trotzdem Zufall sein.`
    : `<b>Keine Strategie schlägt den Zufall.</b> Alle Werte liegen im normalen Schwankungsbereich `
      + `(Ø ${(ERWARTET_RICHTIGE - band).toFixed(2).replace('.', ',')}–${(ERWARTET_RICHTIGE + band).toFixed(2).replace('.', ',')} Richtige, `
      + `3+ Richtige ${prozent(pDrei - band3, 1)}–${prozent(pDrei + band3, 1)}). Kleine Ausreißer nach oben oder unten sind bei so vielen Vergleichen ganz normal.`;

  const ziehung = naechsteZiehung();
  $('chancenInfo').textContent = `Nächste Ziehung: ${datum(ziehung)} · gilt für jeden Tipp, jede Woche gleich.`;
  const zeilen = KLASSEN.slice(1).map((kl, i) => {
    const k = i + 1;
    const r = 6 - Math.floor((k - 1) / 2);
    const mitSz = k % 2 === 1;
    const p = pRichtige(r) * (mitSz ? 0.1 : 0.9);
    return `<tr><td>${kl.label}</td><td class="n">${chance(p)}</td><td class="n">${p < 0.0001 ? '&lt; 0,01 %' : prozent(p, 2)}</td></tr>`;
  }).join('');
  const pGewinn = pDrei + pRichtige(2) * 0.1;
  $('chancenTabelle').innerHTML = `<thead><tr><th>Gewinnklasse</th><th class="n">Chance</th><th class="n">in %</th></tr></thead><tbody>${zeilen}
    <tr class="hl"><td>Irgendein Gewinn</td><td class="n">${chance(pGewinn)}</td><td class="n">${prozent(pGewinn, 1)}</td></tr></tbody>`;
  const jahre = Math.round((1 / (pRichtige(6) * 0.1)) / ZIEHUNGEN_PRO_JAHR);
  $('chancenExtra').innerHTML = `Mit einem Tipp mittwochs und samstags kommt der Jackpot (6 + Superzahl) statistisch <b>alle ${zahl.format(jahre)} Jahre</b> einmal. Die Chance auf 6 Richtige ist in jeder Ziehung dieselbe – auch wenn eine Zahl „lange nicht dran war“.`;
}

// Muster, die Massen von Spielern tippen (sortierter Tipp) – die Formel kennt nur
// einzelne Zahlen, solche Kombinationen sind aber noch viel häufiger getippt
function musterIn(t) {
  if (t.some((n, i) => i >= 2 && t[i - 1] === n - 1 && t[i - 2] === n - 2)) return 'Zahlenreihe';
  const zeile = new Array(7).fill(0);
  const spalte = new Array(7).fill(0);
  for (const n of t) { zeile[Math.floor((n - 1) / 7)]++; spalte[(n - 1) % 7]++; }
  if (Math.max(...zeile) > 3 || Math.max(...spalte) > 3) return 'Linie auf dem Schein';
  const abst = t.slice(1).map((n, i) => n - t[i]);
  if (abst.every((d) => d === abst[0])) return 'gleiche Abstände';
  return null;
}

// Fritz-Formel: Erwartungswert eines Tipps in € (pro 1,20 € Einsatz)
function fritzWert(t) {
  const b = t.reduce((s, n) => s + FORMEL.beta[n - 1], 0);
  let w = 0;
  for (const k of Object.values(FORMEL.klassen)) {
    if (Number.isFinite(k.fest)) { w += k.p * k.fest; continue; }
    const mu = k.gewinner * Math.exp(k.kappa * b * (k.r / 6 - (6 - k.r) / 43));
    w += k.p * k.topf * (mu < 1e-9 ? 1 : (1 - Math.exp(-mu)) / mu);
  }
  return w;
}
// Rang unter allen möglichen Tipps (Stichprobe von 20.000 Zufallstipps, einmal berechnet)
let fritzVerteilung = null;
function fritzRang(w) {
  if (!fritzVerteilung) {
    fritzVerteilung = Array.from({ length: 20000 }, () => fritzWert(ziehe6())).sort((a, b) => a - b);
  }
  let lo = 0; let hi = fritzVerteilung.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (fritzVerteilung[m] < w) lo = m + 1; else hi = m; }
  return lo / fritzVerteilung.length;
}

// Fritz-Tipp: zufällig unter den besten Tipps laut Formel – ohne Muster, kaum
// Geburtstagszahlen, höchstens 2 Zahlen der letzten Ziehung. So wird es nicht
// jedes Mal derselbe Tipp (den würden dann womöglich auch andere spielen).
function fritzTipp() {
  const letzteZ = new Set(draws.length ? letzte().n : []);
  const kandidaten = [];
  for (let versuch = 0; versuch < 20000 && kandidaten.length < 400; versuch++) {
    const t = ziehe6().sort((a, b) => a - b);
    if (t.filter((n) => n <= 31).length > 2 || musterIn(t)) continue;
    if (t.filter((n) => letzteZ.has(n)).length > 2) continue;
    kandidaten.push([FORMEL ? fritzWert(t) : 0, t]);
  }
  if (!kandidaten.length) return ziehe6().sort((a, b) => a - b);
  kandidaten.sort((a, b) => b[0] - a[0]);
  const beste = kandidaten.slice(0, Math.max(1, Math.ceil(kandidaten.length * 0.05)));
  return beste[Math.floor(Math.random() * beste.length)][1];
}
function nimmFritzTipp() {
  tipNums = new Set(fritzTipp());
  tippGeaendert(true);
  setHinweis(FORMEL
    ? `🧮 Fritz-Tipp: bringt laut Formel im Schnitt ${(fritzWert(sortiert(tipNums)) * 100).toFixed(1).replace('.', ',')} Cent statt ${(FORMEL.ev0 * 100).toFixed(1).replace('.', ',')} – gleiche Chance, höhere Quoten.`
    : '🧮 Fritz-Tipp: kaum Geburtstagszahlen, keine Muster – gleiche Chance, im Schnitt höhere Quoten.', 'ok');
}
const cent = (w) => `${(w * 100).toFixed(1).replace('.', ',')} ct`;
// Rang als Text – an den Rändern ehrlich statt „0 %“ / „100 %“
const rangText = (r) => (r >= 0.99 ? 'über 99 %' : r < 0.01 ? 'unter 1 %' : prozent(r));

function renderFritz() {
  if (!FORMEL) return;
  $('fritzCard').classList.remove('hidden');
  $('fritzN').textContent = zahl.format(FORMEL.ziehungen);
  if (tippKomplett()) {
    const t = sortiert(tipNums);
    const w = fritzWert(t);
    const plus = w / FORMEL.ev0 - 1;
    const b = t.reduce((s, n) => s + FORMEL.beta[n - 1], 0);
    const muster = musterIn(t);
    $('fritzDein').innerHTML = `<p class="small"><b>Dein Tipp ${t.join(' ')}</b> · Beliebtheit B(T) = ${b >= 0 ? '+' : '−'}${Math.abs(b).toFixed(3).replace('.', ',')}</p>
      <div class="money">
        <div><small>Wert pro 1,20 €</small><b>${cent(w)}</b></div>
        <div><small>Ø-Tipp</small><b>${cent(FORMEL.ev0)}</b></div>
        <div><small>Besser als</small><b>${rangText(fritzRang(w))}</b></div>
      </div>
      <p class="small" style="margin-top:8px">${plus >= 0 ? `Ein Gewinn mit diesem Tipp bringt im Schnitt <b>${prozent(plus)} mehr</b>` : `Ein Gewinn mit diesem Tipp bringt im Schnitt <b>${prozent(-plus)} weniger</b>`} als mit einem Durchschnittstipp – weil ${plus >= 0 ? 'weniger' : 'mehr'} Mitspieler diese Zahlen tippen. Unter 1,20 € bleibt jeder Tipp: Lotto ist im Schnitt immer ein Verlustgeschäft.</p>
      ${muster ? `<p class="fritz-warn">⚠️ Dein Tipp enthält ein Muster (${muster}) – so etwas tippen extrem viele; die Formel unterschätzt das eher.</p>` : ''}`;
  } else {
    $('fritzDein').innerHTML = '<p class="muted small">Wähle unter „Mein Tipp“ 6 Zahlen – dann rechnet die Formel deinen Tipp aus.</p>';
  }
  const max = Math.max(...FORMEL.beta.map(Math.abs));
  let h = '';
  for (let n = 1; n <= 49; n++) {
    const v = FORMEL.beta[n - 1];
    const st = Math.round((Math.abs(v) / max) * 80);
    const farbe = v >= 0 ? 'var(--accent)' : 'var(--cool)';
    const gerundet = Math.round(Math.abs(v) * 100);
    const pz = gerundet === 0 ? '±0 %' : `${v >= 0 ? '+' : '−'}${gerundet} %`;
    h += `<button type="button" tabindex="-1" class="${st > 50 ? 'hot' : ''}" style="background:color-mix(in srgb, ${farbe} ${st}%, var(--surface))" `
      + `aria-label="Zahl ${n}: ${pz} Mitgewinner gegenüber dem Schnitt"><b>${n}</b><small>${pz}</small></button>`;
  }
  $('fritzHeat').innerHTML = h;
  $('fritzQualitaet').textContent = `Gelernt aus ${zahl.format(FORMEL.ziehungen)} Ziehungen (${datum(FORMEL.von)} – ${datum(FORMEL.stand)}). `
    + `Das Modell sagt die Zahl der Mitgewinner einer Ziehung zu ${prozent(FORMEL.r2)} voraus – geprüft an Ziehungen, die es beim Lernen nicht kannte (10-fache Kreuzvalidierung). `
    + `Ein Ø-Tipp bringt ${cent(FORMEL.ev0)} pro 1,20 € zurück – passt zur offiziellen Ausschüttung von rund 50 %.`;
}

// ---------- Simulator ----------
function renderSimTipp() {
  const ok = tippKomplett();
  if (ok) {
    const z = { n: sortiert(tipNums), sz: tipSz === null ? -1 : tipSz };
    $('simTip').innerHTML = `<div class="balls">${kugeln(z, maskeVon(z.n), tipSz)}</div>` +
      `<p class="muted small" style="margin-top:8px">${tipSz === null ? 'Ohne Superzahl – im Dauerlauf wird eine zufällige genommen. ' : ''}Ändern unter „Mein Tipp“.</p>`;
  } else {
    $('simTip').innerHTML = `<p>Noch kein vollständiger Tipp (6 Zahlen).</p>
      <div class="btn-row"><button class="btn" type="button" data-act="quick">🎲 Quicktipp nehmen</button>
      <button class="btn btn-ghost" type="button" data-act="goto">Zahlen selbst wählen</button></div>`;
  }
  $('btnLive').disabled = !ok || liveLaeuft;
  $('btnSim').disabled = !ok && !sim.running;
}

let liveLaeuft = false;
function liveZiehung() {
  if (!tippKomplett() || liveLaeuft) return;
  liveLaeuft = true;
  $('btnLive').disabled = true;
  const zug = ziehe6();
  const sz = Math.floor(Math.random() * 10);
  const mask = maskeVon(tipNums);
  const stage = $('liveBalls');
  stage.innerHTML = '';
  $('liveResult').textContent = '';
  const schritt = reduceMotion() ? 0 : 450;
  const kugel = (txt, cls) => {
    const s = document.createElement('span');
    s.className = 'ball big' + cls;
    s.textContent = txt;
    stage.append(s);
  };
  zug.forEach((n, i) => setTimeout(() => kugel(n, mask[n] ? ' hit' : ''), i * schritt));
  setTimeout(() => {
    const szTreffer = tipSz !== null && sz === tipSz;
    kugel(sz, ' sz' + (szTreffer ? ' hit' : ''));
    let r = 0;
    for (const n of zug) r += mask[n];
    const k = klasse(r, szTreffer);
    $('liveResult').innerHTML = `${r} Richtige${szTreffer ? ' + Superzahl' : ''} – ` +
      (k ? `🎉 Gewinn: ${KLASSEN[k].label} (ca. ${eur(KLASSEN[k].quote)})` : 'leider kein Gewinn.');
    liveLaeuft = false;
    $('btnLive').disabled = !tippKomplett();
  }, 6 * schritt);
}

const sim = { running: false };

function dauer(n) {
  const j = n / ZIEHUNGEN_PRO_JAHR;
  if (j >= 10) return `ca. ${zahl.format(Math.round(j))} Jahre`;
  if (j >= 1) return `ca. ${j.toFixed(1).replace('.', ',')} Jahre`;
  return `ca. ${plural(Math.max(1, Math.round(n / 2)), 'Woche', 'Wochen')}`;
}

function simStart() {
  if (sim.running) { simStop('⏹ Angehalten.'); return; }
  if (!tippKomplett()) return;
  Object.assign(sim, {
    running: true,
    n: 0,
    anzahl: new Array(10).fill(0),
    mask: maskeVon(tipNums),
    ziel: Number($('simTarget').value),
    szZufall: tipSz === null,
    sz: tipSz === null ? Math.floor(Math.random() * 10) : tipSz,
    pool: Uint8Array.from({ length: 49 }, (_, i) => i + 1),
  });
  $('btnSim').textContent = '⏹ Stopp';
  $('simTarget').disabled = true;
  $('simMsg').className = 'sim-msg';
  $('simMsg').textContent = sim.szZufall ? `Läuft … (Superzahl ${sim.sz}, zufällig gewählt)` : 'Läuft …';
  renderSimStats();
  requestAnimationFrame(simTick);
}

function simTick() {
  if (!sim.running) return;
  const { pool, mask, anzahl, ziel, sz } = sim;
  const ende = performance.now() + 28;
  let n = sim.n;
  let treffer = 0;
  outer: while (performance.now() < ende) {
    for (let i = 0; i < 20000; i++) {
      // 6 aus 49 per Teil-Fisher-Yates (gleichverteilt, egal wie 'pool' gerade liegt)
      let r = 0;
      for (let j = 0; j < 6; j++) {
        const x = j + Math.floor(Math.random() * (49 - j));
        const t = pool[j]; pool[j] = pool[x]; pool[x] = t;
        r += mask[pool[j]];
      }
      n++;
      if (r < 2) continue;
      const k = klasse(r, Math.floor(Math.random() * 10) === sz);
      if (k) {
        anzahl[k]++;
        if (k <= ziel) { treffer = k; break outer; }
      }
    }
  }
  sim.n = n;
  renderSimStats();
  if (treffer) {
    simStop(`🎉 Geschafft: ${KLASSEN[treffer].label} nach ${zahl.format(n)} Ziehungen – das wären ${dauer(n)} Lotto (mittwochs und samstags).`);
    $('simMsg').classList.add('done');
  } else {
    requestAnimationFrame(simTick);
  }
}

function simStop(text) {
  sim.running = false;
  $('btnSim').textContent = "▶ Los geht's";
  $('simTarget').disabled = false;
  $('btnSim').disabled = !tippKomplett();
  $('simMsg').textContent = text;
}

function renderSimStats() {
  const einsatz = sim.n * PREIS;
  const gewinn = sim.anzahl.reduce((s, c, k) => s + (k ? c * KLASSEN[k].quote : 0), 0);
  const saldo = gewinn - einsatz;
  const chips = KLASSEN.slice(1).map((kl, i) => (sim.anzahl[i + 1] ? `<span>${kl.kurz}: ${zahl.format(sim.anzahl[i + 1])}×</span>` : '')).join('');
  $('simStats').innerHTML = `
    <div><small>Ziehungen</small><b>${zahl.format(sim.n)}</b></div>
    <div><small>Dauer</small><b>${dauer(sim.n)}</b></div>
    <div><small>Einsatz</small><b>${eur(einsatz)}</b></div>
    <div><small>Bilanz ca.</small><b class="${saldo >= 0 ? 'pos' : 'neg'}">${saldo >= 0 ? '+' : '−'}${eur(Math.abs(saldo))}</b></div>
    <div class="wide"><small>Gewinne bisher</small><div class="sim-classes">${chips || '<span>noch keine</span>'}</div></div>`;
}

// ---------- Tabs, Theme, Start ----------
let aktiverTab = 'tipp';
function zeigeTab(name) {
  if (!$('tab-' + name)) name = 'tipp';
  aktiverTab = name;
  for (const b of document.querySelectorAll('.tabs [role=tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const p of document.querySelectorAll('.panel')) p.hidden = p.id !== 'tab-' + name;
  write(KEY.tab, name);
  if (!draws.length) return;
  if (name === 'archiv') renderArchiv();
  if (name === 'statistik') renderStatistik();
  if (name === 'chancen') { renderChancen(); renderFritz(); }
  if (name === 'simulator') renderSimTipp();
}

function allesNeuZeichnen() {
  zeigeDatenInfo();
  renderErgebnis();
  zeigeTab(aktiverTab);
}

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  $('themeToggle').textContent = t === 'dark' ? '☀️' : '🌙';
  document.querySelector('meta[name=theme-color]').content = t === 'dark' ? '#262320' : '#f4f1ea';
  app('theme', t); // Statusleiste der App mitfärben
}

// ---------- Android-App ----------
function renderAppKarte() {
  if (!APP) return;
  $('appCard').classList.remove('hidden');
  const an = !!app('benachrichtigungen');
  $('btnNotify').textContent = an ? '🔕 Ausschalten' : '🔔 Einschalten';
  $('btnNotify').classList.toggle('btn-primary', !an);
  $('btnNotifyTest').disabled = !an;
  $('appInfo').textContent = `${an ? '✓ Benachrichtigungen sind an.' : 'Benachrichtigungen sind aus.'} · App-Version ${app('version') || '?'}`;
}
// Aufrufe aus der App (Java): Status neu zeichnen, Bereich wechseln, Zurück-Taste
window.lottoAppStatus = renderAppKarte;
window.lottoZeigeTab = (name) => { zeigeTab(name); window.scrollTo({ top: 0 }); };
window.lottoZurueck = () => {
  if (aktiverTab === 'tipp') return false;
  window.lottoZeigeTab('tipp');
  return true;
};

function binde() {
  $('themeToggle').addEventListener('click', () => {
    const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(t);
    try { localStorage.setItem(KEY.theme, t); } catch {}
  });
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[role=tab]');
    if (b) { zeigeTab(b.dataset.tab); window.scrollTo({ top: 0 }); }
  });

  $('tipInput').addEventListener('input', leseEingabe);
  $('tipInput').addEventListener('change', () => { if (!$('tipHint').classList.contains('warn')) $('tipInput').value = sortiert(tipNums).join(' '); });
  $('quickTip').addEventListener('click', () => { tipNums = new Set(ziehe6()); tippGeaendert(true); });
  $('klugTip').addEventListener('click', nimmFritzTipp);
  $('klugTip2').addEventListener('click', () => { nimmFritzTipp(); window.lottoZeigeTab('tipp'); });
  $('clearTip').addEventListener('click', () => { tipNums.clear(); tipSz = null; tippGeaendert(true); });
  $('saveTip').addEventListener('click', merkeTipp);
  $('favList').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const favs = favoriten();
    if (b.dataset.del !== undefined) {
      favs.splice(Number(b.dataset.del), 1);
      write(KEY.favs, favs);
      renderFavs();
      tippsAnApp();
    } else if (b.dataset.load !== undefined) {
      const f = favs[Number(b.dataset.load)];
      if (!f) return;
      tipNums = new Set(f.nums);
      tipSz = f.sz;
      tippGeaendert(true);
    }
  });
  $('result').addEventListener('click', (e) => {
    const b = e.target.closest('#yearStrip button[data-jahr]');
    if (b) zeigeJahr(b.dataset.jahr);
    if (e.target.closest('#btnEcht')) echteBilanzLaden();
  });
  // 'toggle' blubbert nicht → in der Capture-Phase abfangen
  $('result').addEventListener('toggle', (e) => {
    const det = e.target;
    if (!det.matches || !det.matches('details.year') || !det.open) return;
    const daten = [...det.querySelectorAll('.real[data-d]')].map((el) => el.dataset.d);
    ladeQuoten(daten).then(fuelleQuoten);
  }, true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') aktualisieren(false);
  });

  $('yearSelect').addEventListener('change', renderArchiv);
  $('btnUpdate').addEventListener('click', () => aktualisieren(true));

  $('statRange').addEventListener('change', renderStatistik);
  $('heat').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-n]');
    if (!b) return;
    const range = zeitraum($('statRange').value);
    const cnt = new Array(50).fill(0);
    for (const z of range) for (const n of z.n) cnt[n]++;
    const zuletztIdx = new Array(50).fill(-1);
    draws.forEach((z, i) => { for (const n of z.n) zuletztIdx[n] = i; });
    zeigeZahlInfo(Number(b.dataset.n), cnt, range.length, zuletztIdx);
  });

  $('simTip').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    if (b.dataset.act === 'quick') { tipNums = new Set(ziehe6()); tippGeaendert(true); renderSimTipp(); }
    else { zeigeTab('tipp'); window.scrollTo({ top: 0 }); }
  });
  $('btnLive').addEventListener('click', liveZiehung);
  $('btnSim').addEventListener('click', simStart);

  $('btnNotify').addEventListener('click', () => {
    app('setBenachrichtigungen', !app('benachrichtigungen'), draws.length ? letzte().d : '');
    setTimeout(renderAppKarte, 400);
  });
  $('btnNotifyTest').addEventListener('click', () => {
    app('testBenachrichtigung');
    $('appInfo').textContent = 'Test läuft – die Benachrichtigung kommt gleich.';
    setTimeout(renderAppKarte, 4000);
  });
}

async function init() {
  applyTheme(document.documentElement.getAttribute('data-theme') || 'light');
  baueSchein();
  ladeQuotenCache();
  const t = read(KEY.tipp);
  if (t && Array.isArray(t.nums) && t.nums.length <= 6 && t.nums.every((n) => Number.isInteger(n) && n >= 1 && n <= 49)) tipNums = new Set(t.nums);
  if (t && gueltigeSz(t.sz)) tipSz = t.sz ?? null;
  renderFavs();
  binde();
  renderAppKarte();
  // Im Browser auf Android: Hinweis auf die installierbare App (APK)
  if (!APP && /Android/i.test(navigator.userAgent)) $('apkLink').classList.remove('hidden');
  const anker = location.hash.slice(1);
  zeigeTab($('tab-' + anker) ? anker : read(KEY.tab) || 'tipp');

  try {
    await ladeDaten();
  } catch (e) {
    $('loadError').textContent = `Ziehungen konnten nicht geladen werden (${e.message}). Bitte Seite neu laden.`;
    $('loadError').classList.remove('hidden');
    $('dataInfo').textContent = 'Keine Daten';
    return;
  }
  zeigeDatenInfo();
  tippGeaendert(true);
  zeigeTab(aktiverTab);
  aktualisieren(false);

  // Offline-Cache nur im Browser – in der App liegt alles schon im Gerät
  if (!APP && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
