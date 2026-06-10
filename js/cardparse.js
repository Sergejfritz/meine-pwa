// Arbeitskarten-Parser: extrahiert die Kopfdaten der Karte aus dem OCR-Text.
// Wichtig: Es wird NUR der Kopfbereich ausgewertet (bis zur Zeile
// "Arbeitsplan, Dokumentation, Selbstprüfung"). Der darunterliegende
// Arbeitsplan (Barcodes AKAB…, Notizen) wird ignoriert – sonst entstehen
// Fehltreffer. Treffer sind Vorschläge; der Nutzer prüft und bestätigt.

function clean(s) { return (s || '').replace(/[ \t]+/g, ' ').trim(); }

function firstMatch(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) return clean(m[1]);
  }
  return '';
}

// Schneidet den Text auf den Kopfbereich zu: von "Arbeitskarte" (falls
// vorhanden) bis unmittelbar vor der Arbeitsplan-Trennlinie.
function headerSection(rawText) {
  const all = (rawText || '').split('\n');
  let start = 0, end = all.length;
  for (let i = 0; i < all.length; i++) {
    const l = all[i];
    if (start === 0 && /Arbeitskarte/i.test(l)) start = i;
    // Trennlinie zum Arbeitsplan – ab hier abschneiden
    if (/Arbeitsplan|Dokumentation|Selbstpr|AG[-\s]?Nr/i.test(l)) { end = i; break; }
  }
  return all.slice(start, end).join('\n');
}

export function parseArbeitskarte(rawText) {
  const header = headerSection(rawText);
  const lines = header.split('\n').map(clean).filter(Boolean);
  const res = {};

  // --- AB-Nr. (Auftrags-Nr.) z.B. AB260327 – mit "AB"-Präfix wie auf der Karte ---
  res.abnr = firstMatch(header, [
    /Auftrags[-\s]?Nr\.?\s*[:.)]?\s*(AB\s?\d{5,9})/i,
    /\b(AB\s?\d{5,9})\b/i,
  ]).replace(/\s+/g, '');

  // --- Position (nur die Nummer, z.B. "2" aus "Pos. 2 von 2" / "Nr. 2") ---
  // "von" wird oft ohne Leerzeichen erkannt ("2von2"); daher tolerant matchen.
  res.position = firstMatch(header, [
    /Pos[.\s]*(\d{1,3})\s*von/i,
    /Pos[.\s]*(\d{1,3})/i,
  ]);
  if (!res.position) {
    // Zeile, die mit "Nr." beginnt (nicht "Auftrags-Nr.")
    const nrLine = lines.find((l) => /^Nr\.?\s*\d/i.test(l));
    const m = nrLine && nrLine.match(/^Nr\.?\s*(\d{1,3})/i);
    if (m) res.position = m[1];
  }

  // --- Zeichnungs-Nr. (lange Ziffernfolge, 6–10 Stellen) – nur aus dem Kopf ---
  res.zeichnungsnummer = firstMatch(header, [
    /Zeichnungs[-\s]?Nr\.?\s*[:.]?\s*(\d{6,10})/i,
  ]);
  if (!res.zeichnungsnummer) {
    const longNums = (header.match(/\b\d{6,10}\b/g) || [])
      .filter((n) => n !== res.abnr.replace(/^AB/i, '') && !/^AB/i.test(n));
    longNums.sort((a, b) => b.length - a.length);
    res.zeichnungsnummer = longNums.find((n) => n.length === 9) || longNums[0] || '';
  }

  // --- Kunde ---
  // Bei Treffer auf eine Rechtsform endet der Name dort (Rest ist OCR-Rauschen
  // vom Kartenrand, z.B. "… Ravensburg Kr"). Ort nach Bindestrich bleibt erhalten.
  res.kunde = firstMatch(header, [
    /Kunde\s*[:.]?\s*([A-ZÄÖÜ][^\n]*?(?:GmbH(?:\s*&\s*Co\.?\s*KG)?|AG|KG|SE|e\.?K\.?)(?:\s*[-–]\s*[A-ZÄÖÜ][a-zäöüß]+)?)/i,
    /Kunde\s*[:.]?\s*([^\n]{3,60})/i,
  ]);

  // --- Benennung der Teile: Text zwischen Position und Zeichnungs-Nr. ---
  if (res.zeichnungsnummer) {
    const line = lines.find((l) => l.includes(res.zeichnungsnummer));
    if (line) {
      let seg = line.split(res.zeichnungsnummer)[0];
      // führendes "Nr. N" / "Pos. …" / "Standard" entfernen
      seg = seg.replace(/^.*?\bNr\.?\s*\d+\s*/i, '')
               .replace(/\bPos\.?\s*\d+(\s*von\s*\d+)?\s*/i, '')
               .replace(/\bStandard\b/i, '');
      seg = clean(seg).replace(/[|:;/].*$/, '').trim();
      if (seg.length >= 3 && /[A-Za-zÄÖÜäöü]/.test(seg)) res.teilebenennung = seg;
    }
  }
  if (!res.teilebenennung) {
    res.teilebenennung = firstMatch(header, [/Benennung\s*[:.]?\s*([A-ZÄÖÜ][^\n0-9|]{2,40})/i]);
  }

  // --- Index & Stückzahl aus der Wertezeile (zwischen Zeichnungs-Nr. und Datum) ---
  // Reihenfolge auf der Karte: Zeichnungs-Nr. | Index | Stk | Liefertermin
  if (res.zeichnungsnummer) {
    const line = lines.find((l) => l.includes(res.zeichnungsnummer));
    if (line) {
      let tail = line.split(res.zeichnungsnummer)[1] || '';
      tail = tail.split(/\d{2}\.\d{2}\.\d{4}/)[0]; // alles vor dem Datum
      const tokens = (tail.match(/[0-9A-D]+/gi) || []).filter((t) => t.length <= 4);
      for (const t of tokens) {
        if (/^[0-9A-D]$/i.test(t) && !res.index) res.index = t.toUpperCase();      // 1 Zeichen → Index
        else if (/^\d{2,4}$/.test(t) && !res.stueckzahl) res.stueckzahl = t;        // mehrstellig → Stückzahl
      }
    }
  }
  // Index explizit per Label (Fallback)
  if (!res.index) res.index = firstMatch(header, [/\bIndex\b\s*[:.]?\s*([0-9A-D])\b/i]);
  // Stückzahl: sehr spezifisches Muster "N Stück" darf aus dem GANZEN Text kommen
  // (z.B. "48 Stück sägen") – praktisch nie ein Fehltreffer.
  if (!res.stueckzahl) {
    res.stueckzahl = firstMatch(rawText || '', [
      /(\d{1,5})\s*St(?:ü|u|ue)ck\b/i,
      /St(?:k|ück)\b[^\n]*?\b(\d{1,4})\b/i,
    ]);
  }

  // --- Datum (Liefertermin) TT.MM.JJJJ ---
  res.datum = firstMatch(header, [
    /Liefertermin[^\n]*?(\d{2}\.\d{2}\.\d{4})/i,
    /(\d{2}\.\d{2}\.\d{4})\s*\(KW/i,
    /(\d{2}\.\d{2}\.\d{4})/,
  ]);

  return res;
}

// ISO-Datum aus TT.MM.JJJJ (für <input type=date>)
export function toIsoDate(d) {
  const m = (d || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
