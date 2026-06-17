# TechDoku · S. Fritz – Technische Dokumentation

Eine installierbare **Progressive Web App** zur schnellen Dokumentation von
**Reklamationen** und **Fertigungsaufträgen** direkt in der Werkstatt: Auftrag
erfassen, Fotos aufnehmen und markieren, als professionelles **PDF** erstellen
und per **WhatsApp / Teilen** weitergeben – **auch offline**.

🔗 **Live:** https://sergejfritz.github.io/meine-pwa/index.html

---

## Funktionen

- 📇 **Arbeitskarte scannen** – Foto der Arbeitskarte aufnehmen; die App liest
  per **Texterkennung (OCR, lokal/offline)** Kunde, AB-Nr., Zeichnungsnr.,
  Benennung, Stückzahl und Liefertermin aus und schlägt sie zur Übernahme vor.
  Der Nutzer prüft und bestätigt jedes Feld. Die Erkennung läuft komplett auf
  dem Gerät (Tesseract.js + deutsches Sprachmodell, selbst gehostet) – es werden
  keine Daten an einen Server gesendet.
- 📝 **Geführtes Formular** – Reklamation oder Fertigungsauftrag mit den jeweils
  passenden Zusatzfeldern (Version / Spanndruck).
- 📷 **Fotos** – bis zu 9 Bilder aus Kamera **oder** Galerie, automatisch
  komprimiert, sortierbar, mit Bildunterschriften.
- ✏️ **Foto-Markierung** – Pfeile, Kreise und Freihand direkt auf das Foto
  (z. B. um einen Mangel hervorzuheben).
- 📄 **Professionelles PDF** – scharfer, durchsuchbarer Text, saubere
  Datentabelle, nummerierte Fotos auf eigenen Seiten, Seitenzahlen und
  Erstell-Zeitstempel.
- 📤 **Teilen** – natives Teilen (WhatsApp, E-Mail …); Fallback auf Download.
- 📴 **Offline-fähig** – Service Worker cacht die App inkl. PDF-Bibliothek.
- 💬 **KI-Assistent (lokal)** – ein Chat-Assistent, dessen Sprachmodell
  **komplett im Browser** läuft (WebLLM/WebGPU) – **ohne API-Schlüssel und ohne
  Server**. Er beantwortet Fragen, hilft beim Formulieren und kann die Bemerkung
  **zusammenfassen / in Stichpunkte wandeln / verständlicher schreiben** und das
  Ergebnis ins Feld übernehmen. Über **„merke dir: …“** lernt er Fakten, die
  lokal (IndexedDB) gespeichert und in späteren Gesprächen genutzt werden.
  **Läuft auch auf dem Handy:** auf Mobilgeräten wird automatisch ein kleines
  Modell (~0,5 GB) gewählt, am PC ein stärkeres – manuell umschaltbar.
  Voraussetzung: WebGPU (Handy: aktuelles Chrome/Android bzw. Safari ab iOS 18;
  PC: Chrome/Edge). Der erste Modell-Download wird danach gecacht.
- ⚡ **Komfort** – Auto-Vervollständigung früherer Eingaben, Spracheingabe für
  Bemerkungen, Hell-/Dunkelmodus, Entwurf-Wiederherstellung gegen Datenverlust.

> **Hinweis:** Es wird **kein Archiv** abgelegter Dokumente gespeichert. Lokal
> gespeichert werden nur Komfortdaten (Einstellungen, Eingabe-Vorschläge und ein
> Sicherungs-Entwurf der *aktuellen* Eingabe). Die Weitergabe erfolgt per PDF.

---

## Projektstruktur

```
index.html          App-Shell (Formular, Scan, Foto-Editor, Vorschau)
css/styles.css      Design-System (Hell/Dunkel, responsiv, barrierearm)
js/app.js           Steuerung (Validierung, Fotos, Scan, Entwurf, Aktionen)
js/pdf.js           PDF-Erstellung (jsPDF, mehrseitig)
js/annotate.js      Foto-Markierung (Canvas)
js/scan.js          Arbeitskarten-Scan (OCR via Tesseract.js, mehrere Rotationen)
js/cardparse.js     Feld-Extraktion aus dem OCR-Text
js/store.js         localStorage: Einstellungen, Vorschläge, Entwurf
js/chat.js          KI-Assistent: Chat-Fenster, Schnellaktionen auf die Bemerkung
js/aiengine.js      Lokales Sprachmodell (WebLLM/WebGPU, on-demand vom CDN)
js/aimemory.js      Gedächtnis des Assistenten (IndexedDB, „merke dir …“)
sw.js               Service Worker (Offline-Cache; OCR-Dateien lazy gecacht)
manifest.json       PWA-Manifest (installierbar)
vendor/jspdf…       jsPDF (lokal gehostet, offline)
vendor/tesseract/   OCR-Engine + WASM (SIMD), lokal gehostet
vendor/tessdata/    Deutsches OCR-Sprachmodell (deu.traineddata.gz)
tests/              Playwright End-to-End-Tests + statischer Server
```

Kein Build-Schritt nötig – reines HTML/CSS/JS, direkt von GitHub Pages
auslieferbar.

---

## Lokal starten

```bash
npm install
npm start          # http://localhost:4173
```

## Tests

End-to-End-Tests mit [Playwright](https://playwright.dev) (Mobile + Desktop):

```bash
npm install
npx playwright install chromium
npm test
```

Die Tests laufen automatisch in der **CI** (GitHub Actions) bei jedem Push und
Pull Request – siehe `.github/workflows/ci.yml`.

---

## Deployment

`main` wird über **GitHub Pages** ausgeliefert. Nach dem Merge nach `main` ist
die neue Version in 1–2 Minuten live. Dank erhöhter Service-Worker-Version
erhalten alle Nutzer die Aktualisierung automatisch beim nächsten Öffnen.

## Browser-Unterstützung

Optimiert für aktuelle mobile Browser (Chrome/Android, Safari/iOS). Teilen und
Spracheingabe werden bei fehlender Unterstützung automatisch ausgeblendet bzw.
durch einen Download ersetzt.
