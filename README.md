# forth-sight

Forth-Unterstützung für VS Code: Syntax-Highlighting, Navigation, Dokumentation, Prüfungen und gforth-Anbindung, damit sich Forth-Code leichter lesen, verstehen und bearbeiten lässt.

Unterstützt werden Forth-2012 (ANS) und die gängigen gforth-Erweiterungen. Dateiendungen: `.fs`, `.fth`, `.4th`, `.f`, `.seq`.

## Funktionen

### Lesen und Verstehen

- **Syntax-Highlighting** – zusätzlich werden selbst definierte Wörter nach ihrer Art eingefärbt (Colon-Definition, Variable, Konstante, definierendes Wort, lokale Variable).
- **Hover** – für eigene Wörter: Stack-Kommentar, Dokumentationskommentar, Quelltext und Anzahl der Verwendungen. Für eingebaute Wörter: Stack-Effekt und Kurzbeschreibung.
- **Gliederung und Breadcrumbs** – alle Definitionen einer Datei, gruppiert nach Abschnittsüberschriften der Form

  ```forth
  \ ---------------------------------------------
  \  Titel des Abschnitts
  \ ---------------------------------------------
  ```

### Navigation

- **Gehe zu Definition** (`F12`, `Strg+Klick`) und **Alle Verweise suchen** (`Umschalt+F12`) über alle Forth-Dateien des Arbeitsbereichs, ohne Treffer in Kommentaren und Zeichenketten.
- **Wortsuche im Arbeitsbereich** (`Strg+T`) und in der Datei (`Strg+Umschalt+O`).
- **Aufrufhierarchie** (`Umschalt+Alt+H`) – wer ruft ein Wort auf, und welche Wörter ruft es selbst auf.
- **Umbenennen** (`F2`) – benennt ein selbst definiertes Wort oder eine lokale Variable an allen Stellen um.

### Bearbeiten

- **Autovervollständigung** für eigene Wörter, lokale Variablen und eingebaute Wörter, jeweils mit Stack-Effekt.
- **Snippets** für Colon-Definitionen, Kontrollstrukturen, `create ... does>` und Abschnittsüberschriften.

### Prüfungen

Probleme erscheinen im Editor und in der Problemübersicht:

| Prüfung | Beispiel |
| --- | --- |
| Kontrollstrukturen | `if` ohne `then`, `repeat` ohne `begin`, Definition ohne `;` |
| Unbekannte Wörter | Tippfehler; Wörter, die nirgends im Arbeitsbereich definiert sind |
| Neudefinitionen | ein Wort wird in derselben Datei erneut definiert oder überdeckt ein eingebautes Wort |
| Stack-Effekt | der Stack-Kommentar `( a b -- c )` passt nicht zum Rumpf der Definition |

Die Stack-Prüfung meldet nur, was sie sicher bestimmen kann: Enthält eine Definition ein Wort ohne bekannten Stack-Effekt (kein Stack-Kommentar, `execute`, variable Effekte wie `( x -- y true | false )`), bleibt sie für diese Definition still. Sie setzt Stack-Kommentare voraus, die nur die Stackwerte aufzählen. Für unbekannte Wörter gibt es die Schnellkorrektur „als bekanntes Wort eintragen“.

### gforth

- **Datei in gforth laden** (Schaltfläche ▷ oben rechts im Editor) – speichert die Datei und lädt sie in ein frisch gestartetes gforth im integrierten Terminal.
- **Auswahl oder Zeile an gforth senden** (`Strg+Enter`) – ohne Auswahl wird die aktuelle Zeile gesendet und der Cursor rückt eine Zeile weiter.
- **gforth-REPL (neu) starten**.

## Einstellungen

| Einstellung | Standard | Bedeutung |
| --- | --- | --- |
| `forth-sight.diagnostics.enabled` | `true` | Prüfungen insgesamt ein- oder ausschalten |
| `forth-sight.diagnostics.unknownWords` | `true` | unbekannte Wörter melden |
| `forth-sight.diagnostics.redefinitions` | `true` | Neudefinitionen melden |
| `forth-sight.diagnostics.stackEffects` | `true` | Stack-Kommentare prüfen |
| `forth-sight.diagnostics.knownWords` | `[]` | zusätzliche Wörter, die als bekannt gelten |
| `forth-sight.gforth.path` | `gforth` | Pfad zum gforth-Programm |
| `forth-sight.gforth.arguments` | `[]` | zusätzliche Argumente für gforth |

## Aufbau

- `src/core/` – Tokenizer, Parser, Index, Stack-Analyse und Wortliste; ohne Abhängigkeit zur VS-Code-API und mit Vitest getestet.
- `src/features/` – Anbindung an VS Code (Provider, Diagnosen, gforth-Befehle).
- `src/indexService.ts` – hält den Index mit Dateien und ungespeicherten Editorinhalten aktuell.
- `syntaxes/`, `snippets/`, `language-configuration.json` – deklarative Sprachunterstützung.

## Entwicklung

```bash
npm install        # Abhängigkeiten installieren
npm run compile    # einmalig kompilieren (tsc -> out/)
npm run watch      # Watch-Modus
npm run typecheck  # TypeScript-Typprüfung
npm test           # Unit-Tests mit Vitest
npm run package    # installierbares .vsix-Paket erstellen
```

In VS Code startet **`F5`** ein Extension-Development-Host-Fenster mit geladener Erweiterung.
