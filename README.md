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
  Verwendet **Qwen 2.5** (bestes kostenloses, mehrsprachiges On-Device-Modell mit
  guter Deutsch-Fähigkeit). **Läuft auch auf dem Handy:** dort wird automatisch
  die passende Größe gewählt (1.5B, ~1 GB; ältere Handys 0.5B), am PC das
  stärkere 3B – manuell umschaltbar. Voraussetzung: WebGPU (Handy: aktuelles
  Chrome/Android bzw. Safari ab iOS 18; PC: Chrome/Edge). Der erste Modell-
  Download wird danach gecacht.
- ⚡ **Komfort** – Auto-Vervollständigung früherer Eingaben, Spracheingabe für
  Bemerkungen, Hell-/Dunkelmodus, Entwurf-Wiederherstellung gegen Datenverlust.

> **Hinweis:** Es wird **kein Archiv** abgelegter Dokumente gespeichert. Lokal
> gespeichert werden nur Komfortdaten (Einstellungen, Eingabe-Vorschläge und ein
> Sicherungs-Entwurf der *aktuellen* Eingabe). Die Weitergabe erfolgt per PDF.

---

## 🍀 Lotto-Simulator (privat)

Eigene kleine App unter **`/lotto/`** (🔗 https://sergejfritz.github.io/meine-pwa/lotto/),
nicht mit TechDoku verlinkt und separat installierbar (eigenes Manifest + Service Worker).

- **Mein Tipp** – 6 Zahlen eintippen oder im Schein antippen (+ optional
  Superzahl): sofort sichtbar, **ob und in welchem Jahr** man mit ihnen gewonnen
  hätte – geprüft gegen **alle Ziehungen seit 1955** (Jahres-Übersicht,
  größte Treffer, Gewinnklassen, Bilanz). Bei den Treffern stehen die **echten
  damaligen Auszahlungen** (inkl. Zusatzzahl-Klassen und DM-Beträgen).
- **Chancen** – ehrlicher Muster-Check, live über alle Ziehungen gerechnet:
  Gleichverteilung der Zahlen und Superzahlen (Chi²), Abhängigkeit zwischen
  Ziehungen, Fortsetzung „heißer“ Zahlen und eine Rückrechnung von Strategien
  (heiß/kalt/überfällig) gegen den Zufall – Ergebnis: kein Muster. Dazu die
  exakten Gewinnchancen je Klasse und der **kluge Tipp**: gleiche Chance, aber
  ohne Geburtstags-/Muster-Zahlen, die laut echten Quoten seit 2020 rund
  20–30 % weniger pro Gewinn bringen.
- **🧮 Fritz-Formel** – eigene Rechnung für den *Wert* eines Tipps (nicht die
  Trefferchance): Aus den echten Gewinnerzahlen von 631 Ziehungen (seit 09/2020)
  lernt eine Ridge-Regression die Beliebtheit β jeder Zahl (Mitgewinner-Prognose
  mit kreuzvalidiertem R² = 0,66). Pro Gewinnklasse werden die Mitgewinner als
  Poisson-Verteilung modelliert:
  `W(T) = Σₖ pₖ · Topfₖ · (1 − e^−μₖ)/μₖ`, `μₖ = Gₖ · e^(κₖ · B(T) · (rₖ/6 − (6−rₖ)/43))`,
  `B(T) = Σ βᵢ`. Ein Ø-Tipp bringt 62 ct pro 1,20 € (≈ offizielle 50 %
  Ausschüttung), beliebte Zahlen −25 %, unbeliebte bis +33 %. Auch die
  **Superzahl** ist unterschiedlich beliebt (7: +26 %, 0: −19 % Mitgewinner in
  den „+ SZ“-Klassen) und geht als Faktor σ ein. Der **Fritz-Tipp** wählt
  zufällig unter den besten 5 % ohne Muster plus eine unbeliebte Superzahl. Neu trainieren:
  `node scripts/lotto-formel.mjs` (schreibt `lotto/formel.json`).
- **Archiv** – alle Ziehungen nach Jahr, letzte Ziehung mit echten Quoten,
  nächste Ziehung + Annahmeschluss.
- **Statistik** – Häufigkeit jeder Zahl, am längsten nicht gezogen, Superzahlen.
- **Simulator** – Ziehung simulieren oder „spielen bis zum Gewinn“.
- **Live-Daten** – neue Ziehungen kommen automatisch über die öffentliche
  Schnittstelle von **WestLotto** (beim Öffnen und, solange die Seite offen ist,
  kurz nach jeder Ziehung); verpasste Ziehungen werden nachgeholt.
  Ersatzquelle: [LottoNumberArchive](https://github.com/JohannesFriedrich/LottoNumberArchive).
  Die mitgelieferte Grunddatei `lotto/ziehungen.txt` lässt sich mit
  `node scripts/lotto-daten.mjs` auffrischen (nötig ist das nicht).

### 📱 Android-App (APK)

Download aufs Handy: **https://sergejfritz.github.io/meine-pwa/downloads/lotto.apk**
(im Handy-Browser öffnen → installieren; einmalig „Installation aus dieser Quelle
erlauben“ bestätigen). Auf der Lotto-Seite erscheint im Android-Browser dafür
auch ein Knopf „📲 Als Android-App installieren“.

- Kleine native App (`android/`, Java, ohne Fremdbibliotheken), die genau die
  Web-App aus `lotto/` als App-Inhalt mitbringt – **alles offline**, neue
  Ziehungen kommen live dazu.
- **Benachrichtigung nach jeder Ziehung** (Mi/Sa, Archiv → „🔔 Einschalten“):
  die neuen Zahlen und ob der aktuelle oder ein gemerkter Tipp gewonnen hat –
  mit echtem Gewinnbetrag, sobald die Quoten feststehen.
- Systemleisten passend zu Hell/Dunkel, Zurück-Taste springt erst zu „Mein Tipp“.
- **Update-Hinweis:** Die App prüft höchstens alle 6 Stunden
  `downloads/version.json` und bietet eine neuere APK zum Herunterladen an.
- Neu bauen: `LOTTO_KEY_PASSWORD=… scripts/lotto-apk.sh` (legt
  `downloads/lotto.apk` und `downloads/version.json` ab). Der Signatur-Schlüssel `android/lotto-app.p12` ist
  passwortgeschützt; das Passwort steht bewusst **nicht** im Repo. Nur mit
  demselben Schlüssel lässt sich eine neue Version über die alte installieren
  (gespeicherte Tipps bleiben erhalten).
- Die CI (`.github/workflows/lotto-apk.yml`) baut die APK bei jeder Änderung mit;
  ist das Repo-Secret `LOTTO_KEY_PASSWORD` gesetzt, signiert.

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
lotto/              Lotto-Simulator (eigene Mini-App, siehe oben)
android/            Android-App (APK) für den Lotto-Simulator
downloads/          fertige lotto.apk zum Herunterladen
scripts/            Hilfsskripte (Ziehungsdatei erneuern, APK bauen)
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
