// Lokaler KI-Assistent – das Sprachmodell läuft KOMPLETT im Browser (WebLLM,
// WebGPU). Kein API-Schlüssel, kein Server: alles bleibt auf dem Gerät.
//
// Gleiche Idee wie der KI-Modus der Live-Mitschrift (Whisper über
// transformers.js, siehe js/transcribe.js): das Modell wird beim ersten Start
// einmalig vom CDN geladen und danach vom Browser gecacht. Folgestarts sind
// schnell und funktionieren auch offline.

import { Settings } from './store.js';

// Auswahl an MLC/WebLLM-Modellen. Default: gute Deutsch-Fähigkeit; Sparoption
// für schwächere Geräte. Umschaltbar über die Einstellungen (Settings.aiModel).
export const MODELS = {
  standard: { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Standard – Llama 3.2 3B (~1,7 GB)' },
  klein: { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Klein & schnell – Qwen2.5 1.5B (~1 GB)' },
};

const WEBLLM_LIB = 'https://esm.run/@mlc-ai/web-llm';

let engine = null;        // geladene WebLLM-Engine
let loadedId = null;      // welches Modell ist aktuell geladen
let loadingPromise = null; // Promise während des Ladens (verhindert Doppel-Laden)

// Läuft hier überhaupt ein KI-Modell? WebLLM braucht WebGPU.
export function isSupported() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

// Test-Haken: Ist window.__AI_MOCK gesetzt, wird das echte Modell NICHT geladen
// (headless/CI hat kein WebGPU). Die App-Logik bleibt damit testbar.
function mock() {
  return (typeof window !== 'undefined') ? window.__AI_MOCK : null;
}

// Aktuell gewähltes Modell (aus den Einstellungen), mit sinnvollem Default.
export function currentModelKey() {
  const k = Settings.get().aiModel;
  return MODELS[k] ? k : 'standard';
}
export function currentModelId() {
  return MODELS[currentModelKey()].id;
}

// Lädt das Modell on demand. onProgress({ text, progress }) für die Anzeige.
export async function ensureEngine(modelId, onProgress) {
  if (mock()) return mock();
  if (!isSupported()) throw new Error('NO_WEBGPU');
  if (engine && loadedId === modelId) return engine;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const webllm = await import(/* @vite-ignore */ WEBLLM_LIB);
    const eng = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (r) => {
        if (onProgress) onProgress({ text: r.text || '', progress: r.progress || 0 });
      },
    });
    engine = eng;
    loadedId = modelId;
    return eng;
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

// Streamt eine Antwort. messages = [{ role, content }], onToken(deltaText) für
// die Live-Ausgabe. Gibt den vollständigen Antworttext zurück.
export async function chatStream(modelId, messages, onToken, onProgress) {
  const m = mock();
  if (m) return m.chatStream(messages, onToken);

  const eng = await ensureEngine(modelId, onProgress);
  const stream = await eng.chat.completions.create({
    messages,
    stream: true,
    temperature: 0.6,
  });
  let full = '';
  for await (const chunk of stream) {
    const delta = (chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) || '';
    if (delta) {
      full += delta;
      if (onToken) onToken(delta);
    }
  }
  return full;
}
