// Sonne, Mond und Schwerkraft am Ziehungsort zur Ziehungszeit – ohne Seitenbezug,
// damit App und Prüfskripte dieselbe Rechnung nutzen.
// Näherungsformeln des Astronomical Almanac (Mond auf ca. 0,3° genau, das reicht hier).
const RAD = Math.PI / 180;
const GM_MOND = 4.9028e12;        // m³/s²
const GM_SONNE = 1.32712440018e20;
const AE = 1.495978707e11;        // m
const ERDRADIUS = 6.371e6;        // m

// Ziehungsort: bis Juni 2013 Frankfurt am Main, seit Juli 2013 Saarbrücken
export function ziehungsort(iso) {
  return iso < '2013-07-01'
    ? { name: 'Frankfurt am Main', lat: 50.11, lon: 8.68, hoehe: 112 }
    : { name: 'Saarbrücken', lat: 49.24, lon: 6.99, hoehe: 230 };
}

// Ziehungszeit als Weltzeit (ms): mittwochs 18:25, sonst 19:25 Uhr deutscher Zeit
let stundeBerlin = null;
try {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23' });
  stundeBerlin = (ms) => Number(f.format(new Date(ms)).replace(/\D/g, ''));
} catch { /* ältere Umgebung ohne Zeitzonen-Daten → Winterzeit annehmen */ }
export function ziehungszeit(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const std = new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 3 ? 18 : 19;
  const ms = Date.UTC(y, m - 1, d, std, 25);
  let versatz = 1;
  if (stundeBerlin) { const h = stundeBerlin(ms); if (Number.isFinite(h)) versatz = (((h - std) % 24) + 24) % 24; }
  if (versatz !== 1 && versatz !== 2) versatz = 1;
  return ms - versatz * 3600000;
}

// Stand von Sonne und Mond zu einem Zeitpunkt (ms Weltzeit) an einem Ort
export function gestirne(ms, ort) {
  const n = ms / 86400000 + 2440587.5 - 2451545.0;
  const T = n / 36525;
  const a = (x, y) => (x + y * T) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  // Sonne
  const g = (357.528 + 0.9856003 * n) * RAD;
  const ls = (280.460 + 0.9856474 * n + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
  const R = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g); // Sonnenabstand in AE
  const raS = Math.atan2(Math.cos(eps) * Math.sin(ls), Math.cos(ls));
  const deS = Math.asin(Math.sin(eps) * Math.sin(ls));
  // Mond
  const lm = (218.32 + 481267.881 * T + 6.29 * Math.sin(a(135.0, 477198.87)) - 1.27 * Math.sin(a(259.3, -413335.36))
    + 0.66 * Math.sin(a(235.7, 890534.22)) + 0.21 * Math.sin(a(269.9, 954397.74)) - 0.19 * Math.sin(a(357.5, 35999.05))
    - 0.11 * Math.sin(a(186.5, 966404.03))) * RAD;
  const bm = (5.13 * Math.sin(a(93.3, 483202.03)) + 0.28 * Math.sin(a(228.2, 960400.87)) - 0.28 * Math.sin(a(318.3, 6003.18))
    - 0.17 * Math.sin(a(217.6, -407332.20))) * RAD;
  const par = (0.9508 + 0.0518 * Math.cos(a(135.0, 477198.87)) + 0.0095 * Math.cos(a(259.3, -413335.36))
    + 0.0078 * Math.cos(a(235.7, 890534.22)) + 0.0028 * Math.cos(a(269.9, 954397.74))) * RAD;
  const mondAbstand = 6378140 / Math.sin(par); // m
  const xl = Math.cos(bm) * Math.cos(lm);
  const yl = Math.cos(eps) * Math.cos(bm) * Math.sin(lm) - Math.sin(eps) * Math.sin(bm);
  const zl = Math.sin(eps) * Math.cos(bm) * Math.sin(lm) + Math.cos(eps) * Math.sin(bm);
  const raM = Math.atan2(yl, xl);
  const deM = Math.asin(zl);
  // Höhe über dem Horizont am Ort
  const lst = (280.46061837 + 360.98564736629 * n + ort.lon) * RAD;
  const phi = ort.lat * RAD;
  const sinHoehe = (ra, de) => Math.sin(phi) * Math.sin(de) + Math.cos(phi) * Math.cos(de) * Math.cos(lst - ra);
  const sM = sinHoehe(raM, deM);
  const sS = sinHoehe(raS, deS);
  // Gezeitenbeschleunigung senkrecht nach oben: GM · r / d³ · (3·cos²ψ − 1), ψ = Abstand vom Zenit
  const hochMond = (GM_MOND * ERDRADIUS / mondAbstand ** 3) * (3 * sM * sM - 1);
  const hochSonne = (GM_SONNE * ERDRADIUS / (R * AE) ** 3) * (3 * sS * sS - 1);
  const elong = ((((lm - ls) / RAD) % 360) + 360) % 360; // 0 = Neumond, 180 = Vollmond
  return {
    R, elong, phase: Math.floor(((elong + 22.5) % 360) / 45), mondAbstand,
    mondHoehe: Math.asin(sM) / RAD, sonnenHoehe: Math.asin(sS) / RAD,
    dg: -(hochMond + hochSonne) * 1e6, // Änderung der Schwerkraft durch Mond + Sonne in µm/s² (+ = schwerer)
  };
}

// Normalschwere am Ort (m/s²) – ohne Mond und Sonne
export function normalschwere(ort) {
  const s = Math.sin(ort.lat * RAD) ** 2;
  const s2 = Math.sin(2 * ort.lat * RAD) ** 2;
  return 9.780327 * (1 + 0.0053024 * s - 0.0000058 * s2) - 3.086e-6 * ort.hoehe;
}

// Alles für einen Ziehungstag (gemerkt, weil für jede der gut 5.000 Ziehungen gebraucht)
const merk = new Map();
export function himmel(iso) {
  let h = merk.get(iso);
  if (!h) {
    const ort = ziehungsort(iso);
    h = gestirne(ziehungszeit(iso), ort);
    h.g = normalschwere(ort) + h.dg * 1e-6; // gefühlte Schwerkraft zur Ziehungszeit in m/s²
    merk.set(iso, h);
  }
  return h;
}
