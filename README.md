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

### Wörterbücher

Wörter, deren Quelltext nicht im Arbeitsbereich liegt (Kern des Forth-Systems, eine große Anwendung, von der nur ein Teil geöffnet ist), kennt die Erweiterung aus Wörterbüchern. Wörterbuch-Wörter gelten als bekannt, erscheinen in der Autovervollständigung und zeigen im Hover Stack-Kommentar, Beschreibung und Fundstelle. Ist ein Wort auch im Arbeitsbereich definiert, hat diese Definition Vorrang.

Es gibt drei Quellen, die zusammengeführt werden:

- **Mitgeliefert:** `dictionaries/data-al/` enthält das Wörterbuch für Data-AL (Win32Forth-Kern und Anwendung): eine Wortliste mit rund 53.000 Namen und `data-al.dictionary.json` mit Stack-Kommentaren und Beschreibungen.
- **forth-lsp:** Liegt im Arbeitsbereich eine `.forth-lsp.toml`, werden deren `word_files` und `[[builtin.words]]` übernommen.
- **Eigene Dateien** über `forth-sight.dictionary.files`: Wortlisten (Namen durch Leerraum getrennt, z. B. die Ausgabe von `WORDS`) oder `.json`-Dateien im folgenden Format:

```json
{
  "words": [
    { "word": "ROTDROP", "stack": "( N0 N1 N2 -- N1 N2 )", "description": "Statt: ROT DROP", "source": "utils/PD.F:3604" }
  ]
}
```

#### Wörterbuch aus einer Codebasis erweitern

```bash
npm run dictionary -- C:\Pfad\zu\data-al
```

Das Skript liest alle Forth-Dateien des Ordners (`.f`, `.fs`, `.fth`, `.4th`, `.seq` und `xcall.h`; UTF-8 oder ISO-8859-1), sammelt die definierten Wörter mit Stack-Kommentar, Kommentar und Fundstelle und trägt sie in `dictionaries/data-al/data-al.dictionary.json` ein. Vorhandene Einträge bleiben unverändert und erhalten nur fehlende Angaben; neue Wörter kommen hinzu. Von Hand korrigierte Einträge überleben also jeden weiteren Lauf.

| Option | Bedeutung |
| --- | --- |
| `--out <Datei>` | anderes Wörterbuch erweitern |
| `--exclude <a,b,c>` | Ordnernamen überspringen (Standard: `node_modules,.git,obsolete,Java,Z-DATA,target`) |
| `--primitives <Datei>` | zusätzlich die Tabelle aus `tutorial/Primitives.md` einlesen |
| `--dry-run` | nur zählen, nichts schreiben |

### Win32Forth und Data-AL

Neben Forth-2012 und gforth versteht der Parser die Schreibweisen von Win32Forth und Data-AL:

- Kommentare `(( ... ))` und `/* ... */`, Zeichenketten mit `S' ... '`, Wörter mit führendem Anführungszeichen (`">ASCIIZ`, `"CASE`).
- Benannte Parameter `{ a b \ lokal -- ergebnis }`; die Deklaration dient zugleich als Stack-Kommentar.
- Kontrollstrukturen `?IF`, `UNLESS`, `?UNLESS`, `0=IF`, `OFWITHIN`, `OF| ... |OF`, `END-CASE`, `"CASE ... "ENDCASE`, `DO| ... |DO`, Codeblöcke `{{ ... }}`.
- Definitionen mit `CODE ... C;`, `IS:`, `SEL:`, `TEST: ... ;TEST`, `;IS`, `MAKE ... ;AND`, namenlose Definitionen mit `::` und `:F:`.
- Definierende Wörter für Klassen (`SUBCLASS:`, `-METHOD`, `+METHOD`), DLL-Aufrufe (`PROC_STDCALL`, `PROC_CDECL`, `CALLBACK`), Datenbanktabellen (`DBSINGLE`, `DBBYTES`, `IS-RECORD`, `DB-FIELD`, ...) sowie `REORDERER`, `SIZED`, `ENUM` und `#define`.
- Bedingte Übersetzung mit `[IFDEBUG]`, `#IFDEF ... #ENDIF`, `\+` und `\-`; Laden mit `HI` und `FLOAD`.

Weitere definierende Wörter erkennt der Index selbst, sobald ihre Definition (mit `CREATE`, `:` usw.) im Arbeitsbereich liegt. Dateien, die kein gültiges UTF-8 sind, werden als ISO-8859-1 gelesen.

Namen werden ohne Rücksicht auf Groß- und Kleinschreibung nachgeschlagen. Unterscheidet der Code beide Schreibweisen (`az-pat` und `AZ-PAT`), zeigt „Gehe zu Definition“ deshalb beide Definitionen; das Wörterbuch führt die Schreibweisen getrennt.

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
| `forth-sight.dictionary.bundled` | `["data-al"]` | mitgelieferte Wörterbücher; `[]` schaltet sie ab |
| `forth-sight.dictionary.files` | `[]` | eigene Wortlisten und Wörterbuchdateien, relativ zum Arbeitsbereich oder absolut |
| `forth-sight.dictionary.useForthLspConfig` | `true` | Wörter aus `.forth-lsp.toml` übernehmen |
| `forth-sight.index.exclude` | `["**/node_modules/**"]` | Glob-Muster für Dateien, die nicht indiziert werden |
| `forth-sight.gforth.path` | `gforth` | Pfad zum gforth-Programm |
| `forth-sight.gforth.arguments` | `[]` | zusätzliche Argumente für gforth |

## Aufbau

- `src/core/` – Tokenizer, Parser, Index, Stack-Analyse und Wortliste; ohne Abhängigkeit zur VS-Code-API und mit Vitest getestet.
- `src/features/` – Anbindung an VS Code (Provider, Diagnosen, Wörterbücher, gforth-Befehle).
- `src/tools/` – Kommandozeilenwerkzeug zum Erweitern eines Wörterbuchs aus einer Codebasis.
- `dictionaries/` – mitgelieferte Wörterbücher.
- `src/indexService.ts` – hält den Index mit Dateien und ungespeicherten Editorinhalten aktuell.
- `syntaxes/`, `snippets/`, `language-configuration.json` – deklarative Sprachunterstützung.

## Installation für Endnutzer

Um die Erweiterung in VSCode zu installieren, einfach das Artefakt der [v.1.0.1](https://github.com/TGBox/forth-sight/releases/download/v1.0.1/forth-sight-1.0.1.vsix) herunterladen, den Ordner mit der Datei in VSCode öffnen und per Rechtsklick auf "Install Extension VSIX" klicken. Danach ist das Syntaxhighlighting direkt verfügbar.

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
