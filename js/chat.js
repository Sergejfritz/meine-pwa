// KI-Assistent – Chat-Fenster der App. Spricht mit dem lokal im Browser
// laufenden Modell (js/aiengine.js) und nutzt das lokale Gedächtnis
// (js/aimemory.js). Kann zusätzlich "im Formular handeln": die aktuelle
// Bemerkung zusammenfassen / in Stichpunkte wandeln / verständlicher schreiben
// und das Ergebnis ins Bemerkungsfeld übernehmen.

import { isSupported, chatStream, currentModelId, currentModelKey, MODELS } from './aiengine.js';
import { Memory, detectTeach } from './aimemory.js';
import { Settings } from './store.js';

const $ = (id) => document.getElementById(id);

const BASE_PERSONA =
  'Du bist ein hilfreicher Assistent, der komplett offline auf dem Gerät läuft, '
  + 'eingebettet in eine App für technische Dokumentationen (Reklamationen, '
  + 'Arbeitskarten, Bemerkungen). Antworte auf Deutsch, knapp und sachlich. '
  + 'Hilf beim Formulieren, Zusammenfassen und Beantworten von Fragen.';

const HISTORY_KEY = 'techdoku_chat';
const HISTORY_MAX = 40; // gespeicherte Nachrichten (für den Kontext genutzt: die letzten ~12)

let history = [];     // [{ role:'user'|'assistant', content }]
let busy = false;     // gerade eine Antwort am Generieren?
let onToBemerkung = null; // Callback aus app.js (hängt Text an das Bemerkungsfeld an)

/* ---------- Speicher des Verlaufs (klein, daher localStorage) ---------- */
function loadHistory() { try { history = JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { history = []; } }
function saveHistory() { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_MAX))); } catch {} }

function esc(s) { return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* ---------- kleiner Toast (App.toast ist hier nicht erreichbar) ---------- */
let toastTimer;
function toast(msg) {
  const t = $('toast');
  if (!t) return;
  t.className = 'toast show'; t.textContent = msg; t.onclick = null;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ---------- Anzeige der Nachrichten ---------- */
function render() {
  const box = $('chatMessages');
  if (!box) return;
  if (!history.length) {
    box.innerHTML = '<div class="chat-empty">Stell eine Frage, lass dir beim Formulieren helfen – oder bring mir etwas bei: '
      + '<em>„merke dir: …“</em>. Alles bleibt auf deinem Gerät.</div>';
    return;
  }
  box.innerHTML = history.map((m, i) => bubble(m, i)).join('');
  box.scrollTop = box.scrollHeight;
}

function bubble(m, i) {
  const cls = m.role === 'user' ? 'msg-user' : 'msg-ai';
  const tools = (m.role === 'assistant' && m.content && i !== -1)
    ? `<div class="msg-tools"><button class="chat-chip" data-act="toBemerkung" data-i="${i}" type="button">⬇️ In Bemerkung</button></div>`
    : '';
  return `<div class="msg ${cls}"><div class="msg-text">${esc(m.content)}</div>${tools}</div>`;
}

// Zeigt den gerade streamenden Antworttext live an (ohne History zu verändern).
function renderStreaming(partial) {
  const box = $('chatMessages');
  if (!box) return;
  const live = `<div class="msg msg-ai"><div class="msg-text">${esc(partial)}<span class="chat-caret">▍</span></div></div>`;
  box.innerHTML = history.map((m, i) => bubble(m, i)).join('') + live;
  box.scrollTop = box.scrollHeight;
}

/* ---------- Modell-/Status-Anzeige ---------- */
function setStatus(text) {
  const el = $('chatStatus');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('hidden', !text);
}

function setBusy(on) {
  busy = on;
  const send = $('chatSend');
  const input = $('chatInput');
  if (send) send.disabled = on;
  if (input) input.disabled = on;
  document.querySelectorAll('#chatModal .chat-quick button').forEach((b) => { b.disabled = on; });
}

/* ---------- Gespräch mit dem Modell ---------- */
async function ask(messages, onToken) {
  const modelId = currentModelId();
  let firstToken = true;
  return chatStream(modelId, messages, (delta) => {
    if (firstToken) { setStatus(''); firstToken = false; }
    onToken(delta);
  }, (p) => {
    // Lade-Fortschritt beim ersten Start (großer Modell-Download)
    const pct = p && p.progress ? ` ${Math.round(p.progress * 100)}%` : '';
    setStatus((p && p.text ? p.text : 'Modell wird geladen …') + pct);
  });
}

async function buildMessages(userContent) {
  const ctx = await Memory.buildContext();
  const sys = { role: 'system', content: BASE_PERSONA + (ctx ? '\n\n' + ctx : '') };
  const recent = history.slice(-12).map((m) => ({ role: m.role, content: m.content }));
  return [sys, ...recent, { role: 'user', content: userContent }];
}

// Generische Antwort-Runde: hängt die Nutzer-Nachricht an, streamt die Antwort,
// speichert beides. `displayUser` = was im Verlauf als Nutzer-Bubble steht
// (bei Schnellaktionen ein lesbarer Hinweis statt des langen Prompts).
async function runTurn(promptContent, displayUser) {
  if (busy) return;
  if (!isSupported()) { toast('Dieses Gerät unterstützt das lokale KI-Modell nicht (WebGPU fehlt).'); return; }
  setBusy(true);

  history.push({ role: 'user', content: displUserText(displayUser, promptContent) });
  saveHistory();
  render();
  setStatus('Denkt nach …');

  let answer = '';
  try {
    const messages = await buildMessages(promptContent);
    answer = await ask(messages, (delta) => { answer += delta; renderStreaming(answer); });
  } catch (e) {
    setStatus('');
    setBusy(false);
    const why = (e && e.message === 'NO_WEBGPU')
      ? 'Dieses Gerät unterstützt das lokale KI-Modell nicht (WebGPU fehlt). Nutze ein aktuelles Chrome/Edge.'
      : 'Das Modell konnte nicht antworten. Beim ersten Start braucht der Download etwas Geduld und WLAN.';
    history.push({ role: 'assistant', content: why });
    saveHistory();
    render();
    return null;
  }

  setStatus('');
  history.push({ role: 'assistant', content: answer.trim() });
  saveHistory();
  render();
  setBusy(false);
  return answer.trim();
}

function displUserText(displayUser, prompt) {
  return displayUser || prompt;
}

/* ---------- Senden aus dem Eingabefeld ---------- */
async function send() {
  const input = $('chatInput');
  const text = (input.value || '').trim();
  if (!text || busy) return;
  input.value = '';

  // Lern-Befehl? Dann direkt ins Gedächtnis, ohne das Modell zu bemühen.
  const learn = detectTeach(text);
  if (learn) {
    await Memory.add({ text: learn, kind: 'fact' });
    history.push({ role: 'user', content: text });
    history.push({ role: 'assistant', content: '🧠 Gemerkt: „' + learn + '“. Ich berücksichtige das künftig.' });
    saveHistory();
    render();
    refreshMemoryList();
    return;
  }

  await runTurn(text, null);
}

/* ---------- Schnellaktionen auf dem Bemerkungsfeld ---------- */
function bemerkungText() {
  const ta = $('bemerkung');
  return ta ? (ta.value || '').trim() : '';
}

async function quick(kind) {
  const text = bemerkungText();
  if (!text) { toast('Bitte zuerst etwas in das Bemerkungsfeld schreiben.'); return; }
  const prompts = {
    summary: { label: '📝 Bemerkung kürzen', p: `Fasse die folgende technische Bemerkung in 2–3 knappen Sätzen zusammen. Gib nur die Zusammenfassung aus:\n\n"""${text}"""` },
    bullets: { label: '• In Stichpunkte', p: `Wandle die folgende Bemerkung in klare Stichpunkte um (eine Zeile je Punkt, beginnend mit "- "). Gib nur die Stichpunkte aus:\n\n"""${text}"""` },
    clearer: { label: '✨ Verständlicher schreiben', p: `Schreibe die folgende Bemerkung in sauberem, verständlichem Deutsch neu, ohne den Inhalt zu verändern. Gib nur den neuen Text aus:\n\n"""${text}"""` },
  };
  const sel = prompts[kind];
  if (!sel) return;
  await runTurn(sel.p, sel.label);
}

/* ---------- Gedächtnis-Ansicht ---------- */
async function refreshMemoryList() {
  const wrap = $('chatMemList');
  if (!wrap) return;
  const facts = await Memory.facts();
  if (!facts.length) {
    wrap.innerHTML = '<div class="chat-mem-empty">Noch nichts gemerkt. Schreib z. B. „merke dir: Kunde Müller bekommt PDFs ohne Fotos“.</div>';
    return;
  }
  wrap.innerHTML = facts.map((f) =>
    `<div class="chat-mem-item"><span>${esc(f.text)}</span>`
    + `<button class="chat-mem-del" data-id="${f.id}" type="button" title="Vergessen" aria-label="Vergessen">🗑</button></div>`
  ).join('');
}

function toggleMemory() {
  const panel = $('chatMemPanel');
  if (!panel) return;
  const open = panel.classList.toggle('open');
  if (open) refreshMemoryList();
}

/* ---------- Modell-Auswahl ---------- */
function fillModelSelect() {
  const sel = $('chatModel');
  if (!sel) return;
  sel.innerHTML = Object.entries(MODELS).map(([k, m]) => `<option value="${k}">${esc(m.label)}</option>`).join('');
  sel.value = currentModelKey();
}

/* ---------- Öffnen / Schließen ---------- */
function open() {
  $('chatModal').classList.add('open');
  document.body.style.overflow = 'hidden';
  if (!isSupported()) {
    setStatus('Hinweis: Dieses Gerät unterstützt das lokale KI-Modell nicht (WebGPU fehlt). Bitte ein aktuelles Chrome oder Edge verwenden.');
  }
  render();
  setTimeout(() => { const i = $('chatInput'); if (i && isSupported()) i.focus(); }, 50);
}
function close() {
  $('chatModal').classList.remove('open');
  document.body.style.overflow = '';
}

/* ---------- Init ---------- */
export function initChat(toBemerkung) {
  onToBemerkung = toBemerkung;
  const fab = $('fabChat');
  if (!fab) return;

  loadHistory();
  fillModelSelect();

  fab.onclick = open;
  $('chatClose').onclick = close;
  $('chatSend').onclick = send;
  $('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  $('chatClear').onclick = () => {
    if (!history.length || confirm('Gesprächsverlauf leeren? (Das Gedächtnis bleibt erhalten.)')) {
      history = []; saveHistory(); render();
    }
  };

  document.querySelectorAll('#chatModal .chat-quick button').forEach((b) => {
    b.onclick = () => quick(b.dataset.kind);
  });

  // Antwort-Bubbles: "In Bemerkung" übernehmen (gleiches Anhänge-Muster wie die Mitschrift)
  $('chatMessages').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="toBemerkung"]');
    if (!b) return;
    const m = history[+b.dataset.i];
    if (m && typeof onToBemerkung === 'function') { onToBemerkung(m.content); toast('In das Bemerkungsfeld übernommen.'); }
  });

  // Gedächtnis-Panel
  $('chatMemToggle').onclick = toggleMemory;
  $('chatMemClear').onclick = async () => {
    if (confirm('Das gesamte Gedächtnis löschen?')) { await Memory.clear(); refreshMemoryList(); toast('Gedächtnis geleert.'); }
  };
  $('chatMemList').addEventListener('click', async (e) => {
    const b = e.target.closest('.chat-mem-del');
    if (!b) return;
    await Memory.remove(b.dataset.id);
    refreshMemoryList();
  });

  // Modell-Wahl speichern (greift beim nächsten Laden)
  $('chatModel').onchange = (e) => { Settings.set({ aiModel: e.target.value }); toast('Modell gewählt – wird beim nächsten Start geladen.'); };

  render();
}
