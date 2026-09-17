---
name: graphify
description: Erzeugt einen Abhängigkeitsgraphen / eine Architektur-Übersicht dieser PWA (welche Datei lädt welche) und prüft dabei auf tote Links, verwaiste Module und Import-Zyklen. Verwenden, wenn nach einem Graphen, Diagramm, einer Architektur-Übersicht, Modulkarte oder Abhängigkeiten gefragt wird – Trigger: graphify, Graph, Diagramm, Architektur, Abhängigkeiten, Modulübersicht, dependency graph, "wer benutzt wen", "was hängt von X ab", Zyklus, verwaiste Datei.
---

# graphify

Baut aus dem echten Quellcode (nicht aus der README) einen Abhängigkeitsgraphen
des Projekts und meldet strukturelle Auffälligkeiten.

Erfasst werden:

| Quelle | Erkannte Kante |
|---|---|
| `index.html`, `kuru.html` | `<script src="…">` |
| JS-Module | `import … from '…'` |
| JS-Module | `import('…')` (dynamisch, gestrichelt dargestellt) |
| JS-Module | `navigator.serviceWorker.register('…')` (relativ zur Seite aufgelöst) |
| Tests / Config | `require('…')`, `importScripts('…')` |

## Ablauf

1. **Graph erzeugen** – immer zuerst das Skript laufen lassen, nie den Graphen
   aus dem Gedächtnis oder aus der README zusammenschreiben:

   ```bash
   node .claude/skills/graphify/graph.mjs [--format mermaid|dot|json|html] [--out DATEI] [--tests] [--vendor]
   ```

   - `--format mermaid` (Standard) – Mermaid-Flowchart auf stdout
   - `--format html --out graph.html` – fertige Seite mit gerendertem Graphen
     (Hell-/Dunkelmodus, Mermaid via CDN)
   - `--format json` – Rohdaten (`nodes`, `edges`, `orphans`, `missing`, `cycles`)
     für eigene Auswertungen
   - `--format dot` – Graphviz
   - `--tests` nimmt `tests/` mit auf, `--vendor` die lokal gehosteten Bibliotheken;
     ohne die Flags bleibt der Graph auf den App-Code beschränkt
   - Die Befund-Zeilen (`# nicht importiert / fehlende Ziele / Zyklen`) gehen auf
     **stderr**, der Graph auf stdout – `--out` trennt beides sauber.

2. **Befunde bewerten** – die Zusammenfassung am Ende ernst nehmen:
   - *fehlende Ziele* = ein Import zeigt auf eine Datei, die es nicht gibt → Bug,
     die App bricht beim Laden ab. Immer melden.
   - *nicht importiert* = Modul liegt im Repo, wird aber von niemandem geladen →
     entweder toter Code oder eine vergessene Verdrahtung. Nachsehen, ob es in
     `sw.js` im Precache-Array steht.
   - *Zyklen* = gegenseitige Imports. In ES-Modulen nicht automatisch ein Fehler,
     aber eine Quelle für `undefined` beim Initialisieren. Melden mit Pfad.

3. **Ergebnis liefern**
   - In der Antwort: den Mermaid-Block direkt zeigen, darunter die Befunde in
     zwei bis drei Sätzen. Kein Datei-Dump.
   - Wenn eine ansehbare Seite gewünscht ist (oder es um mehr als ~15 Knoten
     geht): `--format html --out` ins Scratchpad schreiben und die Datei mit
     `SendUserFile` (`display: "render"`) schicken.
   - Nur wenn ausdrücklich danach gefragt wird, den Graphen ins Repo committen
     (z. B. als Mermaid-Block in die README) – sonst bleibt er ein Zwischenergebnis.

## Bei gezielten Fragen

Für „was hängt von `store.js` ab?“ oder „was lädt `chat.js`?“ nicht den ganzen
Graphen zeigen, sondern `--format json` auswerten und nur die betroffenen Kanten
nennen. Beispiel:

```bash
node .claude/skills/graphify/graph.mjs --format json 2>/dev/null \
  | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
             console.log(d.edges.filter(e=>e.to.endsWith('store.js')).map(e=>e.from).join('\n'))"
```

## Grenzen

- Rein statisch: aus Variablen zusammengesetzte Pfade (`import(base + name)`)
  werden nicht erkannt.
- Die im Browser nachgeladenen CDN-Modelle (WebLLM) und die OCR-WASM-Dateien
  tauchen nur auf, wenn ihr Pfad wörtlich im Quelltext steht.
- Der Graph zeigt Ladeabhängigkeiten, nicht den Aufrufverlauf zur Laufzeit.
