// Service Worker – macht die App offline-fähig (Werkstatt ohne WLAN)
const CACHE = 'techdoku-v2026-24';

// App-Shell – wird beim ersten Besuch gecacht.
// Die OCR-Dateien (vendor/tesseract, vendor/tessdata) werden NICHT hier
// vorgeladen, sondern beim ersten Scan automatisch über den fetch-Handler
// nachgecacht. So bleibt die Installation klein und auch ohne Netz robust.
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/pdf.js',
  './js/annotate.js',
  './js/store.js',
  './js/scan.js',
  './js/cardparse.js',
  './js/zones.js',
  './js/zonecal.js',
  './js/archive.js',
  './js/signature.js',
  './js/transcribe.js',
  './vendor/jspdf.umd.min.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first für eigene Assets, mit Netzwerk-Fallback (+ Nachcachen neuer Dateien)
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
