import { Settings, Suggest } from './store.js';
import { createPDF, buildFilename } from './pdf.js';
import { annotate } from './annotate.js';

const $ = (id) => document.getElementById(id);
const MAX_IMAGES = 9;
const SUGGEST_FIELDS = ['kunde', 'maschine', 'verantwortlich', 'teilebenennung'];
const BASE_FIELDS = ['kunde', 'maschine', 'abnr', 'zeichnungsnummer', 'index', 'verantwortlich', 'datum', 'teilebenennung', 'stueckzahl', 'bemerkung'];

let images = []; // [{ id, src, name, caption }]

/* ===================== Init ===================== */
function init() {
  registerSW();
  initTheme();
  initType();
  initPhotos();
  initVoice();
  initActions();
  refreshSuggestions();
  setToday();
  const last = Settings.get().lastVerantwortlich;
  if (last) $('verantwortlich').value = last;
}

function registerSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

/* ===================== Theme ===================== */
function initTheme() {
  const saved = Settings.get().theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(saved);
  $('themeToggle').onclick = () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    Settings.set({ theme: next });
  };
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  $('themeToggle').textContent = t === 'dark' ? '☀️' : '🌙';
  document.querySelector('meta[name=theme-color]').content = t === 'dark' ? '#0b1220' : '#005288';
}

/* ===================== Auftragstyp ===================== */
function initType() {
  document.querySelectorAll('input[name=auftragstyp]').forEach((r) => {
    r.onchange = () => updateTypeFields(r.value);
  });
}
function updateTypeFields(val) {
  $('versionField').classList.toggle('hidden', val !== 'Reklamation');
  $('spanndruckField').classList.toggle('hidden', val !== 'Fertigungsauftrag');
}

/* ===================== Datum ===================== */
function setToday() {
  if (!$('datum').value) $('datum').value = new Date().toISOString().slice(0, 10);
}

/* ===================== Auto-Vervollständigung (nur Tipphilfe) ===================== */
function refreshSuggestions() {
  SUGGEST_FIELDS.forEach((f) => {
    const dl = $('sg_' + f);
    if (!dl) return;
    dl.innerHTML = Suggest.get(f).map((v) => `<option value="${v.replace(/"/g, '&quot;')}">`).join('');
  });
}

/* ===================== Fotos ===================== */
function initPhotos() {
  $('photoAdd').onclick = () => $('photoInput').click();
  $('photoInput').onchange = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    if (images.length + files.length > MAX_IMAGES) { toast(`Maximal ${MAX_IMAGES} Bilder`); return; }
    showLoading('Bilder werden verarbeitet…');
    for (const f of files) {
      try {
        const src = await compress(await readFile(f));
        images.push({ id: 'img_' + Date.now() + Math.random().toString(36).slice(2, 6), src, name: f.name, caption: '' });
      } catch {}
    }
    hideLoading();
    renderPhotos();
  };
}

function readFile(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function compress(dataUrl, maxW = 2200, quality = 0.75) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxW) { h = Math.round(h * (maxW / w)); w = maxW; }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      res(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = rej;
    img.src = dataUrl;
  });
}

function renderPhotos() {
  const grid = $('photoGrid');
  grid.innerHTML = '';
  images.forEach((im, i) => {
    const el = document.createElement('div');
    el.className = 'thumb' + (im.caption ? ' has-caption' : '');
    el.innerHTML = `
      <span class="badge">${i + 1}</span>
      <img src="${im.src}" alt="">
      <div class="tools">
        <button data-act="left" title="Nach vorne">◀</button>
        <button data-act="edit" title="Markieren">✎</button>
        <button data-act="caption" title="Beschriftung">💬</button>
        <button data-act="del" title="Löschen">🗑</button>
      </div>`;
    el.querySelector('[data-act=left]').onclick = () => { if (i > 0) { [images[i - 1], images[i]] = [images[i], images[i - 1]]; renderPhotos(); } };
    el.querySelector('[data-act=edit]').onclick = async () => { const out = await annotate(im.src); if (out) { im.src = out; renderPhotos(); } };
    el.querySelector('[data-act=caption]').onclick = () => { const c = prompt('Bildunterschrift:', im.caption || ''); if (c !== null) { im.caption = c.trim(); renderPhotos(); } };
    el.querySelector('[data-act=del]').onclick = () => { images.splice(i, 1); renderPhotos(); };
    grid.appendChild(el);
  });
}

/* ===================== Spracheingabe ===================== */
function initVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = $('micBtn');
  if (!SR) { btn.style.display = 'none'; return; }
  const rec = new SR();
  rec.lang = 'de-DE'; rec.interimResults = false; rec.continuous = false;
  let active = false;
  const ta = $('bemerkung');
  btn.onclick = () => { if (active) { rec.stop(); return; } try { rec.start(); } catch {} };
  rec.onstart = () => { active = true; btn.classList.add('recording'); };
  rec.onend = () => { active = false; btn.classList.remove('recording'); };
  rec.onerror = () => { active = false; btn.classList.remove('recording'); };
  rec.onresult = (e) => {
    const text = Array.from(e.results).map((r) => r[0].transcript).join(' ').trim();
    ta.value = (ta.value ? ta.value.trim() + ' ' : '') + text;
  };
}

/* ===================== Formular <-> Daten ===================== */
function readForm() {
  const typ = document.querySelector('input[name=auftragstyp]:checked')?.value || '';
  return {
    auftragstyp: typ,
    kunde: $('kunde').value, maschine: $('maschine').value,
    abnr: $('abnr').value, zeichnungsnummer: $('zeichnungsnummer').value,
    index: $('index').value, verantwortlich: $('verantwortlich').value,
    datum: $('datum').value, teilebenennung: $('teilebenennung').value,
    stueckzahl: $('stueckzahl').value, version: $('version').value,
    spanndruck: $('spanndruck').value, bemerkung: $('bemerkung').value,
    images: images.map((i) => ({ src: i.src, name: i.name, caption: i.caption }))
  };
}

function clearForm() {
  document.querySelectorAll('input[name=auftragstyp]').forEach((r) => r.checked = false);
  updateTypeFields('');
  ['kunde', 'maschine', 'abnr', 'zeichnungsnummer', 'index', 'teilebenennung',
    'stueckzahl', 'version', 'spanndruck', 'bemerkung'].forEach((f) => $(f).value = '');
  $('verantwortlich').value = Settings.get().lastVerantwortlich || '';
  images = [];
  renderPhotos();
  setToday();
  clearError();
}

/* ===================== Validierung ===================== */
function validate() {
  clearError();
  const doc = readForm();
  if (!doc.auftragstyp) return fail('Bitte Auftragstyp wählen.');
  for (const f of BASE_FIELDS) {
    if (!String(doc[f] || '').trim()) return fail('Bitte alle Pflichtfelder (*) ausfüllen.');
  }
  if (doc.auftragstyp === 'Reklamation' && !doc.version.trim()) return fail('Bitte Version ausfüllen.');
  if (doc.auftragstyp === 'Fertigungsauftrag' && !doc.spanndruck.trim()) return fail('Bitte Spanndruck ausfüllen.');
  if (!(Number(doc.stueckzahl) > 0)) return fail('Stückzahl muss größer als 0 sein.');
  if (!images.length) return fail('Bitte mindestens ein Foto hinzufügen.');
  return doc;
}
function fail(msg) { showError(msg); return null; }
function showError(msg) { const b = $('errorBox'); b.textContent = '⚠️ ' + msg; b.classList.remove('hidden'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function clearError() { $('errorBox').classList.add('hidden'); }

/* ===================== Aktionen ===================== */
function initActions() {
  $('btnPdf').onclick = withDoc(async (doc) => {
    showLoading('PDF wird erstellt…');
    try {
      const pdf = await createPDF(doc);
      pdf.save(buildFilename(doc));
      remember(doc);
      toast('PDF erstellt ✓');
    } finally { hideLoading(); }
  });

  $('btnShare').onclick = withDoc(async (doc) => {
    showLoading('PDF wird vorbereitet…');
    try {
      const pdf = await createPDF(doc);
      const file = new File([pdf.output('blob')], buildFilename(doc), { type: 'application/pdf' });
      hideLoading();
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ title: 'Technische Dokumentation S. Fritz', text: 'Technische Dokumentation (PDF)', files: [file] });
        remember(doc);
      } else {
        toast('Teilen hier nicht unterstützt – PDF wird gespeichert');
        pdf.save(buildFilename(doc));
        remember(doc);
      }
    } catch (e) {
      hideLoading();
      if (e?.name !== 'AbortError') toast('Teilen fehlgeschlagen');
    }
  });

  $('btnNew').onclick = () => {
    if (images.length || $('kunde').value) {
      if (!confirm('Formular leeren? Nicht geteilte Eingaben gehen verloren.')) return;
    }
    clearForm();
    toast('Neues Formular');
  };
}

// Validiert zuerst, führt dann die Aktion mit dem Doc aus
function withDoc(fn) {
  return async () => { const doc = validate(); if (doc) await fn(doc); };
}

// Merkt sich nur Eingabe-Vorschläge (Tipphilfe) – es wird KEIN Archiv gespeichert
function remember(doc) {
  SUGGEST_FIELDS.forEach((f) => Suggest.remember(f, doc[f]));
  if (doc.verantwortlich) Settings.set({ lastVerantwortlich: doc.verantwortlich.trim() });
  refreshSuggestions();
}

/* ===================== UI-Helfer ===================== */
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
function showLoading(text) { $('loadingText').textContent = text || 'Bitte warten…'; $('loading').classList.add('show'); }
function hideLoading() { $('loading').classList.remove('show'); }

init();
