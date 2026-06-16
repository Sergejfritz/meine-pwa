// Live-Mitschrift – Echtzeit-Transkription (wie "Plaud", aber als Web-App).
// Sprache wird live in Text gewandelt (kein Audio wird gespeichert).
//
// WICHTIG / ehrliche Grenze: Eine PWA darf das Mikrofon NICHT im gesperrten
// Bildschirm oder im Hintergrund weiterlaufen lassen – das unterbindet das
// Handy-Betriebssystem (Datenschutz/Akku). Deshalb halten wir per Wake-Lock
// den Bildschirm an, solange aufgenommen wird, und starten die Erkennung bei
// Sprechpausen automatisch neu, sodass sie durchläuft, bis DU stoppst.

const $ = (id) => document.getElementById(id);
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

// ---- Speicher: nur Text, daher genügt localStorage (klein & schnell) ----
const KEY = 'techdoku_transcripts';
const MAX = 30;
const Notes = {
  all() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } },
  save(rec) {
    const list = this.all().filter((n) => n.id !== rec.id);
    list.unshift(rec);
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch {}
  },
  remove(id) {
    try { localStorage.setItem(KEY, JSON.stringify(this.all().filter((n) => n.id !== id))); } catch {}
  },
};

// ---- Laufzeit-Zustand ----
let rec = null;        // SpeechRecognition-Instanz
let wantOn = false;    // Nutzer möchte aufnehmen (steuert Auto-Neustart)
let finalText = '';    // gesicherter (fertig erkannter) Text
let interim = '';      // aktuell noch in Erkennung
let startedAt = 0;     // Zeitstempel Aufnahmebeginn
let elapsedBase = 0;   // bereits gelaufene ms (bei Pause/Fortsetzen)
let timerId = null;
let wakeLock = null;
let restartTimer = null;
let currentId = null;  // geladene/zu überschreibende Mitschrift

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function fmtDate(ts) {
  try { return new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}
function esc(s) { return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---- Bildschirm wachhalten, damit er sich nicht sperrt (Mic bliebe sonst stehen) ----
async function acquireWake() {
  try { if ('wakeLock' in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch {}
}
function releaseWake() { try { wakeLock && wakeLock.release(); } catch {} wakeLock = null; }

// ---- Anzeige ----
function render() {
  const box = $('trText');
  if (!box) return;
  if (!finalText && !interim) {
    box.innerHTML = '<span class="tr-placeholder">Auf „Aufnahme starten“ tippen und sprechen – der Text erscheint hier live …</span>';
  } else {
    box.innerHTML = esc(finalText) + (interim ? `<span class="tr-interim"> ${esc(interim)}</span>` : '');
    box.scrollTop = box.scrollHeight;
  }
  $('trToBemerkung').disabled = !finalText.trim();
  $('trSummary').disabled = !finalText.trim();
  $('trShare').disabled = !finalText.trim();
  $('trCopy').disabled = !finalText.trim();
  $('trSave').disabled = !finalText.trim();
}

function setState(on) {
  const dot = $('trDot'), state = $('trState'), toggle = $('trToggle');
  dot.classList.toggle('live', on);
  state.textContent = on ? 'Nimmt auf …' : (finalText ? 'Pausiert' : 'Bereit');
  toggle.classList.toggle('on', on);
  toggle.innerHTML = on ? '⏹ Aufnahme stoppen' : '⏺ Aufnahme starten';
}

function tickTimer() {
  const el = $('trTimer');
  if (el) el.textContent = fmtTime(elapsedBase + (startedAt ? Date.now() - startedAt : 0));
}

// ---- Erkennungs-Engine ----
function makeRec() {
  const r = new SR();
  r.lang = 'de-DE';
  r.continuous = true;
  r.interimResults = true;
  r.onresult = (e) => {
    let live = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      const txt = res[0].transcript;
      if (res.isFinal) {
        const t = txt.trim();
        if (t) finalText += (finalText ? ' ' : '') + t;
      } else {
        live += txt;
      }
    }
    interim = live;
    render();
  };
  r.onend = () => {
    // Web Speech endet von selbst (Pausen/Limits). Solange der Nutzer noch
    // aufnimmt: sofort neu starten -> läuft durch bis zum Stopp.
    if (wantOn) {
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => { try { r.start(); } catch {} }, 250);
    }
  };
  r.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      wantOn = false;
      stop();
      toastTr('Mikrofon ist blockiert – bitte den Zugriff erlauben.');
    }
    // 'no-speech' / 'aborted' / 'network' ignorieren – onend startet neu.
  };
  return r;
}

function start() {
  if (!SR) { toastTr('Spracherkennung wird von diesem Browser nicht unterstützt.'); return; }
  if (wantOn) return;
  wantOn = true;
  rec = makeRec();
  try { rec.start(); } catch {}
  startedAt = Date.now();
  clearInterval(timerId);
  timerId = setInterval(tickTimer, 500);
  acquireWake();
  setState(true);
}

function stop() {
  wantOn = false;
  clearTimeout(restartTimer);
  if (rec) { try { rec.stop(); } catch {} }
  rec = null;
  if (startedAt) { elapsedBase += Date.now() - startedAt; startedAt = 0; }
  clearInterval(timerId);
  interim = '';
  releaseWake();
  setState(false);
  render();
}

function resetSession() {
  stop();
  finalText = ''; interim = ''; elapsedBase = 0; currentId = null;
  render(); tickTimer();
}

// ---- Lokale Kurzfassung (extraktiv, ganz ohne Internet) ----
const STOP = new Set(('der die das und oder aber ich du er sie es wir ihr ein eine einen einem einer ' +
  'ist sind war waren hat haben hatte mit von zu im in den dem des auf für als auch so dann noch nur ' +
  'wie was wenn weil dass ja nein mal halt eben also schon mir mich dir dich uns euch sich am an bei ' +
  'aus nach vor über unter durch um doch wird werden kann können muss müssen soll sollen das').split(/\s+/));

function summarize(text) {
  const sentences = text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]?/g) || [];
  const clean = sentences.map((s) => s.trim()).filter((s) => s.split(' ').length >= 4);
  if (clean.length <= 3) return clean;
  const freq = {};
  text.toLowerCase().match(/[a-zäöüß]{4,}/g)?.forEach((w) => { if (!STOP.has(w)) freq[w] = (freq[w] || 0) + 1; });
  const scored = clean.map((s, i) => {
    let score = 0;
    s.toLowerCase().match(/[a-zäöüß]{4,}/g)?.forEach((w) => { if (freq[w]) score += freq[w]; });
    return { s, i, score: score / Math.sqrt(s.split(' ').length) };
  });
  const keep = Math.min(5, Math.max(3, Math.round(clean.length * 0.25)));
  return scored.sort((a, b) => b.score - a.score).slice(0, keep)
    .sort((a, b) => a.i - b.i).map((o) => o.s);
}

// ---- Speichern / Liste ----
function fullText() { return finalText.trim(); }

function saveCurrent() {
  const text = fullText();
  if (!text) return;
  const id = currentId || ('tr_' + Date.now());
  const title = text.split(/\s+/).slice(0, 7).join(' ') + (text.split(/\s+/).length > 7 ? ' …' : '');
  Notes.save({ id, title, text, createdAt: Date.now(), durationMs: elapsedBase });
  currentId = id;
  renderList();
  toastTr('Mitschrift gespeichert.');
}

function renderList() {
  const wrap = $('trList');
  const list = Notes.all();
  if (!list.length) { wrap.innerHTML = '<div class="tr-empty">Noch keine gespeicherten Mitschriften.</div>'; return; }
  wrap.innerHTML = list.map((n) => `
    <div class="tr-item" data-id="${n.id}">
      <button class="tr-item-main" data-act="load" data-id="${n.id}">
        <strong>${esc(n.title || 'Mitschrift')}</strong>
        <small>${fmtDate(n.createdAt)} · ${fmtTime(n.durationMs || 0)}</small>
      </button>
      <button class="tr-item-btn" data-act="share" data-id="${n.id}" title="Teilen" aria-label="Teilen">📤</button>
      <button class="tr-item-btn" data-act="del" data-id="${n.id}" title="Löschen" aria-label="Löschen">🗑</button>
    </div>`).join('');
}

function loadNote(id) {
  const n = Notes.all().find((x) => x.id === id);
  if (!n) return;
  resetSession();
  finalText = n.text; currentId = n.id; elapsedBase = n.durationMs || 0;
  render(); tickTimer();
  toastTr('Mitschrift geladen.');
}

// ---- Teilen / Kopieren ----
async function shareText(text) {
  if (!text) return;
  if (navigator.share) { try { await navigator.share({ title: 'Mitschrift', text }); return; } catch {} }
  copyText(text);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toastTr('In die Zwischenablage kopiert.'); }
  catch { toastTr('Kopieren nicht möglich.'); }
}

// kleiner eigener Toast (in App.toast nicht direkt erreichbar)
let trToastTimer;
function toastTr(msg) {
  const t = $('toast');
  if (!t) return;
  t.className = 'toast show'; t.textContent = msg; t.onclick = null;
  clearTimeout(trToastTimer);
  trToastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

function open() {
  $('trModal').classList.add('open');
  renderList();
  render();
}
function close() {
  if (wantOn && !confirm('Aufnahme läuft noch. Mitschrift schließen? (Text bleibt erhalten, bis du leerst.)')) return;
  stop();
  $('trModal').classList.remove('open');
}

export function initTranscribe(onToBemerkung) {
  const fab = $('fabRec');
  if (!fab) return;
  if (!SR) {
    // Ohne Spracherkennung hat die Funktion keinen Sinn -> Knopf ausblenden.
    fab.style.display = 'none';
    return;
  }
  fab.onclick = open;
  $('trClose').onclick = close;
  $('trToggle').onclick = () => (wantOn ? stop() : start());
  $('trSave').onclick = saveCurrent;
  $('trClear').onclick = () => { if (!fullText() || confirm('Aktuelle Mitschrift leeren?')) resetSession(); };
  $('trCopy').onclick = () => copyText(fullText());
  $('trShare').onclick = () => shareText(fullText());
  $('trSummary').onclick = () => {
    const pts = summarize(fullText());
    if (!pts.length) { toastTr('Zu wenig Text für eine Kurzfassung.'); return; }
    finalText = '📋 Kurzfassung:\n• ' + pts.join('\n• ') + '\n\n— — —\n\n' + fullText();
    render();
    toastTr('Kurzfassung oben eingefügt.');
  };
  $('trToBemerkung').onclick = () => {
    const text = fullText();
    if (!text) return;
    if (typeof onToBemerkung === 'function') onToBemerkung(text);
    close();
    toastTr('In das Bemerkungsfeld übernommen.');
  };

  // Liste: Laden / Teilen / Löschen
  $('trList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    if (b.dataset.act === 'load') loadNote(id);
    else if (b.dataset.act === 'share') { const n = Notes.all().find((x) => x.id === id); if (n) shareText(n.text); }
    else if (b.dataset.act === 'del') { if (confirm('Diese Mitschrift löschen?')) { Notes.remove(id); renderList(); } }
  });

  // Kommt der Bildschirm zurück, Wake-Lock erneut anfordern (Browser gibt ihn frei).
  document.addEventListener('visibilitychange', () => {
    if (wantOn && document.visibilityState === 'visible') acquireWake();
  });

  // Über Startbildschirm-Shortcut direkt öffnen (?record=1)
  try { if (new URLSearchParams(location.search).get('record') === '1') open(); } catch {}

  render();
}
