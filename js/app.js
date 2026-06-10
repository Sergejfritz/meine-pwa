import { Settings, Suggest, Draft, Zones } from './store.js';
import { Archive } from './archive.js';
import { createPDF, buildFilename } from './pdf.js';
import { annotate } from './annotate.js';
import { scanArbeitskarte } from './scan.js';
import { openZoneCalibrator } from './zonecal.js';
import { zoneLabel } from './zones.js';
import { openSignaturePad } from './signature.js';

const $ = (id) => document.getElementById(id);
const MAX_IMAGES = 9;
const SUGGEST_FIELDS = ['kunde', 'maschine', 'verantwortlich', 'teilebenennung'];
// Pflichttextfelder je Auftragstyp (datum hat Default; stueckzahl & auftragstyp
// werden gesondert geprüft). "Privat" braucht nur das Nötigste.
const REQUIRED = ['kunde', 'maschine', 'abnr', 'zeichnungsnummer', 'index', 'verantwortlich', 'datum', 'teilebenennung', 'bemerkung'];
const REQUIRED_PRIVAT = ['teilebenennung', 'datum', 'bemerkung'];
// Felder, die bei "Privat" ausgeblendet werden (ergeben privat keinen Sinn)
const PRIVAT_HIDE = ['kunde', 'maschine', 'abnr', 'position', 'zeichnungsnummer', 'index', 'stueckzahl'];
function requiredFor(typ) { return typ === 'Privat' ? REQUIRED_PRIVAT : REQUIRED; }
const DRAFT_FIELDS = ['auftragstyp', 'kunde', 'maschine', 'abnr', 'position', 'zeichnungsnummer', 'index', 'verantwortlich', 'datum', 'teilebenennung', 'stueckzahl', 'version', 'spanndruck', 'bemerkung'];

let images = []; // [{ id, src, name, caption }]
let signature = ''; // Unterschrift als PNG-Daten-URL ('' = keine)

/* ===================== Init ===================== */
function init() {
  initSplash();
  registerSW();
  initTheme();
  initType();
  initPhotos();
  initScan();
  initVoice();
  initActions();
  initLightbox();
  initLiveValidation();
  initDraftAutosave();
  initArchive();
  initProgress();
  initRipple();
  initInstall();
  initZones();
  initSignature();
  refreshSuggestions();
  setToday();
  const last = Settings.get().lastVerantwortlich;
  if (last) $('verantwortlich').value = last;
  restoreDraft();
  updateProgress();
}

/* ===================== Start-/Ladebildschirm ===================== */
// Der Splash blendet per CSS von selbst weg (Fallback ohne JS). Hier räumen
// wir ihn danach aus dem DOM, damit nichts im Hintergrund weiterläuft.
function initSplash() {
  const el = $('splash');
  if (!el) return;
  const remove = () => { el.classList.add('gone'); setTimeout(() => el.remove(), 400); };
  setTimeout(remove, 2400);
}

/* ===================== App installieren ===================== */
// Macht aus dem Browser-Tab eine echte Vollbild-App. Android/Chrome liefern
// das beforeinstallprompt-Event; iOS/Safari kennt das nicht → Anleitung zeigen.
function isStandalone() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
let deferredPrompt = null;

function initInstall() {
  const card = $('installCard');
  // Schon installiert oder bewusst weggeklickt? Dann nichts zeigen.
  if (isStandalone() || Settings.get().installDismissed) return;

  $('installClose').onclick = () => { card.classList.add('hidden'); Settings.set({ installDismissed: true }); };

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('installSteps').classList.add('hidden');
    $('installBtn').classList.remove('hidden');
    card.classList.remove('hidden');
  });

  $('installBtn').onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (outcome === 'accepted') card.classList.add('hidden');
  };

  window.addEventListener('appinstalled', () => {
    card.classList.add('hidden');
    Settings.set({ installDismissed: true });
    toast('App installiert ✓ – ab jetzt im Vollbild');
  });

  // iOS: kein automatisches Prompt → Schritt-für-Schritt-Anleitung anzeigen
  if (isIOS()) {
    $('installBtn').classList.add('hidden');
    $('installText').textContent = 'In Safari als App ablegen – dann öffnet sie im Vollbild ohne Browserleiste:';
    const steps = $('installSteps');
    steps.innerHTML = '<li>Unten auf <b>Teilen</b> tippen (das Symbol mit dem Pfeil ↑)</li>'
      + '<li><b>„Zum Home-Bildschirm"</b> wählen</li>'
      + '<li>Mit <b>„Hinzufügen"</b> bestätigen</li>';
    steps.classList.remove('hidden');
    card.classList.remove('hidden');
  }
}

/* ===================== Scan-Vorlage (Zonen) ===================== */
function initZones() {
  $('zoneSetup').onclick = async () => {
    const saved = await openZoneCalibrator();
    if (saved) toast('Scan-Vorlage gespeichert ✓');
    refreshZoneStatus();
  };
  refreshZoneStatus();
}
function refreshZoneStatus() {
  const tpl = Zones.get();
  const el = $('zoneStatus');
  if (tpl && tpl.items && tpl.items.length) {
    const names = tpl.items.map((z) => zoneLabel(z.field)).join(', ');
    el.textContent = `⚙️ Scan-Vorlage aktiv (${tpl.items.length}): ${names} – tippen zum Ändern`;
  } else {
    el.textContent = '⚙️ Scan-Vorlage einrichten – Felder selbst festlegen';
  }
}

/* ===================== Unterschrift ===================== */
function initSignature() {
  $('sigOpen').onclick = async () => {
    const r = await openSignaturePad(signature);
    if (r === null) return;        // Abbruch → unverändert
    signature = r;                 // '' = geleert übernommen, sonst Daten-URL
    renderSignature(); saveDraft(); vibrate(10);
  };
  $('sigDelete').onclick = () => { signature = ''; renderSignature(); saveDraft(); };
  renderSignature();
}
function renderSignature() {
  const has = !!signature;
  $('sigPreviewWrap').classList.toggle('hidden', !has);
  $('sigDelete').classList.toggle('hidden', !has);
  if (has) $('sigPreview').src = signature;
  $('sigOpen').textContent = has ? '✍️ Ändern' : '✍️ Unterschreiben';
}

/* ===================== Service Worker (+ Update-Hinweis) ===================== */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    // regelmäßig auf neue Version prüfen (App bleibt oft lange offen)
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(() => {});
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || refreshing) return; // beim Erst-Install nicht neu laden
    refreshing = true;
    // Nichts Wichtiges offen? Dann automatisch aktualisieren – sonst Hinweis,
    // damit keine ungespeicherten Fotos verloren gehen.
    if (isFormDirty()) {
      refreshing = false;
      actionToast('Neue Version verfügbar – tippen zum Aktualisieren', () => location.reload());
    } else {
      location.reload();
    }
  });
}
// "Dirty" = es gibt ungesicherte Eingaben/Fotos, die ein Reload verlieren würde
function isFormDirty() {
  return images.length > 0 || !!signature ||
    ['kunde', 'teilebenennung', 'bemerkung', 'abnr'].some((id) => $(id) && $(id).value.trim());
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

  // Bei "Privat": fertigungsspezifische Felder ausblenden
  const priv = val === 'Privat';
  PRIVAT_HIDE.forEach((id) => $(id).closest('.field').classList.toggle('hidden', priv));

  // Bezeichnungs-Feld passend benennen + Verantwortlich privat optional
  $('teilebenennung').closest('.field').querySelector('label').innerHTML =
    (priv ? 'Bezeichnung' : 'Benennung der Teile') + ' <span class="req">*</span>';
  const veraReq = $('verantwortlich').closest('.field').querySelector('.req');
  if (veraReq) veraReq.style.display = priv ? 'none' : '';
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

/* ===================== Arbeitskarte scannen ===================== */
// Beschriftungen + zugehörige Formularfelder für den Übernahme-Dialog
const SCAN_MAP = [
  { key: 'kunde', label: 'Kunde', target: 'kunde' },
  { key: 'abnr', label: 'AB-Nr.', target: 'abnr' },
  { key: 'position', label: 'Position', target: 'position' },
  { key: 'zeichnungsnummer', label: 'Zeichnungsnr.', target: 'zeichnungsnummer' },
  { key: 'index', label: 'Index', target: 'index' },
  { key: 'teilebenennung', label: 'Benennung der Teile', target: 'teilebenennung' },
  { key: 'stueckzahl', label: 'Stückzahl', target: 'stueckzahl' },
  { key: 'datum', label: 'Datum', target: 'datum', iso: 'datumIso' },
];
let scanFields = {};

function initScan() {
  // Kamera UND Galerie: beide Eingänge lösen dieselbe Auto-Erkennung aus
  const onScanFile = async (e) => {
    const file = (e.target.files || [])[0];
    e.target.value = '';
    if (!file) return;
    await runScan(file);
  };
  $('scanInput').addEventListener('change', onScanFile);
  $('scanGalleryInput').addEventListener('change', onScanFile);
  $('scanClose').onclick = closeScanSheet;
  $('scanCancel').onclick = closeScanSheet;
  $('scanApply').onclick = applyScan;
}

async function runScan(file) {
  $('scanProgress').textContent = 'Karte wird gelesen… 0%';
  $('scanLoading').classList.add('show');
  try {
    const dataUrl = await readFile(file);
    const result = await scanArbeitskarte(dataUrl, (p) => {
      $('scanProgress').textContent = `Karte wird gelesen… ${Math.round(p * 100)}%`;
    });
    scanFields = result.fields || {};
    showScanSheet(scanFields, result.hits || 0);
  } catch (err) {
    console.error(err);
    toast('Scan fehlgeschlagen – bitte erneut versuchen');
  } finally {
    $('scanLoading').classList.remove('show');
  }
}

function showScanSheet(fields, hits) {
  const box = $('scanResults');
  box.innerHTML = '';
  const found = SCAN_MAP.filter((m) => fields[m.key]);
  $('scanEmpty').classList.toggle('hidden', found.length > 0);
  $('scanApply').disabled = found.length === 0;

  // Hinweis bei wenigen/teils unsicheren Treffern
  const hint = $('scanHint');
  if (found.length && found.length < 4) {
    hint.textContent = '⚠️ Wenige Felder erkannt. Tipp: Karte gerade von oben, formatfüllend und gut beleuchtet fotografieren. Fehlende Felder bitte von Hand ergänzen.';
    hint.classList.remove('hidden');
  } else {
    hint.classList.add('hidden');
  }

  found.forEach((m) => {
    const row = document.createElement('label');
    row.className = 'scan-row';
    const display = m.iso && fields[m.iso] ? fields[m.key] : fields[m.key];
    row.innerHTML = `
      <input type="checkbox" data-key="${m.key}" checked>
      <span class="rl"><span class="rk">${m.label}</span><span class="rv">${esc(display)}</span></span>`;
    box.appendChild(row);
  });
  $('scanSheet').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function applyScan() {
  let count = 0;
  $('scanResults').querySelectorAll('input[type=checkbox]:checked').forEach((cb) => {
    const m = SCAN_MAP.find((x) => x.key === cb.dataset.key);
    if (!m) return;
    let val = scanFields[m.key];
    if (m.iso) val = scanFields[m.iso] || ''; // Datum als ISO ins date-Feld
    if (!val) return;
    const el = $(m.target);
    el.value = val;
    el.classList.remove('invalid');
    el.closest('.field')?.classList.remove('has-error');
    count++;
  });
  closeScanSheet();
  saveDraft();
  updateProgress();
  if (count) {
    vibrate(15);
    toast(`${count} Feld${count > 1 ? 'er' : ''} übernommen – bitte prüfen ✓`);
    $('kunde').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function closeScanSheet() {
  $('scanSheet').classList.remove('open');
  document.body.style.overflow = '';
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
      <img src="${im.src}" alt="Foto ${i + 1}${im.caption ? ': ' + esc(im.caption) : ''}" loading="lazy" decoding="async">
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
  updateProgress();
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
  const doc = { auftragstyp: currentType(), unterschrift: signature, images: images.map((i) => ({ src: i.src, name: i.name, caption: i.caption })) };
  ['kunde', 'maschine', 'abnr', 'position', 'zeichnungsnummer', 'index', 'verantwortlich', 'datum',
    'teilebenennung', 'stueckzahl', 'version', 'spanndruck', 'bemerkung'].forEach((f) => doc[f] = $(f).value);
  return doc;
}

function clearForm() {
  document.querySelectorAll('input[name=auftragstyp]').forEach((r) => r.checked = false);
  updateTypeFields('');
  ['kunde', 'maschine', 'abnr', 'position', 'zeichnungsnummer', 'index', 'teilebenennung',
    'stueckzahl', 'version', 'spanndruck', 'bemerkung'].forEach((f) => $(f).value = '');
  $('verantwortlich').value = Settings.get().lastVerantwortlich || '';
  images = [];
  signature = '';
  renderSignature();
  renderPhotos();
  setToday();
  clearAllErrors();
  updateProgress();
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
  // Fehler verschwindet, sobald der Nutzer das Feld korrigiert; zusätzlich
  // ein grüner Impuls, sobald ein Feld erstmals gültig befüllt ist.
  ['kunde', 'maschine', 'abnr', 'zeichnungsnummer', 'index', 'verantwortlich', 'datum',
    'teilebenennung', 'stueckzahl', 'version', 'spanndruck', 'bemerkung'].forEach((id) => {
    const el = $(id);
    el.addEventListener('input', () => {
      const ok = el.value.trim() && (id !== 'stueckzahl' || Number(el.value) > 0);
      if (ok) setErr(id, false);
      if (ok && !el.dataset.filled) { el.dataset.filled = '1'; flashOk(el); }
      else if (!ok) delete el.dataset.filled;
    });
  });
}

function validate() {
  clearAllErrors();
  const doc = readForm();
  let firstBad = null;
  const flag = (el) => { if (!firstBad) firstBad = el; };

  const priv = doc.auftragstyp === 'Privat';
  if (!doc.auftragstyp) { setTypeError(true); flag(document.querySelector('[data-for=auftragstyp]')); }
  for (const f of requiredFor(doc.auftragstyp)) {
    if (!String(doc[f] || '').trim()) { setErr(f, true); flag($(f)); }
  }
  if (!priv && !(Number(doc.stueckzahl) > 0)) { setErr('stueckzahl', true, 'Muss größer als 0 sein.'); flag($('stueckzahl')); }
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
      await finalize(doc);
      celebrate('PDF erstellt!');
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
        await finalize(doc);
        celebrate('PDF geteilt!');
      } else {
        pdf.save(buildFilename(doc));
        await finalize(doc);
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

// Nach erfolgreichem Erstellen/Teilen: Vorschläge merken, ins Archiv legen,
// Entwurf löschen. Das Archiv speichert die komplette Doku inkl. Fotos.
async function finalize(doc) {
  SUGGEST_FIELDS.forEach((f) => Suggest.remember(f, doc[f]));
  if (doc.verantwortlich) Settings.set({ lastVerantwortlich: doc.verantwortlich.trim() });
  refreshSuggestions();
  const { images, ...fields } = doc;
  try {
    await Archive.add({ id: 'a' + Date.now(), createdAt: Date.now(), fields, images: images || [] });
    await renderArchive();
  } catch { /* Archiv optional – Fehler nicht blockierend */ }
  Draft.clear();
  hideDraftBanner();
}

/* ===================== Entwurf-Sicherung ===================== */
let draftTimer;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    const fields = {}; DRAFT_FIELDS.forEach((f) => fields[f] = f === 'auftragstyp' ? currentType() : $(f).value);
    fields.unterschrift = signature;
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
  else if (f.auftragstyp === 'Privat') $('typPriv').checked = true;
  updateTypeFields(f.auftragstyp || '');
  DRAFT_FIELDS.filter((k) => k !== 'auftragstyp').forEach((k) => { if (f[k] != null) $(k).value = f[k]; });
  signature = f.unterschrift || '';
  renderSignature();
  const t = new Date(d.savedAt);
  $('draftText').textContent = `Entwurf von ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} wiederhergestellt (Fotos bitte erneut hinzufügen).`;
  $('draftBanner').classList.remove('hidden');
  $('draftDiscard').onclick = () => { Draft.clear(); hideDraftBanner(); clearForm(); };
}
function hideDraftBanner() { $('draftBanner').classList.add('hidden'); }

/* ===================== Verlauf (Vorlagen) ===================== */
const HIST_PREVIEW = 3; // eingeklappt sichtbare Einträge
const TYPE_ICON = { Reklamation: '⚠️', Fertigungsauftrag: '🏭', Privat: '🏠' };

function initArchive() {
  $('histToggle').onclick = () => {
    const btn = $('histToggle');
    const open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!open));
    btn.textContent = open ? 'Alle anzeigen' : 'Weniger';
    renderArchive();
  };
  renderArchive();
}

async function renderArchive() {
  let list = [];
  try { list = await Archive.list(); } catch { list = []; }
  const card = $('historyCard');
  card.classList.toggle('hidden', list.length === 0);
  if (!list.length) return;

  const expanded = $('histToggle').getAttribute('aria-expanded') === 'true';
  $('histToggle').style.display = list.length > HIST_PREVIEW ? '' : 'none';
  const show = expanded ? list : list.slice(0, HIST_PREVIEW);

  const box = $('historyList');
  box.innerHTML = '';
  show.forEach((e) => {
    const f = e.fields || {};
    const d = new Date(e.createdAt);
    const when = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
    const thumb = (e.images && e.images[0] && e.images[0].src) || '';
    const nPhotos = (e.images || []).length;
    const row = document.createElement('div');
    row.className = 'hist-row';
    row.innerHTML = `
      <button class="hist-main" type="button">
        ${thumb ? `<img class="hist-thumb" src="${thumb}" alt="" loading="lazy" decoding="async">` : `<span class="hist-ico">${TYPE_ICON[f.auftragstyp] || '📄'}</span>`}
        <span class="hist-txt">
          <strong>${esc(f.teilebenennung || f.kunde || 'Dokumentation')}</strong>
          <small>${esc([f.kunde, f.abnr, when].filter(Boolean).join(' · '))}${nPhotos ? ` · ${nPhotos} 📷` : ''}</small>
        </span>
        <span class="hist-go" aria-hidden="true">↪</span>
      </button>
      <button class="hist-pdf" type="button" aria-label="Als PDF teilen" title="Als PDF teilen">📄</button>
      <button class="hist-del" type="button" aria-label="Eintrag löschen" title="Löschen">🗑</button>`;
    row.querySelector('.hist-main').onclick = () => loadArchiveEntry(e);
    row.querySelector('.hist-pdf').onclick = () => sharePdfFromEntry(e);
    row.querySelector('.hist-del').onclick = async () => {
      if (!confirm('Diesen Archiv-Eintrag löschen?')) return;
      await Archive.remove(e.id); renderArchive();
    };
    box.appendChild(row);
  });
}

// Vollständige Doku (inkl. Fotos) zurück ins Formular laden
function loadArchiveEntry(entry) {
  const dirty = images.length || $('kunde').value.trim() || $('bemerkung').value.trim();
  if (dirty && !confirm('Aktuelle Eingaben mit dieser gespeicherten Doku überschreiben?')) return;
  const f = entry.fields || {};
  $('typRekl').checked = f.auftragstyp === 'Reklamation';
  $('typFert').checked = f.auftragstyp === 'Fertigungsauftrag';
  $('typPriv').checked = f.auftragstyp === 'Privat';
  updateTypeFields(f.auftragstyp || '');
  DRAFT_FIELDS.filter((k) => k !== 'auftragstyp').forEach((k) => { $(k).value = f[k] || ''; });
  setToday();
  images = (entry.images || []).map((im, i) => ({
    id: 'img_' + Date.now() + '_' + i, src: im.src, name: im.name || ('Bild' + (i + 1)), caption: im.caption || '',
  }));
  signature = f.unterschrift || '';
  renderSignature();
  renderPhotos();
  clearAllErrors();
  saveDraft();
  updateProgress();
  vibrate(15);
  toast('Doku geladen – bearbeiten oder neu teilen');
  $('kunde').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Direkt aus dem Archiv erneut als PDF teilen/speichern
async function sharePdfFromEntry(entry) {
  const doc = { ...(entry.fields || {}), images: entry.images || [] };
  showLoading('PDF wird vorbereitet…');
  let pdf;
  try { pdf = await createPDF(doc); } catch (e) { hideLoading(); toast('Fehler bei der PDF-Erstellung'); return; }
  const file = new File([pdf.output('blob')], buildFilename(doc), { type: 'application/pdf' });
  hideLoading();
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ title: 'Technische Dokumentation S. Fritz', text: 'Technische Dokumentation (PDF)', files: [file] });
    } else {
      pdf.save(buildFilename(doc));
      toast('PDF gespeichert');
    }
  } catch (e) { if (e?.name !== 'AbortError') toast('Teilen abgebrochen'); }
}

/* ===================== Fortschrittsanzeige ===================== */
// Zählt Auftragstyp, die je nach Typ tatsächlich nötigen Pflichtfelder und
// Fotos – passend zu validate(), damit der Ring auch bei "Privat" 100% erreicht.
function progressParts() {
  const typ = currentType();
  const parts = [!!typ];
  requiredFor(typ).forEach((f) => parts.push(!!$(f).value.trim()));
  if (typ !== 'Privat') parts.push(Number($('stueckzahl').value) > 0);
  if (typ === 'Reklamation') parts.push(!!$('version').value.trim());
  if (typ === 'Fertigungsauftrag') parts.push(!!$('spanndruck').value.trim());
  parts.push(images.length > 0);
  return parts;
}
let ringCur = 0, ringRAF;
function updateProgress() {
  const parts = progressParts();
  const pct = Math.round(parts.filter(Boolean).length / parts.length * 100);
  const ring = $('progressRing');
  ring.style.setProperty('--p', pct);           // Füllung gleitet per CSS
  ring.classList.toggle('done', pct === 100);
  // Prozentzahl weich hochzählen (passend zur gleitenden Füllung)
  cancelAnimationFrame(ringRAF);
  const from = ringCur, t0 = performance.now(), dur = 600;
  (function tick(t) {
    const k = Math.min(1, (t - t0) / dur);
    const v = Math.round(from + (pct - from) * (1 - Math.pow(1 - k, 3)));
    $('progressPct').textContent = v + '%';
    if (k < 1) ringRAF = requestAnimationFrame(tick); else ringCur = pct;
  })(t0);
}
function initProgress() {
  const sec = $('formView');
  sec.addEventListener('input', updateProgress);
  sec.addEventListener('change', updateProgress);
}

/* ===================== Micro-Interaktionen ===================== */
// Material-artige Welle beim Tippen auf Buttons
function initRipple() {
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.btn');
    if (!btn || btn.disabled) return;
    const r = btn.getBoundingClientRect();
    const size = Math.max(r.width, r.height);
    const s = document.createElement('span');
    s.className = 'ripple';
    s.style.width = s.style.height = size + 'px';
    s.style.left = (e.clientX - r.left - size / 2) + 'px';
    s.style.top = (e.clientY - r.top - size / 2) + 'px';
    btn.appendChild(s);
    s.addEventListener('animationend', () => s.remove());
  });
}

// Kurzer grüner Impuls, sobald ein Pflichtfeld gültig befüllt ist
function flashOk(el) {
  el.classList.remove('ok-flash');
  void el.offsetWidth; // Reflow → Animation kann neu starten
  el.classList.add('ok-flash');
  setTimeout(() => el.classList.remove('ok-flash'), 750);
}

/* ===================== Erfolgs-Animation ===================== */
function celebrate(text) {
  vibrate([20, 40, 30]);
  const ov = $('successOverlay');
  $('successText').textContent = text || 'Fertig!';
  ov.classList.add('show');
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) launchConfetti();
  const hide = () => { ov.classList.remove('show'); ov.onclick = null; };
  ov.onclick = hide;
  setTimeout(hide, 2200);
}

// Leichtes Konfetti auf Canvas – kein zusätzliches Vendor-Skript nötig
function launchConfetti() {
  const cv = $('confettiCanvas');
  const ctx = cv.getContext('2d');
  cv.width = innerWidth; cv.height = innerHeight;
  const colors = ['#38bdf8', '#16a34a', '#f59e0b', '#ef4444', '#a78bfa', '#fff'];
  const parts = Array.from({ length: 120 }, () => ({
    x: cv.width / 2 + (Math.random() - .5) * 120,
    y: cv.height / 2,
    vx: (Math.random() - .5) * 11,
    vy: -(4 + Math.random() * 9),
    s: 4 + Math.random() * 5,
    c: colors[(Math.random() * colors.length) | 0],
    r: Math.random() * Math.PI,
    vr: (Math.random() - .5) * .3,
  }));
  let frames = 0;
  (function tick() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    parts.forEach((p) => {
      p.x += p.vx; p.y += p.vy; p.vy += .28; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * .6);
      ctx.restore();
    });
    if (++frames < 130) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, cv.width, cv.height);
  })();
}

function vibrate(pattern) { try { navigator.vibrate?.(pattern); } catch {} }

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
