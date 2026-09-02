# Nahfunk – Kollegen in der Halle anpingen

Android-App für den Nahbereich: **kurze Pings** („Kaffee?“, „Mittag“, „Brauche Hilfe“)
per **Bluetooth-Funk** an alle Handys in Reichweite, **ganze Sätze** im **eigenen
WLAN-Netz**, dazu ein **Kompass-Radar**, das zeigt, wer wie weit weg ist – alles
ohne Server, ohne Internet, ohne Konto.

## Installieren

1. Auf dem Handy die neueste `nahfunk.apk` laden:
   **Releases → „Nahfunk – aktuelle Version“** (aus `main`) oder
   **„Nahfunk – Testversion“** (aus dem aktuellen Pull Request).
2. Datei öffnen, Installation erlauben („Aus dieser Quelle installieren“).
3. App starten, Namen eintragen, **Berechtigungen erteilen**. Danach läuft alles
   von selbst; der **Selbsttest** unten auf dem Bildschirm zeigt, was noch fehlt.

Updates werden einfach über die alte Version installiert. Alle CI-Builds sind mit
demselben Entwicklungsschlüssel signiert, daher bleibt die Signatur gleich.

## Bedienung

| Bereich | Was passiert |
|---|---|
| **Verbindungsweg** | *Beides*, *Nur WLAN* oder *Nur Funk*. Darunter steht, was gerade läuft und wie viele erreichbar sind. |
| **Im Hintergrund weiterlaufen** | Vordergrund-Dienst mit Statusleisten-Symbol, damit Pings auch bei ausgeschaltetem Bildschirm ankommen. |
| **📣 Alle anpingen** | Zwei Minuten lang auf allen Wegen rufen, jeden bekannten Teilnehmer einzeln anstupsen und zusätzlich klassisch nach Bluetooth-Geräten suchen. |
| **Ping senden** | Sechs Kacheln: Kaffee, Eine rauchen, Hallo, Mittag, Kurz helfen?, Brauche Hilfe. Gehen per Funk **und** Netz raus. |
| **Nachricht ins Netz** | Ganze Sätze an alle im selben WLAN. |
| **In Reichweite** | Kompass-Radar (Ringe logarithmisch), Maßstab *Auto/5/15/50/150 m*, *Blick oben* (Radar dreht mit der Blickrichtung) oder *Norden oben*, Umgebung *Frei/Halle/Büro* (Dämpfung 2,0/2,5/3,0), *Eichen* (1 m Abstand = Bezugswert). |
| **Filter** | *Nahfunk* (nur Teilnehmer), *Handys* (auch fremde Handys), *Alle* (auch Kopfhörer, Thermometer, Fernseher, WLAN-Sender). |
| **Gerät antippen** | Werte, Ping direkt an dieses Gerät, Satz an dieses Gerät, **Richtung messen** (einmal langsam im Kreis drehen), **Auf 1 m eichen**, Umbenennen. |
| **Verlauf** | Was rein- und rausging, mit Schnellantworten 👍 OK · 🏃 Komme · ⏳ Später. |
| **Selbsttest** | Bluetooth, Berechtigungen, Standortdienste, Akku-Optimierung, Senden/Empfangen – jeweils mit Knopf zum Beheben. |

Eingehende Pings vibrieren; ist die App nicht offen, kommt eine Benachrichtigung
mit Schnellantworten.

## Wie es funktioniert

- **Funk (Bluetooth LE):** Jedes Handy sendet eine kleine Aussendung mit
  Geräte-ID, Name und – für ~25 s – dem gerade gesendeten Ping. Empfänger dedupen
  über ID + Folgenummer. Herstellerkennung `0xFFFF` (vom Bluetooth-SIG für
  Tests reserviert), Aufbau in `core/Protocol.kt`. Bei ausgeschaltetem Bildschirm
  wird gefiltert gescannt (Android liefert sonst nichts), Nahfunk-Pings kommen
  weiterhin an.
- **Modelle, die nicht selbst senden können:** Sie hören trotzdem alles mit. Mit
  *Klassisch sichtbar* (Systemdialog, 5 Minuten) werden sie in der klassischen
  Bluetooth-Suche der anderen sichtbar; *Alle anpingen* startet diese Suche.
- **WLAN-Netz:** UDP auf Port `47474`, Subnetz-Broadcast + Multicast
  `239.255.47.47`, JSON-Nachrichten (Präsenz alle 10 s, Pings, Texte). Unicast
  zusätzlich an jeden bekannten Teilnehmer. Gast-WLANs mit Client-Isolation
  blockieren das – dann bleibt Funk.
- **WLAN-Aushänge:** Die Beacons der Router werden mit Signalstärke gelistet
  (Filter *Alle*), nützlich zum Ausprobieren, wenn niemand sonst die App hat.
- **Entfernung:** Log-Distanz-Pfadverlust `d = 10^((P0 − RSSI)/(10·n))`, RSSI
  exponentiell geglättet. `P0` = Signalstärke in 1 m (Standard −59 dBm Funk,
  −40 dBm WLAN-Sender, per *Eichen* anpassbar), `n` = Dämpfung der Umgebung.
- **Richtung:** Beim Drehen dämpft der Körper das Signal; das Maximum über
  24 Sektoren zeigt zum Gerät. Kompass aus dem Rotationsvektor, geografisch Nord,
  wenn ein letzter Standort bekannt ist.

Es werden keine Daten ins Internet gesendet. Gespeichert werden lokal nur Name,
Einstellungen, eigene Gerätenamen und der Verlauf.

## Berechtigungen

| Berechtigung | Warum |
|---|---|
| Bluetooth suchen / senden / verbinden | Funk-Aussendung und Empfang, Bluetooth einschalten |
| Standort | Android gibt Bluetooth- und WLAN-Scan-Ergebnisse nur mit Standortrecht heraus; ein GPS-Fix wird nicht angefordert |
| WLAN-Geräte in der Nähe | WLAN-Aushänge (Android 13+) |
| Benachrichtigungen | Pings im Hintergrund |
| Akku-Optimierung ausnehmen (optional) | sonst schläft der Dienst auf manchen Handys ein |

## Bauen

```bash
cd nahfunk
./gradlew :app:testDebugUnitTest      # Unit-Tests (Protokoll, Distanz, Klassifizierung)
./gradlew :app:assembleRelease        # signierte APK: app/build/outputs/apk/release/app-release.apk
```

Braucht JDK 17+ und ein Android-SDK (`ANDROID_HOME`, Plattform 35, Build-Tools 35).
Kotlin 2.0, Jetpack Compose, minSdk 26 (Android 8), targetSdk 35.

**Signatur:** `keystore/nahfunk-dev.keystore` ist ein Entwicklungsschlüssel und
liegt bewusst im Repo, damit jede CI-APK dieselbe Signatur hat. Für eine echte
Veröffentlichung eigenen Schlüssel per Umgebungsvariablen setzen:
`NAHFUNK_KEYSTORE`, `NAHFUNK_KEYSTORE_PASSWORD`, `NAHFUNK_KEY_ALIAS`,
`NAHFUNK_KEY_PASSWORD`.

Die CI (`.github/workflows/nahfunk-android.yml`) baut bei jedem Pull Request und
Push nach `main`, hängt die APK als Artefakt an und aktualisiert die Releases
`nahfunk-test` bzw. `nahfunk-latest`.

## Struktur

```
app/src/main/java/de/sfritz/nahfunk/
  core/      Modell, Protokoll (Funk-Payload, AD-Parser, Netz-JSON), Distanz, Klassifizierung, Einstellungen
  data/      Einstellungen (SharedPreferences als StateFlow)
  radio/     BleAdvertiser, BleScanner, ClassicBt, WifiScanner, LanChannel, HeadingSensor
  engine/    Engine (Zustand, Senden, Empfang, Richtung, Eichen), Permissions, SelfTest
  service/   Vordergrund-Dienst, Benachrichtigungen, Schnellantworten
  ui/        Compose-Oberfläche: Hauptbildschirm, Radar, Geräte-Sheet, Selbsttest
app/src/test/  JUnit-Tests für core/
```
