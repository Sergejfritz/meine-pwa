// Trainiert zwei neuronale Netze auf allen Ziehungen und testet sie ehrlich an
// Ziehungen, die sie beim Lernen nie gesehen haben (walk-forward). Schreibt
// lotto/netz.json: Testergebnis beider Netze + Gewichte des kleinen Netzes, damit
// die App dessen Bewertung für die nächste Ziehung selbst ausrechnen kann.
//
//   node scripts/lotto-netz.mjs
//
// Netz A („je Zahl“): dasselbe kleine Netz bewertet jede der 49 Zahlen aus ihrem
//   Verlauf – kam sie zuletzt, wie oft in den letzten 10/50/200 Ziehungen, wie
//   lange Pause, wie oft insgesamt. Kann jede Regel der Art „heiß“, „kalt“,
//   „überfällig“, „Rhythmus“ lernen, auch krumme Mischungen davon.
// Netz B („ganze Ziehung“): sieht die letzten 6 Ziehungen komplett (alle 49 Zahlen
//   an/aus) plus die Pausen und sagt für alle 49 Zahlen gleichzeitig voraus. Kann
//   auch Zusammenhänge zwischen bestimmten Zahlen lernen.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const draws = fs.readFileSync(path.join(ROOT, 'lotto', 'ziehungen.txt'), 'utf8').trim().split('\n')
  .map((l) => { const p = l.split(' '); return { d: p[0], n: p.slice(1, 7).map(Number) }; });
const N = draws.length;
const P = 6 / 49;

// fester Zufall → jedes Training ist wiederholbar
let saat = 20261110;
const zufall = () => {
  saat = (saat + 0x6D2B79F5) | 0;
  let t = Math.imul(saat ^ (saat >>> 15), 1 | saat);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const normal = () => Math.sqrt(-2 * Math.log(zufall() + 1e-12)) * Math.cos(2 * Math.PI * zufall());

// ---------- kleines Netz (vollständig verbunden, tanh, Sigmoid-Ausgang, Adam) ----------
function neuesNetz(groessen) {
  const W = []; const B = [];
  for (let l = 1; l < groessen.length; l++) {
    const s = Math.sqrt(1 / groessen[l - 1]);
    W.push(Float64Array.from({ length: groessen[l] * groessen[l - 1] }, () => normal() * s));
    B.push(new Float64Array(groessen[l]));
  }
  // Ausgang startet bei der Grundchance 6/49
  B[B.length - 1].fill(Math.log(P / (1 - P)));
  const null_ = (a) => a.map((x) => new Float64Array(x.length));
  return { groessen, W, B, mW: null_(W), vW: null_(W), mB: null_(B), vB: null_(B), schritt: 0 };
}
function vorwaerts(netz, x, akt) {
  akt[0] = x;
  const L = netz.W.length;
  for (let l = 0; l < L; l++) {
    const nIn = netz.groessen[l]; const nOut = netz.groessen[l + 1];
    const w = netz.W[l]; const b = netz.B[l]; const ein = akt[l];
    const aus = akt[l + 1] || (akt[l + 1] = new Float64Array(nOut));
    for (let j = 0; j < nOut; j++) {
      let s = b[j];
      const o = j * nIn;
      for (let i = 0; i < nIn; i++) s += w[o + i] * ein[i];
      aus[j] = l === L - 1 ? 1 / (1 + Math.exp(-s)) : Math.tanh(s);
    }
  }
  return akt[L];
}
// ein Lernschritt über einen Stapel (Kreuzentropie); xs/ys: Listen von Float64Array
function lerne(netz, xs, ys, lr, decay) {
  const L = netz.W.length;
  const gW = netz.W.map((w) => new Float64Array(w.length));
  const gB = netz.B.map((b) => new Float64Array(b.length));
  const akt = [];
  const delta = netz.groessen.map((g) => new Float64Array(g));
  for (let s = 0; s < xs.length; s++) {
    const aus = vorwaerts(netz, xs[s], akt);
    const y = ys[s];
    for (let j = 0; j < aus.length; j++) delta[L][j] = aus[j] - y[j];
    for (let l = L - 1; l >= 0; l--) {
      const nIn = netz.groessen[l]; const nOut = netz.groessen[l + 1];
      const w = netz.W[l]; const ein = akt[l]; const d = delta[l + 1]; const dv = delta[l];
      if (l > 0) dv.fill(0);
      for (let j = 0; j < nOut; j++) {
        const dj = d[j];
        if (dj === 0) continue;
        gB[l][j] += dj;
        const o = j * nIn;
        for (let i = 0; i < nIn; i++) {
          gW[l][o + i] += dj * ein[i];
          if (l > 0) dv[i] += dj * w[o + i];
        }
      }
      if (l > 0) for (let i = 0; i < nIn; i++) dv[i] *= 1 - ein[i] * ein[i];
    }
  }
  netz.schritt++;
  const b1 = 0.9; const b2 = 0.999;
  const k1 = 1 - b1 ** netz.schritt; const k2 = 1 - b2 ** netz.schritt;
  const adam = (p, g, m, v, wd) => {
    for (let i = 0; i < p.length; i++) {
      const gi = g[i] / xs.length + wd * p[i];
      m[i] = b1 * m[i] + (1 - b1) * gi;
      v[i] = b2 * v[i] + (1 - b2) * gi * gi;
      p[i] -= lr * (m[i] / k1) / (Math.sqrt(v[i] / k2) + 1e-8);
    }
  };
  for (let l = 0; l < L; l++) { adam(netz.W[l], gW[l], netz.mW[l], netz.vW[l], decay); adam(netz.B[l], gB[l], netz.mB[l], netz.vB[l], 0); }
}
const kopie = (netz) => ({ ...netz, W: netz.W.map((w) => w.slice()), B: netz.B.map((b) => b.slice()) });
function verlust(netz, xs, ys) {
  const akt = []; let s = 0; let n = 0;
  for (let i = 0; i < xs.length; i++) {
    const aus = vorwaerts(netz, xs[i], akt);
    for (let j = 0; j < aus.length; j++) { const p = Math.min(Math.max(aus[j], 1e-9), 1 - 1e-9); s -= ys[i][j] ? Math.log(p) : Math.log(1 - p); n++; }
  }
  return s / n;
}
// Training mit frühem Stopp: die letzten 10 % des Lernzeitraums dienen nur zur Kontrolle
function trainiere(groessen, xs, ys, { epochen, stapel, lr, decay }) {
  const grenze = Math.floor(xs.length * 0.9);
  const netz = neuesNetz(groessen);
  let bestes = kopie(netz); let bestV = Infinity; let ohne = 0;
  const idx = Array.from({ length: grenze }, (_, i) => i);
  for (let e = 0; e < epochen; e++) {
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(zufall() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    for (let a = 0; a < idx.length; a += stapel) {
      const teil = idx.slice(a, a + stapel);
      lerne(netz, teil.map((i) => xs[i]), teil.map((i) => ys[i]), lr, decay);
    }
    const v = verlust(netz, xs.slice(grenze), ys.slice(grenze));
    if (v < bestV - 1e-6) { bestV = v; bestes = kopie(netz); ohne = 0; } else if (++ohne >= 3) break;
  }
  return bestes;
}

// ---------- Merkmale ----------
// Verlauf je Zahl bis VOR Ziehung t (nur Vergangenheit!). Muss zu lotto.js passen.
const MERKMALE = 9;
function verlaufBis(t) { // → Float64Array[49] mit je MERKMALE Werten
  const out = [];
  for (let n = 1; n <= 49; n++) {
    let c10 = 0; let c50 = 0; let c200 = 0; let alle = 0; let pause = -1;
    for (let k = 1; k <= t; k++) {
      const drin = draws[t - k].n.includes(n);
      if (!drin) continue;
      if (pause < 0) pause = k - 1;
      if (k <= 10) c10++;
      if (k <= 50) c50++;
      if (k <= 200) c200++;
      alle++;
    }
    if (pause < 0) pause = t;
    const war = (k) => (t - k >= 0 && draws[t - k].n.includes(n) ? 1 : 0);
    out.push(Float64Array.of(war(1), war(2), war(3), c10 / 10 / P - 1, c50 / 50 / P - 1, c200 / 200 / P - 1,
      Math.min(pause, 60) / 30 - 1, (alle / (t * P) - 1) * 5, n / 24.5 - 1));
  }
  return out;
}
// schneller: Verlauf für alle t einmal fortlaufend berechnen
function alleVerlaeufe() {
  const res = new Array(N + 1);
  const hist = Array.from({ length: 50 }, () => []); // Ziehungsindizes je Zahl
  for (let t = 0; t <= N; t++) {
    const zeile = [];
    for (let n = 1; n <= 49; n++) {
      const h = hist[n];
      const zaehle = (fenster) => { let c = 0; for (let i = h.length - 1; i >= 0 && h[i] >= t - fenster; i--) c++; return c; };
      const pause = h.length ? t - 1 - h[h.length - 1] : t;
      const war = (k) => (h.includes(t - k) ? 1 : 0);
      zeile.push(Float64Array.of(war(1), war(2), war(3), zaehle(10) / 10 / P - 1, zaehle(50) / 50 / P - 1, zaehle(200) / 200 / P - 1,
        Math.min(pause, 60) / 30 - 1, t ? (h.length / (t * P) - 1) * 5 : 0, n / 24.5 - 1));
    }
    res[t] = zeile;
    if (t < N) for (const n of draws[t].n) hist[n].push(t);
  }
  return res;
}
const V = alleVerlaeufe();
// Selbstprüfung der schnellen Variante gegen die einfache
for (const t of [250, 1777, N]) {
  const a = verlaufBis(t); const b = V[t];
  for (let n = 0; n < 49; n++) for (let i = 0; i < MERKMALE; i++) if (Math.abs(a[n][i] - b[n][i]) > 1e-9) throw new Error(`Merkmal weicht ab: t=${t} n=${n + 1} i=${i}`);
}

const START = 250;       // die ersten Ziehungen haben noch zu wenig Verlauf
const TEST = 1500;       // so viele der neuesten Ziehungen bleiben fürs Testen
const SCHRITT = 300;     // nach je 300 Test-Ziehungen wird mit allem Bisherigen neu gelernt

// Netz A: eine Probe je (Ziehung, Zahl)
const probenA = (von, bis) => {
  const xs = []; const ys = [];
  for (let t = von; t < bis; t++) for (let n = 1; n <= 49; n++) { xs.push(V[t][n - 1]); ys.push(Float64Array.of(draws[t].n.includes(n) ? 1 : 0)); }
  return [xs, ys];
};
const bewerteA = (netz, t) => { const akt = []; return V[t].map((x) => vorwaerts(netz, x, akt)[0]); };

// Netz B: eine Probe je Ziehung – letzte 6 Ziehungen (je 49 an/aus) + Pausen
const LETZTE = 6;
function eingabeB(t) {
  const x = new Float64Array(49 * LETZTE + 49);
  for (let k = 1; k <= LETZTE; k++) for (const n of draws[t - k].n) x[(k - 1) * 49 + n - 1] = 1;
  for (let n = 0; n < 49; n++) x[49 * LETZTE + n] = V[t][n][6];
  return x;
}
const probenB = (von, bis) => {
  const xs = []; const ys = [];
  for (let t = von; t < bis; t++) { xs.push(eingabeB(t)); const y = new Float64Array(49); for (const n of draws[t].n) y[n - 1] = 1; ys.push(y); }
  return [xs, ys];
};
const bewerteB = (netz, t) => Array.from(vorwaerts(netz, eingabeB(t), []));

const MODELLE = [
  { name: 'Netz A – je Zahl (Verlauf, Pausen, Häufigkeit)', groessen: [MERKMALE, 16, 8, 1], proben: probenA, bewerte: bewerteA, opt: { epochen: 12, stapel: 256, lr: 0.003, decay: 1e-5 } },
  { name: 'Netz B – ganze Ziehung (letzte 6 Ziehungen)', groessen: [49 * LETZTE + 49, 40, 49], proben: probenB, bewerte: bewerteB, opt: { epochen: 40, stapel: 32, lr: 0.001, decay: 1e-4 } },
];

const BASIS_VERLUST = -(P * Math.log(P) + (1 - P) * Math.log(1 - P));
const ergebnisse = [];
for (const m of MODELLE) {
  let summe = 0; let drei = 0; let verl = 0; let anzahl = 0;
  const klassen = new Array(7).fill(0);
  for (let von = N - TEST; von < N; von += SCHRITT) {
    const netz = trainiere(m.groessen, ...m.proben(START, von), m.opt);
    for (let t = von; t < Math.min(von + SCHRITT, N); t++) {
      const p = m.bewerte(netz, t);
      const tipp = p.map((v, i) => [v, i + 1]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, 6).map((x) => x[1]);
      const r = tipp.filter((n) => draws[t].n.includes(n)).length;
      summe += r; klassen[r]++; if (r >= 3) drei++;
      for (let n = 1; n <= 49; n++) { const q = Math.min(Math.max(p[n - 1], 1e-9), 1 - 1e-9); verl -= draws[t].n.includes(n) ? Math.log(q) : Math.log(1 - q); }
      anzahl++;
    }
  }
  const e = { name: m.name, schnitt: +(summe / anzahl).toFixed(4), drei: +(drei / anzahl).toFixed(4), verlust: +(verl / anzahl / 49).toFixed(5), richtige: klassen };
  ergebnisse.push(e);
  console.log(`${m.name}\n  Ø Richtige ${e.schnitt} (Zufall ${(36 / 49).toFixed(4)}) · 3+ Richtige ${(e.drei * 100).toFixed(2)} % (Zufall 1,86 %) · Fehlermaß ${e.verlust} (ohne Netz ${BASIS_VERLUST.toFixed(5)}) · Verteilung 0–6 Richtige: ${klassen.join(' ')}`);
}

// Netz A zum Schluss mit ALLEN Ziehungen lernen → Gewichte für die App
const endnetz = trainiere(MODELLE[0].groessen, ...probenA(START, N), MODELLE[0].opt);
const p = bewerteA(endnetz, N);
const tipp = p.map((v, i) => [v, i + 1]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, 6).map((x) => x[1]).sort((a, b) => a - b);
console.log(`Netz A, höchste Bewertung für die nächste Ziehung: ${tipp.join(' ')} (Spanne ${(Math.min(...p) * 100).toFixed(2)} %–${(Math.max(...p) * 100).toFixed(2)} %, Grundchance 12,24 %)`);

const rund = (a) => Array.from(a, (v) => +v.toFixed(5));
fs.writeFileSync(path.join(ROOT, 'lotto', 'netz.json'), JSON.stringify({
  stand: draws[N - 1].d, ziehungen: N, getestet: TEST, von: draws[N - TEST].d,
  basisVerlust: +BASIS_VERLUST.toFixed(5), modelle: ergebnisse,
  netz: { groessen: endnetz.groessen, W: endnetz.W.map(rund), B: endnetz.B.map(rund) },
  pruefTipp: tipp, // Kontrolle: die App muss mit denselben Daten dieselben 6 Zahlen finden
}) + '\n');
console.log('→ lotto/netz.json');
