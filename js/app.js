import { Settings, Suggest, Draft } from './store.js';
import { createPDF, buildFilename } from './pdf.js';
import { annotate } from './annotate.js';

const $ = (id) => document.getElementById(id);
const MAX_IMAGES = 9;
const SUGGEST_FIELDS = ['kunde', 'maschine', 'verantwortlich', 'teilebenennung'];
// Pflichttextfelder (datum hat Default); stueckzahl & auftragstyp werden gesondert geprüft
const REQUIRED = ['kunde', 'maschine', 'abnr', 'zeichnungsnummer', 'index', 'verantwortlich', 'datum', 'teilebenennung', 'bemerkung'];
const DRAFT_FIELDS = ['auftragstyp', 'kunde', 'maschine', 'abnr', 'zeichnungsnummer', 'index', 'verantwortlich', 'datum', 'teilebenennung', 'stueckzahl', 'version', 'spanndruck', 'bemerkung'];

let images = []; // [{ id, src, name, caption }]

/* ===================== Init ===================== */
function init() {
  registerSW();
  initTheme();
  initType();
  initPhotos();
  initVoice();
  initActions();
  initLightbox();
  initLiveValidation();
  initDraftAutosave();
  refreshSuggestions();
  setToday();
  const last = Settings.get().lastVerantwortlich;
  if (last) $('verantwortlich').value = last;
  restoreDraft();
}

/* ===================== Service Worker (+ Update-Hinweis) ===================== */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  let notified = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !notified) { notified = true; actionToast('Neue Version verfügbar – tippen zum Aktualisieren', () => location.reload()); }
  });
}

/* ===================== Theme ===================== */
function initTheme() {
  const saved = Settings.get().theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(saved);
  $('themeToggle').onclick = () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next); Settings.set({ theme: next });
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
    r.onchange = () => { updateTypeFields(r.value); clearTypeError(); };
  });
}
function updateTypeFields(val) {
  $('versionField').classList.toggle('hidden', val !== 'Reklamation');
  $('spanndruckField').classList.toggle('hidden', val !== 'Fertigungsauftrag');
}
function currentType() { return document.querySelector('input[name=auftragstyp]:checked')?.value || ''; }

/* ===================== Datum ===================== */
function setToday() { if (!$('datum').value) $('datum').value = new Date().toISOString().slice(0, 10); }

/* ===================== Auto-Vervollständigung ===================== */
function refreshSuggestions() {
  SUGGEST_FIELDS.forEach((f) => {
    const dl = $('sg_' + f); if (!dl) return;
    dl.innerHTML = Suggest.get(f).map((v) => `<option value="${v.replace(/"/g, '&quot;')}">`).join('');
  });
}

/* ===================== Fotos ===================== */
function initPhotos() {
  ['galleryInput', 'cameraInput'].forEach((id) => {
    const inp = $(id);
    if (!inp) return;
    inp.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = ''; // erlaubt erneutes Wählen derselben Datei
      await addFiles(files);
    });
  });
}

async function addFiles(files) {
  if (!files.length) return;
  const room = MAX_IMAGES - images.length;
  if (room <= 0) { toast(`Maximal ${MAX_IMAGES} Bilder`); return; }
  const take = files.slice(0, room);
  if (files.length > room) toast(`Nur ${room} weitere Bilder möglich`);
  showLoading('Bilder werden verarbeitet…');
  for (const f of take) {
    try {
      const src = await compress(await readFile(f));
      images.push({ id: 'img_' + Date.now() + Math.random().toString(36).slice(2, 6), src, name: f.name, caption: '' });
    } catch {}
  }
  hideLoading();
  renderPhotos();
}

function readFile(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = rej;
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
    img.onerror = rej; img.src = dataUrl;
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
      <img src="${im.src}" alt="Foto ${i + 1}${im.caption ? ': ' + esc(im.caption) : ''}">
      <div class="tools">
        <button data-act="left" title="Nach vorne" aria-label="Nach vorne"${i === 0 ? ' disabled' : ''}>◀</button>
        <button data-act="edit" title="Markieren" aria-label="Markieren">✎</button>
        <button data-act="caption" title="Beschriftung" aria-label="Beschriftung">💬</button>
        <button data-act="right" title="Nach hinten" aria-label="Nach hinten"${i === images.length - 1 ? ' disabled' : ''}>▶</button>
        <button data-act="del" title="Löschen" aria-label="Löschen">🗑</button>
      </div>`;
    el.querySelector('img').onclick = () => openLightbox(im.src);
    el.querySelector('[data-act=left]').onclick = () => move(i, -1);
    el.querySelector('[data-act=right]').onclick = () => move(i, 1);
    el.querySelector('[data-act=edit]').onclick = async () => { const out = await annotate(im.src); if (out) { im.src = out; renderPhotos(); } };
    el.querySelector('[data-act=caption]').onclick = () => { const c = prompt('Bildunterschrift:', im.caption || ''); if (c !== null) { im.caption = c.trim(); renderPhotos(); } };
    el.querySelector('[data-act=del]').onclick = () => { images.splice(i, 1); renderPhotos(); };
    grid.appendChild(el);
  });
  $('photoCount').textContent = `${images.length} / ${MAX_IMAGES}`;
  if (images.length) $('photoMsg').style.display = 'none';
}
function move(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= images.length) return;
  [images[i], images[j]] = [images[j], images[i]];
  renderPhotos();
}

/* ===================== Vollbild-Vorschau ===================== */
function initLightbox() {
  const close = () => $('lightbox').classList.remove('open');
  $('lightboxClose').onclick = close;
  $('lightbox').onclick = (e) => { if (e.target.id === 'lightbox') close(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}
function openLightbox(src) { $('lightboxImg').src = src; $('lightbox').classList.add('open'); }

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
    saveDraft();
  };
}

/* ===================== Formular <-> Daten ===================== */
function readForm() {
  const doc = { auftragstyp: currentType(), images: images.map((i) => ({ src: i.src, name: i.name, caption: i.caption })) };
  ['kunde', 'maschine', 'abnr', 'zeichnungsnummer', 'index', 'verantwortlich', 'datum',
    'teilebenennung', 'stueckzahl', 'version', 'spanndruck', 'bemerkung'].forEach((f) => doc[f] = $(f).value);
  return doc;
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
  clearAllErrors();
}

/* ===================== Inline-Validierung ===================== */
function wrap(id) { return $(id).closest('.field'); }
function setErr(id, on, msg) {
  const f = wrap(id); if (!f) return;
  $(id).classList.toggle('invalid', on);
  f.classList.toggle('has-error', on);
  if (on && msg) { const m = f.querySelector('.field-msg'); if (m) m.textContent = msg; }
}
function setTypeError(on) {
  const f = document.querySelector('[data-for=auftragstyp]');
  f.querySelector('.seg').classList.toggle('invalid', on);
  f.classList.toggle('has-error', on);
}
function clearTypeError() { setTypeError(false); }
function clearAllErrors() {
  document.querySelectorAll('.field.has-error').forEach((f) => f.classList.remove('has-error'));
  document.querySelectorAll('.invalid').forEach((e) => e.classList.remove('invalid'));
  $('errorBox').classList.add('hidden');
  $('photoMsg').style.display = 'none';
}
function initLiveValidation() {
  // Fehler verschwindet, sobald der Nutzer das Feld korrigiert
  ['kunde', 'maschine', 'abnr', 'zeichnungsnummer', 'index', 'verantwortlich', 'datum',
    'teilebenennung', 'stueckzahl', 'version', 'spanndruck', 'bemerkung'].forEach((id) => {
    $(id).addEventListener('input', () => { if ($(id).value.trim()) setErr(id, false); });
  });
}

function validate() {
  clearAllErrors();
  const doc = readForm();
  let firstBad = null;
  const flag = (el) => { if (!firstBad) firstBad = el; };

  if (!doc.auftragstyp) { setTypeError(true); flag(document.querySelector('[data-for=auftragstyp]')); }
  for (const f of REQUIRED) {
    if (!String(doc[f] || '').trim()) { setErr(f, true); flag($(f)); }
  }
  if (!(Number(doc.stueckzahl) > 0)) { setErr('stueckzahl', true, 'Muss größer als 0 sein.'); flag($('stueckzahl')); }
  if (doc.auftragstyp === 'Reklamation' && !doc.version.trim()) { setErr('version', true); flag($('version')); }
  if (doc.auftragstyp === 'Fertigungsauftrag' && !doc.spanndruck.trim()) { setErr('spanndruck', true); flag($('spanndruck')); }
  if (!images.length) { $('photoMsg').style.display = 'block'; flag($('photoArea')); }

  if (firstBad) {
    $('errorBox').textContent = '⚠️ Bitte die rot markierten Felder ausfüllen.';
    $('errorBox').classList.remove('hidden');
    firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (firstBad.focus) try { firstBad.focus({ preventScroll: true }); } catch {}
    return null;
  }
  return doc;
}

/* ===================== Aktionen ===================== */
function initActions() {
  $('btnPdf').onclick = withDoc('btnPdf', async (doc) => {
    showLoading('PDF wird erstellt…');
    try {
      const pdf = await createPDF(doc);
      pdf.save(buildFilename(doc));
      finalize(doc);
      toast('PDF erstellt ✓');
    } finally { hideLoading(); }
  });

  $('btnShare').onclick = withDoc('btnShare', async (doc) => {
    showLoading('PDF wird vorbereitet…');
    let pdf;
    try { pdf = await createPDF(doc); } catch (e) { hideLoading(); toast('Fehler bei der PDF-Erstellung'); throw e; }
    const file = new File([pdf.output('blob')], buildFilename(doc), { type: 'application/pdf' });
    hideLoading();
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ title: 'Technische Dokumentation S. Fritz', text: 'Technische Dokumentation (PDF)', files: [file] });
        finalize(doc);
      } else {
        pdf.save(buildFilename(doc));
        finalize(doc);
        toast('Teilen nicht unterstützt – PDF gespeichert');
      }
    } catch (e) { if (e?.name !== 'AbortError') toast('Teilen abgebrochen'); }
  });

  $('btnNew').onclick = () => {
    if (images.length || $('kunde').value.trim()) {
      if (!confirm('Formular leeren? Nicht geteilte Eingaben gehen verloren.')) return;
    }
    Draft.clear();
    hideDraftBanner();
    clearForm();
    toast('Neues Formular');
  };
}

// Validiert, sperrt den Button mit Spinner und führt die Aktion aus
function withDoc(btnId, fn) {
  return async () => {
    const doc = validate();
    if (!doc) return;
    const btn = $(btnId);
    const label = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<span class="btn-spin"></span> Bitte warten…';
    try { await fn(doc); }
    catch (e) { console.error(e); }
    finally { btn.disabled = false; btn.innerHTML = label; }
  };
}

// Nach erfolgreichem Erstellen/Teilen: Vorschläge merken, Entwurf löschen
function finalize(doc) {
  SUGGEST_FIELDS.forEach((f) => Suggest.remember(f, doc[f]));
  if (doc.verantwortlich) Settings.set({ lastVerantwortlich: doc.verantwortlich.trim() });
  refreshSuggestions();
  Draft.clear();
  hideDraftBanner();
}

/* ===================== Entwurf-Sicherung ===================== */
let draftTimer;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    const fields = {}; DRAFT_FIELDS.forEach((f) => fields[f] = f === 'auftragstyp' ? currentType() : $(f).value);
    Draft.save(fields);
  }, 600);
}
function initDraftAutosave() {
  const sec = $('formView');
  sec.addEventListener('input', saveDraft);
  sec.addEventListener('change', saveDraft);
}
function restoreDraft() {
  // App-Shortcut "Neue Dokumentation" startet bewusst leer
  if (new URLSearchParams(location.search).get('new')) { Draft.clear(); return; }
  const d = Draft.load();
  if (!d || !d.fields) return;
  // Nur wiederherstellen, wenn das Formular faktisch leer ist
  if ($('kunde').value.trim() || currentType()) return;
  const f = d.fields;
  if (f.auftragstyp === 'Reklamation') $('typRekl').checked = true;
  else if (f.auftragstyp === 'Fertigungsauftrag') $('typFert').checked = true;
  updateTypeFields(f.auftragstyp || '');
  DRAFT_FIELDS.filter((k) => k !== 'auftragstyp').forEach((k) => { if (f[k] != null) $(k).value = f[k]; });
  const t = new Date(d.savedAt);
  $('draftText').textContent = `Entwurf von ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} wiederhergestellt (Fotos bitte erneut hinzufügen).`;
  $('draftBanner').classList.remove('hidden');
  $('draftDiscard').onclick = () => { Draft.clear(); hideDraftBanner(); clearForm(); };
}
function hideDraftBanner() { $('draftBanner').classList.add('hidden'); }

/* ===================== UI-Helfer ===================== */
function esc(s) { return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.className = 'toast show'; t.textContent = msg; t.onclick = null;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}
function actionToast(msg, onClick) {
  const t = $('toast');
  t.className = 'toast action show'; t.textContent = msg;
  t.onclick = onClick;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 8000);
}
function showLoading(text) { $('loadingText').textContent = text || 'Bitte warten…'; $('loading').classList.add('show'); }
function hideLoading() { $('loading').classList.remove('show'); }

init();
