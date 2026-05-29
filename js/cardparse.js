// Arbeitskarten-Parser: extrahiert Felder aus (verrauschtem) OCR-Text.
// Bewusst tolerant – Treffer werden als Vorschlag ins Formular gesetzt, der
// Nutzer kontrolliert und korrigiert. Reines Parsing, kein DOM/Netz.

function clean(s) { return (s || '').replace(/[ \t]+/g, ' ').trim(); }

// Findet die erste Capture-Gruppe des ersten passenden Musters
function firstMatch(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) return clean(m[1]);
  }
  return '';
}

export function parseArbeitskarte(rawText) {
  const text = rawText || '';
  const lines = text.split('\n').map(clean).filter(Boolean);
  const res = {};

  // --- AB-Nr. (Auftrags-Nr.) z.B. AB260327 – mit "AB"-Präfix wie auf der Karte ---
  res.abnr = firstMatch(text, [
    /Auftrags[-\s]?Nr\.?\s*:?\s*(AB\s?\d{5,9})/i,
    /\b(AB\s?\d{5,9})\b/i,
  ]).replace(/\s+/g, '');

  // --- Zeichnungs-Nr. (lange Ziffernfolge, 6–10 Stellen) ---
  // Bevorzugt direkt nach "Zeichnungs-Nr"; sonst die markanteste lange Zahl,
  // die nicht die AB-Nr ist.
  res.zeichnungsnummer = firstMatch(text, [
    /Zeichnungs[-\s]?Nr\.?\s*:?\s*(\d{6,10})/i,
  ]);
  if (!res.zeichnungsnummer) {
    const longNums = (text.match(/\b\d{6,10}\b/g) || [])
      .filter((n) => n !== res.abnr && !/^AB/.test(n));
    // 9-stellige zuerst (typisch Andritz), sonst die längste
    longNums.sort((a, b) => b.length - a.length);
    const nine = longNums.find((n) => n.length === 9);
    res.zeichnungsnummer = nine || longNums[0] || '';
  }

  // --- Kunde ---
  res.kunde = firstMatch(text, [
    /Kunde\s*:?\s*([A-ZÄÖÜ][^\n]*?(?:GmbH|AG|KG|GmbH & Co\.? KG|SE)[^\n]*)/i,
    /Kunde\s*:?\s*([^\n]{3,60})/i,
  ]);

  // --- Benennung der Teile ---
  // Strategie 1: Zeile, die die Zeichnungsnr. enthält → Text davor (nach evtl. "Nr. N")
  if (res.zeichnungsnummer) {
    const line = lines.find((l) => l.includes(res.zeichnungsnummer));
    if (line) {
      let seg = line.split(res.zeichnungsnummer)[0];
      seg = seg.replace(/^.*?\bNr\.?\s*\d+\s*/i, '').replace(/\bStandard\b/i, '');
      seg = clean(seg).replace(/[|:;].*$/, '').trim();
      // nur sinnvolle Wortfolgen übernehmen
      if (seg.length >= 3 && /[A-Za-zÄÖÜäöü]/.test(seg)) res.teilebenennung = seg;
    }
  }
  // Strategie 2: explizit nach "Benennung"
  if (!res.teilebenennung) {
    res.teilebenennung = firstMatch(text, [/Benennung\s*:?\s*([A-ZÄÖÜ][^\n0-9]{2,40})/i]);
  }

  // --- Stückzahl ---
  res.stueckzahl = firstMatch(text, [
    /(\d{1,5})\s*St(?:ü|u|ue)ck\s+s/i,         // "48 Stück sägen"
    /St(?:k|ück)\b[^\n]*?\b(\d{1,5})\b/i,
  ]);
  // Fallback: Zahl in der Zeichnungsnr.-Zeile direkt nach der Nummer
  if (!res.stueckzahl && res.zeichnungsnummer) {
    const line = lines.find((l) => l.includes(res.zeichnungsnummer));
    const m = line && line.split(res.zeichnungsnummer)[1]?.match(/\b(\d{1,4})\b/);
    if (m) res.stueckzahl = m[1];
  }

  // --- Datum (Liefertermin) TT.MM.JJJJ ---
  res.datum = firstMatch(text, [
    /Liefertermin[^\n]*?(\d{2}\.\d{2}\.\d{4})/i,
    /(\d{2}\.\d{2}\.\d{4})\s*\(KW/i,
    /(\d{2}\.\d{2}\.\d{4})/,
  ]);

  // --- Index (oft "Index 0/1/..") ---
  res.index = firstMatch(text, [/\bIndex\b\s*:?\s*([0-9A-D])\b/i]);

  return res;
}

// ISO-Datum aus TT.MM.JJJJ (für <input type=date>)
export function toIsoDate(d) {
  const m = (d || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
