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

// Erkennungs-Modus: 'fast' = Browser-Spracherkennung (live, online),
// 'ai' = Whisper-KI komplett auf dem Gerät (genauer, privat, etwas verzögert).
const MODE_KEY = 'techdoku_tr_mode';
let mode = 'fast';
const hasFast = !!SR;
const hasAi = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && typeof MediaRecorder !== 'undefined';

// ---- KI-Modus (Whisper, on-device über transformers.js) ----
const WHISPER_LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';
const WHISPER_MODEL = 'Xenova/whisper-small'; // mehrsprachig, deutlich genauer als base (größer/langsamer)
// Statt nach fester Zeit wird an SPRECHPAUSEN geschnitten (VAD) – so wird kein
// Wort zerrissen oder doppelt erkannt. MAX = Notschnitt bei Dauerreden.
const SILENCE_MS = 650;   // so lange Stille = Satzende -> hier schneiden
const MIN_SEG_MS = 1800;  // vorher nicht schneiden (zu kurze Fetzen vermeiden)
const MAX_SEG_MS = 22000; // Notschnitt, falls ununterbrochen geredet wird
const VOICE_LEVEL = 0.012; // Pegel ab dem es als "Stimme" gilt
let asr = null;          // geladene Transkriptions-Pipeline
let asrLoading = null;   // Promise während des Ladens (verhindert Doppel-Laden)
let micStream = null;    // Mikrofon-Stream
let mr = null;           // MediaRecorder des aktuellen Segments
let audioChunks = [];
let jobQueue = Promise.resolve(); // serialisiert die Transkription der Segmente
let audioCtx = null, analyser = null, vadData = null, vadTimer = null;
let segStartedAt = 0, lastVoiceAt = 0, sawVoice = false;

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
        if (t) finalText = collapseRepeats((finalText ? finalText + ' ' : '') + t);
      } else {
        live += txt;
      }
    }
    interim = live;
    render();
  };
  r.onend = () => {
    if (wantOn) {
      // Auto-Neustart bei Sprechpausen: den Zwischenstand NICHT übernehmen –
      // sonst doppeln sich Wörter ("Red Bull Red Bull und dann ...").
      // Pausen-Wörter sind in aller Regel schon als "final" angekommen.
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => { try { r.start(); } catch {} }, 120);
    } else if (interim.trim()) {
      // Nur beim echten Stopp: letzten Zwischenstand noch sichern.
      finalText = collapseRepeats((finalText ? finalText + ' ' : '') + interim.trim());
      interim = '';
      render();
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

function setAiStatus(msg) {
  const el = $('trModelStatus');
  if (el) { el.textContent = msg || ''; el.classList.toggle('hidden', !msg); }
}

// Gemeinsame Weiche: je nach gewähltem Modus
function start() { return mode === 'ai' ? startAi() : startFast(); }
function stop() { return mode === 'ai' ? stopAi() : stopFast(); }

/* ---------- Modus „Schnell" (Browser-Spracherkennung) ---------- */
function startFast() {
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

function stopFast() {
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

/* ---------- Modus „Genau" (Whisper-KI, on-device) ---------- */
// Modell einmalig laden (danach im Browser-Cache -> offline nutzbar).
function ensureModel() {
  if (asr) return Promise.resolve(asr);
  if (asrLoading) return asrLoading;
  setAiStatus('KI-Modell wird geladen … (einmalig ~250 MB, danach offline)');
  asrLoading = import(WHISPER_LIB)
    .then(({ pipeline }) => pipeline('automatic-speech-recognition', WHISPER_MODEL, {
      device: (typeof navigator !== 'undefined' && navigator.gpu) ? 'webgpu' : 'wasm',
      dtype: 'q8',
      progress_callback: (p) => {
        if (p && p.status === 'progress' && p.progress != null) {
          setAiStatus(`KI-Modell wird geladen … ${Math.round(p.progress)}%`);
        }
      },
    }))
    .then((p) => { asr = p; setAiStatus(''); return p; })
    .catch((e) => { asrLoading = null; setAiStatus('KI-Modell konnte nicht geladen werden (Internet beim ersten Mal nötig).'); throw e; });
  return asrLoading;
}

// Aufgenommenes Audio-Stück in 16-kHz-Mono umrechnen (Whisper-Eingabe).
async function blobToPCM(blob) {
  const buf = await blob.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  try {
    const audio = await ac.decodeAudioData(buf);
    const src = audio.getChannelData(0);
    const ratio = audio.sampleRate / 16000;
    const len = Math.max(0, Math.floor(src.length / ratio));
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) out[i] = src[Math.floor(i * ratio)] || 0;
    return out;
  } finally { try { ac.close(); } catch {} }
}

// Lautstärke (RMS) eines Audio-Stücks – zum Überspringen (fast) stiller Blöcke,
// die Whisper sonst zu Halluzinationen/Wiederholungen verleiten.
function rms(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return a.length ? Math.sqrt(s / a.length) : 0;
}

// Whisper „hängt" gern in Schleifen ("a b a b a b"). Diese Funktion kollabiert
// unmittelbar wiederholte Wörter und Phrasen (Länge 1–5) auf einmal.
function collapseRepeats(text) {
  const tok = (text || '').split(/\s+/).filter(Boolean);
  const out = [];
  for (const t of tok) {
    out.push(t);
    for (let k = 1; k <= 5; k++) {
      if (out.length >= 2 * k) {
        let rep = true;
        for (let i = 0; i < k; i++) {
          if (out[out.length - 1 - i].toLowerCase() !== out[out.length - 1 - k - i].toLowerCase()) { rep = false; break; }
        }
        if (rep) { out.splice(out.length - k, k); break; }
      }
    }
  }
  return out.join(' ');
}

// Doppelung an der Block-Grenze entfernen (letzte Wörter == erste Wörter).
function trimBoundary(t) {
  const prev = finalText.trim().split(/\s+/).filter(Boolean).slice(-8).map((x) => x.toLowerCase());
  let cur = t.split(/\s+/).filter(Boolean);
  for (let k = Math.min(8, cur.length, prev.length); k >= 1; k--) {
    const a = prev.slice(prev.length - k).join(' ');
    const b = cur.slice(0, k).map((x) => x.toLowerCase()).join(' ');
    if (a === b) { cur = cur.slice(k); break; }
  }
  return cur.join(' ');
}

async function transcribeBlob(blob) {
  if (!blob || blob.size < 2500) return; // zu kurz – überspringen
  try {
    const pcm = await blobToPCM(blob);
    if (pcm.length < 1600) return;        // < ~0,1 s
    if (rms(pcm) < 0.006) return;         // (fast) Stille -> nichts ans Modell geben
    const model = await ensureModel();
    const res = await model(pcm, {
      language: 'german',
      task: 'transcribe',
      no_repeat_ngram_size: 3,            // verhindert Wiederholungs-Schleifen
      temperature: 0,                     // deterministisch (kein „Fantasieren")
      compression_ratio_threshold: 2.4,   // verdächtig repetitive Ausgaben verwerfen
    });
    let t = collapseRepeats(((res && res.text) || '').trim());
    t = trimBoundary(t);
    if (t) { finalText += (finalText ? ' ' : '') + t; render(); }
  } catch {
    // Einzelnes Segment fehlgeschlagen – weiterlaufen, nicht alles abbrechen.
  }
}

function startSegment() {
  audioChunks = [];
  try { mr = new MediaRecorder(micStream); } catch { mr = new MediaRecorder(micStream, { mimeType: 'audio/webm' }); }
  mr.ondataavailable = (e) => { if (e.data && e.data.size) audioChunks.push(e.data); };
  mr.onstop = () => {
    const blob = new Blob(audioChunks, { type: (mr && mr.mimeType) || 'audio/webm' });
    if (wantOn) startSegment(); // nahtlos das nächste Stück aufnehmen
    jobQueue = jobQueue
      .then(() => transcribeBlob(blob))
      .then(() => { if (!wantOn) setAiStatus(''); });
  };
  try { mr.start(); } catch {}
  segStartedAt = Date.now();
  lastVoiceAt = Date.now();
  sawVoice = false;
}

// Pegel live mitlesen und an Sprechpausen schneiden (Voice Activity Detection).
function vadTick() {
  if (!analyser || !mr || mr.state === 'inactive') return;
  analyser.getFloatTimeDomainData(vadData);
  let s = 0;
  for (let i = 0; i < vadData.length; i++) s += vadData[i] * vadData[i];
  const level = Math.sqrt(s / vadData.length);
  const now = Date.now();
  if (level > VOICE_LEVEL) { lastVoiceAt = now; sawVoice = true; }
  const segLen = now - segStartedAt;
  const silenceLen = now - lastVoiceAt;
  // Schneiden: nach Mindestlänge bei genug Stille – oder spätestens beim Notschnitt
  if (segLen >= MAX_SEG_MS || (sawVoice && segLen >= MIN_SEG_MS && silenceLen >= SILENCE_MS)) {
    if (mr && mr.state !== 'inactive') { try { mr.stop(); } catch {} } // onstop startet das nächste Segment
  }
}

async function startAi() {
  if (wantOn) return;
  if (!hasAi) { toastTr('Dieser Browser unterstützt die KI-Aufnahme nicht.'); return; }
  wantOn = true;
  setState(true);
  ensureModel().catch(() => {}); // schon mal vorladen, während gesprochen wird
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch { wantOn = false; setState(false); toastTr('Mikrofon ist blockiert – bitte Zugriff erlauben.'); return; }
  // Pegel-Analyse für die Pausen-Erkennung aufsetzen
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
    const srcNode = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    vadData = new Float32Array(analyser.fftSize);
    srcNode.connect(analyser);
  } catch { analyser = null; }
  startedAt = Date.now();
  clearInterval(timerId);
  timerId = setInterval(tickTimer, 500);
  clearInterval(vadTimer);
  vadTimer = setInterval(vadTick, 100);
  acquireWake();
  startSegment();
}

function stopAi() {
  wantOn = false;
  clearInterval(vadTimer);
  if (mr && mr.state !== 'inactive') { try { mr.stop(); } catch {} } // letztes Stück wird noch transkribiert
  if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
  if (audioCtx) { try { audioCtx.close(); } catch {} audioCtx = null; analyser = null; }
  if (startedAt) { elapsedBase += Date.now() - startedAt; startedAt = 0; }
  clearInterval(timerId);
  releaseWake();
  setState(false);
  if (asr || asrLoading) setAiStatus('Rest-Audio wird verarbeitet …');
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

function applyMode(m) {
  if (wantOn) stop(); // laufende Aufnahme im alten Modus beenden
  mode = (m === 'ai' && hasAi) ? 'ai' : (hasFast ? 'fast' : (hasAi ? 'ai' : 'fast'));
  try { localStorage.setItem(MODE_KEY, mode); } catch {}
  document.querySelectorAll('input[name=trMode]').forEach((r) => { r.checked = (r.value === mode); });
  const note = $('trModeNote');
  if (note) {
    note.textContent = mode === 'ai'
      ? '🎯 KI-Modus (whisper-small): läuft komplett auf dem Gerät (privat) und ist genauer. Text erscheint nach jeder Sprechpause (satzweise), also etwas verzögert. Erster Start lädt einmalig das Modell (~250 MB, WLAN empfohlen).'
      : '⚡ Schnell-Modus: Browser-Spracherkennung, sofort live – Audio wird dabei zur Erkennung an den Browser-Anbieter (z. B. Google) gesendet.';
  }
  setAiStatus('');
}

export function initTranscribe(onToBemerkung) {
  const fab = $('fabRec');
  if (!fab) return;
  if (!hasFast && !hasAi) {
    // Weder Browser-Spracherkennung noch KI-Aufnahme möglich -> Knopf ausblenden.
    fab.style.display = 'none';
    return;
  }
  // Modus-Umschalter: nicht verfügbare Modi deaktivieren
  const fastRadio = document.querySelector('input[name=trMode][value=fast]');
  const aiRadio = document.querySelector('input[name=trMode][value=ai]');
  if (fastRadio) fastRadio.disabled = !hasFast;
  if (aiRadio) aiRadio.disabled = !hasAi;
  document.querySelectorAll('input[name=trMode]').forEach((r) => { r.onchange = () => applyMode(r.value); });
  let saved = 'fast';
  try { saved = localStorage.getItem(MODE_KEY) || 'fast'; } catch {}
  applyMode(saved);

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
