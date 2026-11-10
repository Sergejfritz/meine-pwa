// Aktualisiert lotto/ziehungen.txt – alle Lotto-6aus49-Ziehungen seit 1955.
// Quelle: LottoNumberArchive (Johannes Friedrich); die neuesten Ziehungen, die dort
// noch fehlen, kommen direkt von WestLotto. Aufruf:  node scripts/lotto-daten.mjs
//
// Format pro Zeile:  JJJJ-MM-TT n1 n2 n3 n4 n5 n6 SZ   (SZ = "-" wenn keine)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC = 'https://johannesfriedrich.github.io/LottoNumberArchive/Lottonumbers_complete.json';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'lotto', 'ziehungen.txt');

const res = await fetch(SRC);
if (!res.ok) throw new Error(`Download fehlgeschlagen: HTTP ${res.status}`);
const { data } = await res.json();

const lines = [];
let last = '';
for (const r of data) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(r.date || '');
  const nums = (r.Lottozahl || []).slice().sort((a, b) => a - b);
  const ok = m && nums.length === 6 && new Set(nums).size === 6
    && nums.every((n) => Number.isInteger(n) && n >= 1 && n <= 49);
  if (!ok) throw new Error(`Ungültiger Datensatz: ${JSON.stringify(r)}`);
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  if (iso <= last) throw new Error(`Datum nicht aufsteigend: ${iso}`);
  last = iso;
  const sz = Number.isInteger(r.Superzahl) && r.Superzahl >= 0 && r.Superzahl <= 9 ? r.Superzahl : '-';
  lines.push(`${iso} ${nums.join(' ')} ${sz}`);
}

// Das Archiv hinkt oft ein, zwei Ziehungen hinterher → Rest direkt von WestLotto holen
const LIVE = 'https://www.westlotto.de/wlinfo/WL_InfoService?client=jsn&gruppe=ZahlenUndQuoten&spielart=LOTTO';
async function live(datum) {
  const j = await (await fetch(datum ? `${LIVE}&datum=${datum}` : LIVE)).json();
  const z = j && j.zahlen && j.zahlen.hauptlotterie && (j.zahlen.hauptlotterie.ziehungen || [])[0];
  const d = j && j.head && j.head.datum;
  if (!z || !/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return null;
  const nums = z.zahlenSortiert.map(Number).sort((a, b) => a - b);
  if (nums.length !== 6 || new Set(nums).size !== 6 || !nums.every((n) => Number.isInteger(n) && n >= 1 && n <= 49)) return null;
  const sz = /^\d$/.test(String(z.superzahl)) ? Number(z.superzahl) : '-';
  return { d, line: `${d} ${nums.join(' ')} ${sz}` };
}
try {
  const neueste = await live();
  if (neueste && neueste.d > last) {
    const t = new Date(`${last}T12:00:00Z`);
    for (t.setUTCDate(t.getUTCDate() + 1); t.toISOString().slice(0, 10) < neueste.d; t.setUTCDate(t.getUTCDate() + 1)) {
      if (![3, 6].includes(t.getUTCDay())) continue;
      const z = await live(t.toISOString().slice(0, 10));
      if (z && z.d === t.toISOString().slice(0, 10)) lines.push(z.line);
    }
    lines.push(neueste.line);
    console.log(`+ ${neueste.d > last ? 'bis ' + neueste.d : ''} von WestLotto ergänzt`);
    last = neueste.d;
  }
} catch (e) {
  console.warn(`WestLotto nicht erreichbar (${e.message}) – nur Archiv-Stand.`);
}

fs.writeFileSync(OUT, lines.join('\n') + '\n');
console.log(`${lines.length} Ziehungen gespeichert (${lines[0].slice(0, 10)} … ${last}) → ${path.relative(process.cwd(), OUT)}`);
