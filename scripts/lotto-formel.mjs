// Trainiert die „Fritz-Formel“ und schreibt lotto/formel.json.
//
// Idee: Die Gewinnchance ist für jeden Tipp gleich – aber wie viel ein Gewinn wert
// ist, hängt davon ab, wie viele andere dieselben Zahlen getippt haben. Aus den
// echten Gewinnerzahlen jeder Ziehung (WestLotto) lernt das Skript per
// Ridge-Regression die Beliebtheit β jeder Zahl, prüft das Modell per
// 10-facher Kreuzvalidierung und misst, wie stark die Quote jeder Gewinnklasse
// auf die Beliebtheit der gezogenen Zahlen reagiert (κ).
//
//   node scripts/lotto-formel.mjs [cache.json]
//
// Mit cache.json werden bereits geladene Quoten wiederverwendet (und ergänzt).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = 'https://www.westlotto.de/wlinfo/WL_InfoService?client=jsn&gruppe=ZahlenUndQuoten&spielart=LOTTO&datum=';
const AB = '2020-09-23'; // seit hier: 1,20 € pro Tipp und die heutigen 9 Gewinnklassen
const PREIS = 1.2;
const CACHE = process.argv[2];

const KLASSEN = [
  ['6 + SZ', 6, true], ['6', 6, false], ['5 + SZ', 5, true], ['5', 5, false], ['4 + SZ', 4, true],
  ['4', 4, false], ['3 + SZ', 3, true], ['3', 3, false], ['2 + SZ', 2, true],
];
const binom = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
const pRichtige = (r) => (binom(6, r) * binom(43, 6 - r)) / binom(49, 6);
const pKlasse = Object.fromEntries(KLASSEN.map(([k, r, sz]) => [k, pRichtige(r) * (sz ? 0.1 : 0.9)]));

// ---------- Daten laden ----------
const daten = CACHE && fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const tage = fs.readFileSync(path.join(ROOT, 'lotto', 'ziehungen.txt'), 'utf8')
  .trim().split('\n').map((l) => l.slice(0, 10)).filter((d) => d >= AB);
const fehlend = tage.filter((d) => !daten[d]);
async function hole(d) {
  for (let v = 0; v < 3; v++) {
    try {
      const j = await (await fetch(LIVE + d)).json();
      const q = j.auswertung.quoten.hauptlotterie.ziehungen[0].gewinnklassen;
      const z = j.zahlen.hauptlotterie.ziehungen[0];
      return {
        n: z.zahlenSortiert.map(Number), sz: Number(z.superzahl), einsatz: j.auswertung.spieleinsatz.hauptlotterie,
        k: Object.fromEntries(q.map((x) => [x.kurzbeschreibung.trim(), [x.anzahl, x.quote, x.jackpot]])),
      };
    } catch { await new Promise((r) => setTimeout(r, 1000 * (v + 1))); }
  }
  return null;
}
for (let i = 0; i < fehlend.length; i += 4) {
  const teil = fehlend.slice(i, i + 4);
  const res = await Promise.all(teil.map(hole));
  teil.forEach((d, j) => { if (res[j]) daten[d] = res[j]; });
}
if (CACHE) fs.writeFileSync(CACHE, JSON.stringify(daten));
// nur vollständig ausgewertete Ziehungen (Quoten stehen fest)
const D = tage.filter((d) => daten[d] && daten[d].einsatz > 0 && daten[d].k['3'] && daten[d].k['3'][1] > 0);
console.log(`${D.length} Ziehungen mit Quoten (${D[0]} … ${D[D.length - 1]})`);

// ---------- Ridge-Regression ----------
function loese(A, b) { // Gauß mit Pivotsuche
  const n = b.length;
  const M = A.map((z, i) => [...z, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((z, i) => z[n] / z[i]);
}
function ridge(zeilen, y, lam) {
  const n = zeilen.length;
  const xm = new Array(49).fill(0);
  for (const z of zeilen) for (const i of z) xm[i] += 1 / n;
  const ym = y.reduce((s, v) => s + v, 0) / n;
  const A = Array.from({ length: 49 }, (_, i) => Array.from({ length: 49 }, (_, j) => (i === j ? lam : 0)));
  const b = new Array(49).fill(0);
  zeilen.forEach((z, t) => {
    const x = xm.map((m, i) => (z.includes(i) ? 1 : 0) - m);
    for (let i = 0; i < 49; i++) {
      b[i] += x[i] * (y[t] - ym);
      for (let j = 0; j < 49; j++) A[i][j] += x[i] * x[j];
    }
  });
  const beta = loese(A, b);
  const a = ym - xm.reduce((s, m, i) => s + m * beta[i], 0);
  return { beta, a };
}
const vorhersage = (m, z) => m.a + z.reduce((s, i) => s + m.beta[i], 0);

// Ziel: log(Gewinner / erwartete Gewinner bei gleichmäßiger Zahlenwahl), gemittelt aus
// „3 Richtige“ und „2 + SZ“ (je Hunderttausende Gewinner → kaum Zufallsrauschen)
const zeilen = D.map((d) => daten[d].n.map((x) => x - 1));
const logR = (d, k) => Math.log(Math.max(daten[d].k[k][0], 0.5) / ((daten[d].einsatz / PREIS) * pKlasse[k]));
const y = D.map((d) => (logR(d, '3') + logR(d, '2 + SZ')) / 2);

// 10-fache Kreuzvalidierung (fester Zufall → reproduzierbar)
let saat = 7;
const zufall = () => ((saat = (saat * 1103515245 + 12345) % 2147483648) / 2147483648);
const idx = D.map((_, i) => i);
for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(zufall() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
let bestes = null;
for (const lam of [1, 3, 10]) {
  const pred = new Array(D.length);
  for (let f = 0; f < 10; f++) {
    const test = idx.filter((_, i) => i % 10 === f);
    const testSet = new Set(test);
    const tr = idx.filter((i) => !testSet.has(i));
    const m = ridge(tr.map((i) => zeilen[i]), tr.map((i) => y[i]), lam);
    for (const i of test) pred[i] = vorhersage(m, zeilen[i]);
  }
  const ym = y.reduce((s, v) => s + v, 0) / y.length;
  const r2 = 1 - y.reduce((s, v, i) => s + (v - pred[i]) ** 2, 0) / y.reduce((s, v) => s + (v - ym) ** 2, 0);
  console.log(`λ=${lam}: Kreuzvalidiertes R² = ${r2.toFixed(3)}`);
  if (!bestes || r2 > bestes.r2) bestes = { r2, lam };
}
const modell = ridge(zeilen, y, bestes.lam);
const mittel = modell.beta.reduce((s, v) => s + v, 0) / 49;
const beta = modell.beta.map((v) => v - mittel); // Summe 0: positiv = beliebter als der Schnitt
const B = zeilen.map((z) => z.reduce((s, i) => s + beta[i], 0));

// ---------- Je Gewinnklasse: Topf, Ø Gewinnerzahl, Reaktion auf Beliebtheit (κ) ----------
// Gewinnt dein Tipp, teilst du den Topf mit X anderen; X ~ Poisson(μ) mit
// μ = Ø Gewinner · e^(κ·Beliebtheit). Dein erwarteter Anteil: Topf · (1 − e^−μ) / μ.
function steigung(xs, ys) {
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let sxy = 0; let sxx = 0;
  xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
  return sxy / sxx;
}
const schnitt = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const klassen = {};
for (const [k, r] of KLASSEN) {
  if (k === '2 + SZ') { klassen[k] = { r, p: pKlasse[k], fest: 6 }; continue; } // feste 6 €
  // κ aus den Gewinnerzahlen: log(Gewinner) ~ Beliebtheit der gezogenen Zahlen
  // (6 + SZ gewinnt zu selten → wie „6“; bei „6“ nur Ziehungen mit Gewinnern)
  const quelle = k === '6 + SZ' ? '6' : k;
  const pts = D.map((d, i) => [B[i], daten[d].k[quelle][0] / (daten[d].einsatz / PREIS)]).filter(([, w]) => w > 0);
  const kappa = steigung(pts.map((p) => p[0]), pts.map((p) => Math.log(p[1])));
  const gewinner = schnitt(D.map((d) => daten[d].k[k][0]));
  // Topf: bei Gewinnern = Quote × Anzahl; beim Jackpot ohne Gewinner der angesammelte Betrag
  const toepfe = D.map((d) => {
    const [anzahl, quote, jackpot] = daten[d].k[k];
    return anzahl > 0 ? quote * anzahl : (jackpot || 0);
  }).filter((v) => v > 0);
  klassen[k] = { r, p: pKlasse[k], kappa: +kappa.toFixed(3), topf: Math.round(schnitt(toepfe)), gewinner: +gewinner.toFixed(3) };
}
// ---------- Beliebtheit der Superzahl ----------
// Anteil der Gewinner MIT Superzahl unter allen mit 3 bzw. 4 Richtigen – bei gleich
// beliebten Superzahlen wären das 10 %. σ_j = Anteil / 10 % (1 = Durchschnitt).
const szSumme = new Array(10).fill(0);
const szAnzahl = new Array(10).fill(0);
for (const d of D) {
  const k = daten[d].k;
  const sz = daten[d].sz;
  if (!(sz >= 0 && sz <= 9)) continue;
  for (const r of ['3', '4']) {
    const mit = k[`${r} + SZ`][0];
    const ohne = k[r][0];
    if (mit + ohne > 0) { szSumme[sz] += mit / (mit + ohne); szAnzahl[sz]++; }
  }
}
const szRoh = szSumme.map((s, j) => (szAnzahl[j] ? s / szAnzahl[j] / 0.1 : 1));
const szMittel = szRoh.reduce((s, v) => s + v, 0) / 10;
const sz = szRoh.map((v) => +(v / szMittel).toFixed(4));

const anteil = (mu) => (mu < 1e-9 ? 1 : (1 - Math.exp(-mu)) / mu);
const ev0 = Object.values(klassen).reduce((s, k) => s + k.p * (k.fest ?? k.topf * anteil(k.gewinner)), 0);
const formel = {
  stand: D[D.length - 1], von: D[0], ziehungen: D.length, r2: +bestes.r2.toFixed(3),
  beta: beta.map((v) => +v.toFixed(4)), sz, klassen, ev0: +ev0.toFixed(4),
};
fs.writeFileSync(path.join(ROOT, 'lotto', 'formel.json'), JSON.stringify(formel) + '\n');
const rang = beta.map((v, i) => [i + 1, v]).sort((a, b) => b[1] - a[1]);
console.log('beliebteste:', rang.slice(0, 8).map(([n, v]) => `${n} (${(v * 100).toFixed(1)})`).join(', '));
console.log('unbeliebteste:', rang.slice(-8).map(([n, v]) => `${n} (${(v * 100).toFixed(1)})`).join(', '));
console.log('κ je Klasse:', Object.entries(klassen).filter(([, v]) => !v.fest).map(([k, v]) => `${k}: ${v.kappa}`).join(' · '));
console.log('Superzahl-Beliebtheit σ:', sz.map((v, j) => `${j}: ${v}`).join(' · '));
console.log(`Ø-Tipp bringt ${(ev0 * 100).toFixed(1)} Cent pro ${PREIS.toFixed(2)} € → lotto/formel.json`);
