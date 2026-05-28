// PDF-Erstellung mit jsPDF – echter Text (scharf/durchsuchbar) + mehrseitiges Foto-Layout
const { jsPDF } = window.jspdf;

const M = 14;            // Seitenrand mm
const PW = 210, PH = 297;
const CW = PW - 2 * M;   // Inhaltsbreite

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

export function buildFilename(doc) {
  const part = (s) => String(s || '').trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 40);
  const date = doc.datum || new Date().toISOString().slice(0, 10);
  return `AB${part(doc.abnr)}_Z${part(doc.zeichnungsnummer)}_I${part(doc.index)}_${date}.pdf`;
}

function header(pdf, doc) {
  // Farbiger Kopfbalken
  pdf.setFillColor(0, 82, 136);
  pdf.rect(0, 0, PW, 26, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.text('Technische Dokumentation', M, 13);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.text('S. Fritz', M, 20);

  // Auftragstyp-Badge rechts
  const typ = doc.auftragstyp || '';
  if (typ) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    const tw = pdf.getTextWidth(typ) + 10;
    pdf.setFillColor(255, 255, 255);
    pdf.roundedRect(PW - M - tw, 8, tw, 10, 2, 2, 'F');
    pdf.setTextColor(0, 82, 136);
    pdf.text(typ, PW - M - tw + 5, 15);
  }
}

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
  if (doc.auftragstyp === 'Reklamation' && doc.version) pairs.push(['Version', doc.version]);
  if (doc.auftragstyp === 'Fertigungsauftrag' && doc.spanndruck) pairs.push(['Spanndruck', doc.spanndruck]);

  const colW = CW / 2;
  const rowH = 9;
  const rows = Math.ceil(pairs.length / 2);
  let y = startY;

  pdf.setDrawColor(216, 224, 234);
  pdf.setLineWidth(0.2);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 2; c++) {
      const idx = r * 2 + c;
      if (idx >= pairs.length) continue;
      const x = M + c * colW;
      const [label, value] = pairs[idx];
      pdf.setFillColor(c % 2 === 0 ? 246 : 246, 249, 252);
      pdf.rect(x, y, colW, rowH, 'F');
      pdf.rect(x, y, colW, rowH); // Rahmen
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7.5);
      pdf.setTextColor(100, 116, 139);
      pdf.text(label.toUpperCase(), x + 2.5, y + 3.4);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.setTextColor(30, 41, 59);
      const val = String(value || '–');
      const fit = pdf.splitTextToSize(val, colW - 5)[0] || val;
      pdf.text(fit, x + 2.5, y + 7.4);
    }
    y += rowH;
  }
  return y;
}

function remarks(pdf, doc, startY) {
  let y = startY + 6;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(0, 82, 136);
  pdf.text('Bemerkungen', M, y);
  y += 5;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(30, 41, 59);
  const lines = pdf.splitTextToSize(String(doc.bemerkung || '–'), CW);
  const maxLines = Math.min(lines.length, 8);
  pdf.text(lines.slice(0, maxLines), M, y);
  y += maxLines * 5;
  pdf.setDrawColor(216, 224, 234);
  pdf.line(M, y + 1, PW - M, y + 1);
  return y + 4;
}

function footer(pdf, page, total) {
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(150, 160, 175);
  pdf.text(`Seite ${page} / ${total}`, PW - M, PH - 6, { align: 'right' });
  pdf.text('Technische Dokumentation · S. Fritz', M, PH - 6);
}

function layoutFor(n) {
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n === 2) return { cols: 1, rows: 2 };
  return { cols: 2, rows: 2 };
}

export async function createPDF(doc) {
  const pdf = new jsPDF('p', 'mm', 'a4');
  const images = doc.images || [];

  // ---- Seite 1: Kopf + Daten + Bemerkungen ----
  header(pdf, doc);
  let y = metaTable(pdf, doc, 32);
  y = remarks(pdf, doc, y);

  // ---- Fotos ----
  const imgs = [];
  for (const im of images) {
    try { imgs.push({ el: await loadImg(im.src), caption: im.caption || '' }); } catch {}
  }
  const hasCaptions = imgs.some((i) => i.caption);

  if (imgs.length) {
    const { cols, rows } = layoutFor(imgs.length);
    const perPage = cols * rows;
    const gap = 5;

    // Fotos beginnen auf einer neuen Seite (saubere, große Darstellung)
    for (let p = 0; p < imgs.length; p += perPage) {
      pdf.addPage();
      header(pdf, doc);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(10);
      pdf.setTextColor(0, 82, 136);
      pdf.text(`Fotodokumentation (${imgs.length} ${imgs.length === 1 ? 'Bild' : 'Bilder'})`, M, 33);

      const areaTop = 37;
      const areaBottom = PH - 12;
      const areaH = areaBottom - areaTop;
      const cellW = (CW - (cols - 1) * gap) / cols;
      const cellH = (areaH - (rows - 1) * gap) / rows;
      const capH = hasCaptions ? 6 : 0;
      const imgMaxH = cellH - capH;

      const pageImgs = imgs.slice(p, p + perPage);
      pageImgs.forEach((item, i) => {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const cx = M + c * (cellW + gap);
        const cy = areaTop + r * (cellH + gap);

        const ratio = item.el.width / item.el.height;
        let w = cellW, h = w / ratio;
        if (h > imgMaxH) { h = imgMaxH; w = h * ratio; }
        const ox = cx + (cellW - w) / 2;
        const oy = cy + (imgMaxH - h) / 2;

        pdf.setFillColor(246, 249, 252);
        pdf.rect(cx, cy, cellW, imgMaxH, 'F');
        pdf.addImage(item.el, 'JPEG', ox, oy, w, h, undefined, 'FAST');

        if (item.caption) {
          pdf.setFont('helvetica', 'italic');
          pdf.setFontSize(8);
          pdf.setTextColor(80, 90, 105);
          const cap = pdf.splitTextToSize(item.caption, cellW)[0] || item.caption;
          pdf.text(cap, cx + cellW / 2, cy + cellH - 1.5, { align: 'center' });
        }
      });
    }
  }

  // ---- Seitennummern ----
  const total = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i);
    footer(pdf, i, total);
  }
  return pdf;
}
