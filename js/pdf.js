// PDF-Erstellung mit jsPDF – echter, scharfer Text + professionelles, mehrseitiges Layout.
// Erzeugt von der Web-App; keine externen Abhängigkeiten außer jsPDF.
const { jsPDF } = window.jspdf;

const M = 14;            // Seitenrand (mm)
const PW = 210, PH = 297;
const CW = PW - 2 * M;   // Inhaltsbreite
const BAND = 28;         // Höhe Kopfbalken
const C_ACCENT = [0, 82, 136];
const C_ACCENT2 = [10, 108, 176];
const C_TEXT = [30, 41, 59];
const C_MUTED = [100, 116, 139];
const C_LINE = [216, 224, 234];
const C_SHADE = [246, 249, 252];

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return d ? `${d}.${m}.${y}` : iso;
}

function nowStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function docRef(doc) {
  const c = (s) => String(s || '–');
  return `AB ${c(doc.abnr)} · Z ${c(doc.zeichnungsnummer)} · Index ${c(doc.index)}`;
}

export function buildFilename(doc) {
  const part = (s) => String(s || '').trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 40);
  const date = doc.datum || new Date().toISOString().slice(0, 10);
  return `AB${part(doc.abnr)}_Z${part(doc.zeichnungsnummer)}_I${part(doc.index)}_${date}.pdf`;
}

/* ---------------- Kopf & Fuß ---------------- */
function header(pdf, doc) {
  pdf.setFillColor(...C_ACCENT);
  pdf.rect(0, 0, PW, BAND, 'F');
  pdf.setFillColor(...C_ACCENT2);
  pdf.rect(0, BAND, PW, 1, 'F'); // Akzentlinie

  // Logo (weißes Quadrat mit Monogramm)
  pdf.setFillColor(255, 255, 255);
  pdf.roundedRect(M, 6, 16, 16, 3, 3, 'F');
  pdf.setTextColor(...C_ACCENT);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  pdf.text('SF', M + 8, 16.5, { align: 'center' });

  // Titel
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.text('Technische Dokumentation', M + 21, 14);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.text('S. Fritz · Qualitätssicherung', M + 21, 20);

  // Auftragstyp-Badge + Referenz rechts
  const typ = doc.auftragstyp || '';
  if (typ) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    const tw = pdf.getTextWidth(typ) + 9;
    pdf.setFillColor(255, 255, 255);
    pdf.roundedRect(PW - M - tw, 6.5, tw, 8.5, 2, 2, 'F');
    pdf.setTextColor(...C_ACCENT);
    pdf.text(typ, PW - M - tw / 2, 12.3, { align: 'center' });
  }
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(226, 236, 246);
  pdf.text(docRef(doc), PW - M, 20.5, { align: 'right' });
}

function footer(pdf, page, total, created) {
  pdf.setDrawColor(...C_LINE);
  pdf.setLineWidth(0.2);
  pdf.line(M, PH - 11, PW - M, PH - 11);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(...C_MUTED);
  pdf.text('S. Fritz · Technische Dokumentation', M, PH - 6.5);
  pdf.text(`Erstellt am ${created}`, PW / 2, PH - 6.5, { align: 'center' });
  pdf.text(`Seite ${page} / ${total}`, PW - M, PH - 6.5, { align: 'right' });
}

function sectionTitle(pdf, text, y) {
  pdf.setFillColor(...C_ACCENT);
  pdf.rect(M, y - 3.4, 2.2, 4, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10.5);
  pdf.setTextColor(...C_ACCENT);
  pdf.text(text, M + 4.5, y);
  return y + 4;
}

/* ---------------- Datentabelle ---------------- */
function metaTable(pdf, doc, startY) {
  const pairs = [
    ['Kunde', doc.kunde],
    ['Maschine', doc.maschine],
    ['AB-Nr.', doc.abnr],
    ['Zeichnungsnr.', doc.zeichnungsnummer],
    ['Index', doc.index],
    ['Verantwortlich', doc.verantwortlich],
    ['Datum', fmtDate(doc.datum)],
    ['Benennung der Teile', doc.teilebenennung],
    ['Stückzahl', doc.stueckzahl],
  ];
  if (doc.position) pairs.splice(3, 0, ['Position', doc.position]);
  if (doc.auftragstyp === 'Reklamation' && doc.version) pairs.push(['Version', doc.version]);
  if (doc.auftragstyp === 'Fertigungsauftrag' && doc.spanndruck) pairs.push(['Spanndruck', doc.spanndruck]);

  const colW = CW / 2;
  const innerW = colW - 5;
  const rowsN = Math.ceil(pairs.length / 2);
  let y = startY;

  pdf.setDrawColor(...C_LINE);
  pdf.setLineWidth(0.2);

  for (let r = 0; r < rowsN; r++) {
    // Zeilenhöhe aus dem höheren der beiden Werte (max. 2 Zeilen)
    const cells = [];
    let lineCount = 1;
    for (let c = 0; c < 2; c++) {
      const idx = r * 2 + c;
      if (idx >= pairs.length) { cells.push(null); continue; }
      const [label, value] = pairs[idx];
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5);
      const vLines = pdf.splitTextToSize(String(value || '–'), innerW).slice(0, 2);
      lineCount = Math.max(lineCount, vLines.length);
      cells.push({ label, vLines });
    }
    const rowH = 6.4 + lineCount * 4;

    for (let c = 0; c < 2; c++) {
      const cell = cells[c];
      const x = M + c * colW;
      pdf.setFillColor(...(r % 2 === 0 ? [255, 255, 255] : C_SHADE));
      pdf.rect(x, y, colW, rowH, 'F');
      pdf.rect(x, y, colW, rowH); // Rahmen
      if (!cell) continue;
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.2);
      pdf.setTextColor(...C_MUTED);
      pdf.text(cell.label.toUpperCase(), x + 2.6, y + 3.6);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5);
      pdf.setTextColor(...C_TEXT);
      cell.vLines.forEach((ln, i) => pdf.text(ln, x + 2.6, y + 7.6 + i * 4));
    }
    y += rowH;
  }
  return y;
}

/* ---------------- Bemerkungen (mit Umbruch über Seiten) ---------------- */
function remarksBlock(pdf, doc, startY, created) {
  let y = sectionTitle(pdf, 'Bemerkungen', startY + 7);
  y += 2;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10);
  pdf.setTextColor(...C_TEXT);
  const lines = pdf.splitTextToSize(String(doc.bemerkung || '–'), CW);
  const lineH = 5;
  const bottom = PH - 16;
  for (const ln of lines) {
    if (y > bottom) {
      pdf.addPage(); header(pdf, doc);
      y = sectionTitle(pdf, 'Bemerkungen (Fortsetzung)', BAND + 9) + 2;
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(...C_TEXT);
    }
    pdf.text(ln, M, y);
    y += lineH;
  }
  pdf.setDrawColor(...C_LINE); pdf.setLineWidth(0.2);
  pdf.line(M, y + 1, PW - M, y + 1);
  return y + 4;
}

/* ---------------- Foto-Seiten ---------------- */
function layoutFor(n) {
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n === 2) return { cols: 1, rows: 2 };
  return { cols: 2, rows: 2 };
}

function photoPages(pdf, doc, imgs) {
  const { cols, rows } = layoutFor(imgs.length);
  const perPage = cols * rows;
  const gap = 5;
  const hasCaptions = imgs.some((i) => i.caption);

  for (let p = 0; p < imgs.length; p += perPage) {
    pdf.addPage();
    header(pdf, doc);
    sectionTitle(pdf, `Fotodokumentation (${imgs.length} ${imgs.length === 1 ? 'Bild' : 'Bilder'})`, BAND + 9);

    const areaTop = BAND + 13;
    const areaBottom = PH - 13;
    const areaH = areaBottom - areaTop;
    const cellW = (CW - (cols - 1) * gap) / cols;
    const cellH = (areaH - (rows - 1) * gap) / rows;
    const capH = hasCaptions ? 6 : 0;
    const imgMaxH = cellH - capH;

    imgs.slice(p, p + perPage).forEach((item, i) => {
      const num = p + i + 1;
      const c = i % cols, r = Math.floor(i / cols);
      const cx = M + c * (cellW + gap);
      const cy = areaTop + r * (cellH + gap);

      // Bild einpassen (Seitenverhältnis erhalten), in der Zelle zentriert
      const ratio = item.el.width / item.el.height;
      let w = cellW, h = w / ratio;
      if (h > imgMaxH) { h = imgMaxH; w = h * ratio; }
      const ox = cx + (cellW - w) / 2;
      const oy = cy + (imgMaxH - h) / 2;

      // dezenter Rahmen eng am Bild + Bild
      pdf.setFillColor(...C_SHADE);
      pdf.setDrawColor(...C_LINE); pdf.setLineWidth(0.3);
      pdf.rect(ox - 0.8, oy - 0.8, w + 1.6, h + 1.6, 'FD');
      pdf.addImage(item.el, 'JPEG', ox, oy, w, h, undefined, 'FAST');

      // Nummern-Badge oben links am Bild
      pdf.setFillColor(...C_ACCENT);
      pdf.roundedRect(ox + 1, oy + 1, 13.5, 5.4, 1.2, 1.2, 'F');
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5);
      pdf.setTextColor(255, 255, 255);
      pdf.text(`Bild ${num}`, ox + 7.75, oy + 4.8, { align: 'center' });

      if (item.caption) {
        pdf.setFont('helvetica', 'italic'); pdf.setFontSize(8);
        pdf.setTextColor(80, 90, 105);
        const cap = pdf.splitTextToSize(item.caption, cellW)[0] || item.caption;
        pdf.text(cap, cx + cellW / 2, oy + h + 4.5, { align: 'center' });
      }
    });
  }
}

/* ---------------- Hauptfunktion ---------------- */
export async function createPDF(doc) {
  const pdf = new jsPDF('p', 'mm', 'a4');
  const created = nowStr();

  header(pdf, doc);
  let y = sectionTitle(pdf, 'Auftragsdaten', BAND + 9);
  y = metaTable(pdf, doc, y + 1);
  remarksBlock(pdf, doc, y, created);

  // Bilder laden (defekte überspringen)
  const imgs = [];
  for (const im of (doc.images || [])) {
    try { imgs.push({ el: await loadImg(im.src), caption: im.caption || '' }); } catch {}
  }
  if (imgs.length) photoPages(pdf, doc, imgs);

  // Fußzeilen
  const total = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i);
    footer(pdf, i, total, created);
  }
  return pdf;
}
