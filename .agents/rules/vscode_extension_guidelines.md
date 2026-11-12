# VS Code Extension Entwicklungs-Richtlinien

1. **Lebenszyklus & Ressourcen-Management**:
   - Registriere alle Disposables (`registerCommand`, `registerWebviewViewProvider`, `registerTreeDataProvider`, `createStatusBarItem`, Event-Listener) konsequent in `context.subscriptions.push(...)`, damit sie beim Deaktivieren sauber freigegeben werden.
   - Halte `activate()` schlank und blockiere niemals den Extension Host durch synchrone I/O-Operationen.

2. **Manifest (`package.json`) & Aktivierung**:
   - Jeder über `vscode.commands.registerCommand` registrierte Befehl muss in `contributes.commands` deklariert sein.
   - Nutze implizite Activation Events (`"activationEvents": []` ab VS Code 1.74), sofern keine speziellen Start-Trigger wie `onStartupFinished` oder `workspaceContains` benötigt werden.

3. **Webview-Sicherheit & UI**:
   - Verwende in Webviews immer eine strikte Content Security Policy (`Content-Security-Policy`) mit kryptografischem Nonce für Skripte und schränke `localResourceRoots` auf die benötigten Verzeichnisse ein.
   - Nutze native VS Code CSS-Variablen (`var(--vscode-*)`), damit sich Webviews automatisch an helle, dunkle und High-Contrast-Themes anpassen.

4. **Testbarkeit & Packaging**:
   - Entkopple reine Geschäftslogik von der `vscode`-API, damit sie schnell und isoliert mit `vitest` getestet werden kann.
   - Pflege `.vscodeignore`, sodass Quellcode (`src/`), Tests (`tests/`) und Entwicklungsartefakte nicht im `.vsix`-Paket landen.
