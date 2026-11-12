# forth-sight

A simple syntax highlighter to make Forth code easier to read.

## Funktionen

- **Befehl (`forth-sight.helloWorld`):** Zeigt eine konfigurierbare Begrüßungsnachricht an (`Strg+Umschalt+P` -> `forth-sight: Hallo Welt anzeigen`).
- **Statusleiste:** Direkter Schnellzugriff über den Eintrag in der rechten VS Code Statusleiste.

## Entwicklung starten

1. Abhängigkeiten installieren:

   ```bash
   npm install
   ```

2. Projekt in VS Code öffnen und **`F5`** drücken:
   - Dies kompiliert die Erweiterung automatisch (`npm: compile`) und startet ein neues **Extension Development Host**-Fenster mit geladener Extension.

## Nützliche Befehle

```bash
# Einmalig kompilieren (tsc -> out/extension.js)
npm run compile

# Watch-Modus für kontinuierliche Entwicklung
npm run watch

# TypeScript-Typprüfung
npm run typecheck

# Unit-Tests mit Vitest ausführen
npm test

# Installierbares .vsix-Paket erstellen
npm run package
```

## Einstellungen

Diese Erweiterung stellt folgende VS Code Einstellung bereit:

- `forth-sight.greeting`: Benutzerdefinierter Begrüßungstext für den Befehl.
