// Arbeitskarte scannen: OCR (Tesseract, lokal/offline) + Feld-Extraktion.
// Probiert mehrere Rotationen, da das Foto gedreht sein kann, und nimmt das
// Ergebnis mit der höchsten Erkennungs-Confidence.
import { parseArbeitskarte, toIsoDate } from './cardparse.js';
import { Zones } from './store.js';
import { readZones } from './zones.js';

const TESS_BASE = 'vendor/tesseract';
let workerPromise = null;

// Tesseract wird erst bei Bedarf geladen (spart Start-Performance)
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Laden fehlgeschlagen: ' + src));
    document.head.appendChild(s);
  });
}

async function getWorker(onProgress) {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    await loadScript(`${TESS_BASE}/tesseract.min.js`);
    const T = window.Tesseract;
    const worker = await T.createWorker('deu', 1, {
      workerPath: `${TESS_BASE}/worker.min.js`,
      corePath: `${TESS_BASE}/`,
      langPath: 'vendor/tessdata',
      gzip: true,
      logger: (m) => {
        if (onProgress && m.status === 'recognizing text') onProgress(m.progress);
      },
    });
    return worker;
  })().catch((e) => { workerPromise = null; throw e; });
  return workerPromise;
}

// Bild als HTMLCanvas in gewünschter Rotation (0/90/180/270 Grad)
function rotated(img, deg) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  if (deg === 90 || deg === 270) { c.width = img.height; c.height = img.width; }
  else { c.width = img.width; c.height = img.height; }
  ctx.save();
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(deg * Math.PI / 180);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.restore();
  return c;
}

function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

// Großes Foto für OCR auf sinnvolle Kantenlänge begrenzen.
// 2600 px: genug Details für die kleine Kopf-Schrift, ohne die OCR zu bremsen.
function downscale(img, maxEdge = 2600) {
  const long = Math.max(img.width, img.height);
  if (long <= maxEdge) return img;
  const k = maxEdge / long;
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/**
 * Scannt eine Arbeitskarte.
 * @param {string} dataUrl  Bild als DataURL
 * @param {(p:number)=>void} onProgress  Fortschritt 0..1
 * @returns {Promise<{fields:object, confidence:number, text:string}>}
 */
export async function scanArbeitskarte(dataUrl, onProgress) {
  const worker = await getWorker(onProgress);
  const img = await loadImage(dataUrl);
  const base = downscale(img);

  // Übliche Ausrichtungen testen (Foto kann gedreht sein). Aufrechtes
  // Hochformat (0°) zuerst, dann die gedrehten Varianten.
  const angles = [0, 270, 90, 180];
  const KEY = ['abnr', 'zeichnungsnummer', 'kunde', 'teilebenennung', 'index', 'position'];
  let best = { score: -1, hits: 0, text: '', fields: {}, canvas: base };

  for (const angle of angles) {
    const canvas = angle === 0 ? base : rotated(base, angle);
    const { data } = await worker.recognize(canvas);
    const fields = parseArbeitskarte(data.text);
    const hits = KEY.filter((k) => fields[k]).length;
    const score = data.confidence + hits * 12;
    if (score > best.score) best = { score, hits, rawConfidence: data.confidence, text: data.text, fields, canvas };
    // Früh abbrechen, wenn eindeutig gut erkannt
    if (data.confidence > 45 && hits >= 4) break;
  }

  let fields = best.fields;
  // Scan-Vorlage (Zonen) vorhanden? Dann gezielt diese Bereiche lesen und die
  // Auto-Erkennung damit überschreiben (Zonen sind verlässlicher bei fester Karte).
  const tpl = Zones.get();
  if (tpl && Array.isArray(tpl.items) && tpl.items.length) {
    try {
      await worker.setParameters({ tessedit_pageseg_mode: '7' }); // eine Textzeile je Zone
      const zoneFields = await readZones(best.canvas, tpl.items, async (c) => (await worker.recognize(c)).data.text);
      await worker.setParameters({ tessedit_pageseg_mode: '3' }); // zurück auf Auto
      fields = { ...best.fields, ...zoneFields };
    } catch { /* Zonen-Lesen optional – bei Fehler bleibt die Auto-Erkennung */ }
  }

  if (fields.datum && !fields.datumIso) fields.datumIso = toIsoDate(fields.datum);
  const hits = KEY.filter((k) => fields[k]).length;
  return { fields, hits, confidence: best.rawConfidence, text: best.text };
}

// Worker freigeben (z.B. bei Speicherknappheit) – optional
export async function disposeScanner() {
  if (!workerPromise) return;
  try { const w = await workerPromise; await w.terminate(); } catch {}
  workerPromise = null;
}
