// Kandidaten-Beobachtung: Formeln, die ab jetzt vor jeder Ziehung mittippen.
// In allen bisherigen Ziehungen war keiner dieser Einflüsse sicher nachweisbar. Alte
// Ziehungen weiter zu durchsuchen beweist nichts (bei genug Suchen passt immer etwas) –
// deshalb wird jeder Tipp VOR der Ziehung festgeschrieben und die Bilanz zählt mit.
// Ohne Seitenbezug, damit Prüfskripte dieselbe Rechnung nutzen können.
import { himmel } from './himmel.js';

const P = 6 / 49;                 // Chance einer Zahl je Ziehung
const Q = 30 / (49 * 48);         // Chance eines Zahlenpaars je Ziehung
const NACHBAR = 0.6119;           // erwartete Nachbarpaare je Ziehung
const K_UMWELT = 20;              // Dämpfung: so viele „gedachte“ Durchschnitts-Ziehungen
const K_PAAR = 30;

export const MONDPHASEN = ['Neumond', 'zunehmende Sichel', 'erstes Viertel', 'zunehmender Mond', 'Vollmond', 'abnehmender Mond', 'letztes Viertel', 'abnehmende Sichel'];
const SONNE = ['Sonne sehr nah', 'Sonne nah', 'Sonne mittel', 'Sonne fern', 'Sonne sehr fern'];
const ERDE = ['deutlich leichter', 'etwas leichter', 'mittel', 'etwas schwerer', 'am schwersten'];

// Umwelt-Faktoren: Einteilung eines Ziehungstags in feste Stufen (Grenzen = Fünftel aller Ziehungen)
export const FAKTOREN = {
  sonne: { stufe: (h) => (h.R < 0.9865 ? 0 : h.R < 0.9950 ? 1 : h.R < 1.0055 ? 2 : h.R < 1.0140 ? 3 : 4), text: (g) => SONNE[g] },
  mond: { stufe: (h) => h.phase, text: (g) => MONDPHASEN[g] },
  // Schwerkraft am Ziehungsort zur Ziehungszeit: Mond und Sonne ändern sie je nach Stand um bis zu ±0,00001 %
  erde: { stufe: (h) => (h.dg < -0.075 ? 0 : h.dg < 0.310 ? 1 : h.dg < 0.556 ? 2 : h.dg < 0.688 ? 3 : 4), text: (g) => ERDE[g] },
};

// ln((Treffer + K) / (erwartet + K)) je Zahl: wie oft kam sie bisher unter derselben Bedingung?
function umweltWerte(draws, d, namen) {
  const e = new Float64Array(50);
  for (const name of namen) {
    const f = FAKTOREN[name];
    const ziel = f.stufe(himmel(d));
    const cnt = new Float64Array(50);
    let anzahl = 0;
    for (const z of draws) {
      if (z.d >= d || f.stufe(himmel(z.d)) !== ziel) continue;
      anzahl++;
      for (const n of z.n) cnt[n]++;
    }
    for (let n = 1; n <= 49; n++) e[n] += Math.log((cnt[n] + K_UMWELT) / (anzahl * P + K_UMWELT));
  }
  return e;
}
const beste6 = (wert) => Array.from({ length: 49 }, (_, i) => i + 1).sort((x, y) => wert[y] - wert[x] || x - y).slice(0, 6).sort((x, y) => x - y);
const nachbarpaare = (t) => { const s = t.slice().sort((a, b) => a - b); let c = 0; for (let i = 1; i < 6; i++) if (s[i] - s[i - 1] === 1) c++; return c; };

// Resonanz-Formel: R(T) = Σ (Sonne + Mond + Erde je Zahl) + Σ Verträglichkeit je Paar + λ · Nachbarpaare
//   Verträglichkeit V(i,j) = ln((gemeinsame Ziehungen + K) / (erwartet + K))
//   λ = ln((bisher gezählte Nachbarpaare + 50) / (erwartete + 50))
// Tipp = die Sechsergruppe mit dem höchsten R (von jeder Startzahl aus gierig aufgebaut).
export function resonanzTipp(draws, d) {
  const alt = draws.filter((z) => z.d < d);
  const t = alt.length;
  const e = umweltWerte(alt, d, ['sonne', 'mond', 'erde']);
  const id = (a, b) => (a < b ? a * 50 + b : b * 50 + a);
  const g = new Float64Array(2500);
  let nb = 0;
  for (const z of alt) {
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) g[id(z.n[i], z.n[j])]++;
    nb += nachbarpaare(z.n);
  }
  const v = new Float64Array(2500);
  for (let a = 1; a <= 49; a++) for (let b = a + 1; b <= 49; b++) v[id(a, b)] = Math.log((g[id(a, b)] + K_PAAR) / (t * Q + K_PAAR));
  const lam = Math.log((nb + 50) / (t * NACHBAR + 50));
  const R = (T) => { let s = lam * nachbarpaare(T); for (let i = 0; i < 6; i++) { s += e[T[i]]; for (let j = i + 1; j < 6; j++) s += v[id(T[i], T[j])]; } return s; };
  let best = null; let bestR = -Infinity;
  for (let s = 1; s <= 49; s++) {
    const T = [s];
    while (T.length < 6) {
      let bn = 0; let bv = -Infinity;
      for (let n = 1; n <= 49; n++) {
        if (T.includes(n)) continue;
        let w = e[n];
        for (const q of T) w += v[id(n, q)] + (Math.abs(n - q) === 1 ? lam : 0);
        if (w > bv) { bv = w; bn = n; }
      }
      T.push(bn);
    }
    const r = R(T);
    if (r > bestR) { bestR = r; best = T; }
  }
  return best.sort((a, b) => a - b);
}

export const KANDIDATEN = [
  { id: 'sonne', name: '🌞 Sonnenabstand', tipp: (draws, d) => beste6(umweltWerte(draws, d, ['sonne'])), text: (d) => FAKTOREN.sonne.text(FAKTOREN.sonne.stufe(himmel(d))) },
  { id: 'mond', name: '🌙 Mondphase', tipp: (draws, d) => beste6(umweltWerte(draws, d, ['mond'])), text: (d) => FAKTOREN.mond.text(FAKTOREN.mond.stufe(himmel(d))) },
  { id: 'erde', name: '🌍 Schwerkraft', tipp: (draws, d) => beste6(umweltWerte(draws, d, ['erde'])), text: (d) => FAKTOREN.erde.text(FAKTOREN.erde.stufe(himmel(d))) },
  { id: 'resonanz', name: '✨ Resonanz-Formel', tipp: resonanzTipp, text: () => 'Sonne + Mond + Erde + Paare' },
];
