import * as vscode from 'vscode';

interface ForthWordInfo {
  name: string;
  kind: string;        // z.B. ':', 'variable', 'constant'
  stackComment: string; // z.B. '( n1 n2 -- sum )'
  docLine: string;      // Kommentarzeile darüber oder dahinter
  preview: string;      // Die ersten Zeilen der Definition
  location: vscode.Location;
}

// Case-insensitiver Index: Wortname (lowercase) -> Liste von Fundstellen
const wordIndex = new Map<string, ForthWordInfo[]>();

const DEFINITION_REGEX = /(?:^|\s)(:|code|variable|2variable|constant|2constant|value|create|defer|user|field:)\s+(\S+)(?:\s+(\(\s*.*?\s*\)))?(?:\s*\\(.*))?/gi;

export async function activate(context: vscode.ExtensionContext) {
  // 1. Initialen Index aufbauen
  await rebuildIndex();

  // 2. Bei Dateiänderungen automatisch aktualisieren
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{fs,fth,4th,f,seq}');
  watcher.onDidChange(uri => indexFile(uri));
  watcher.onDidCreate(uri => indexFile(uri));
  watcher.onDidDelete(() => rebuildIndex());
  context.subscriptions.push(watcher);

  // 3. Hover-Provider registrieren
  const hoverProvider = vscode.languages.registerHoverProvider('forth', {
    provideHover(document, position) {
      const word = getForthWordAtPosition(document, position);
      if (!word) return null;

      const entries = wordIndex.get(word.toLowerCase());
      if (!entries || entries.length === 0) return null;

      const md = new vscode.MarkdownString();
      for (const entry of entries) {
        const fileName = vscode.workspace.asRelativePath(entry.location.uri);
        const lineNum = entry.location.range.start.line + 1;

        // Header mit Wortname und Stack-Kommentar
        const commentPart = entry.stackComment ? ` ${entry.stackComment}` : '';
        md.appendMarkdown(`**\`${entry.kind} ${entry.name}\`**\`${commentPart}\` — *${fileName}:${lineNum}*\n\n`);

        if (entry.docLine) {
          md.appendMarkdown(`*${entry.docLine.trim()}*\n\n`);
        }

        // Quellcode-Vorschau der Definition
        md.appendCodeblock(entry.preview, 'forth');
        md.appendMarkdown('---\n');
      }
      return new vscode.Hover(md);
    }
  });

  // 4. Definition-Provider (F12 / Strg+Klick) registrieren
  const definitionProvider = vscode.languages.registerDefinitionProvider('forth', {
    provideDefinition(document, position) {
      const word = getForthWordAtPosition(document, position);
      if (!word) return null;

      const entries = wordIndex.get(word.toLowerCase());
      if (!entries) return null;

      return entries.map(e => e.location);
    }
  });

  context.subscriptions.push(hoverProvider, definitionProvider);
}

/**
 * Holt das exakte Forth-Token unter dem Cursor (getrennt nur durch Whitespace).
 */
function getForthWordAtPosition(document: vscode.TextDocument, position: vscode.Position): string | null {
  const range = document.getWordRangeAtPosition(position, /[^\s]+/);
  return range ? document.getText(range) : null;
}

/**
 * Durchsucht alle Forth-Dateien im Workspace neu.
 */
async function rebuildIndex() {
  wordIndex.clear();
  const files = await vscode.workspace.findFiles('**/*.{fs,fth,4th,f,seq}', '**/node_modules/**');
  for (const file of files) {
    await indexFile(file);
  }
}

/**
 * Parst eine einzelne Datei und trägt alle gefundenen Wörter in den Index ein.
 */
async function indexFile(uri: vscode.Uri) {
  // Alte Einträge dieser Datei zuerst entfernen
  for (const [key, list] of wordIndex.entries()) {
    const filtered = list.filter(item => item.location.uri.toString() !== uri.toString());
    if (filtered.length === 0) {
      wordIndex.delete(key);
    } else {
      wordIndex.set(key, filtered);
    }
  }

  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString('utf8');
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Ignoriere reine Kommentarzeilen
      if (/^\s*\\/.test(line)) continue;

      DEFINITION_REGEX.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = DEFINITION_REGEX.exec(line)) !== null) {
        const kind = match[1].toLowerCase();
        const name = match[2];
        let stackComment = match[3] || '';
        let docLine = match[4] || '';

        // Falls kein Kommentar in derselben Zeile: Prüfe die Zeile direkt darüber
        if (!docLine && i > 0) {
          const prevLine = lines[i - 1].trim();
          if (prevLine.startsWith('\\') || (prevLine.startsWith('(') && prevLine.endsWith(')'))) {
            docLine = prevLine;
          }
        }

        // Falls Stack-Kommentar in der nächsten Zeile nach ':' steht
        if (!stackComment && i + 1 < lines.length) {
          const nextParen = lines[i + 1].match(/^\s*(\(\s*.*?\s*\))/);
          if (nextParen) stackComment = nextParen[1];
        }

        // Extrahiere bis zu 8 Zeilen Vorschau (oder bis zum ';')
        const previewLines: string[] = [];
        for (let j = i; j < Math.min(i + 8, lines.length); j++) {
          previewLines.push(lines[j]);
          if ((kind === ':' || kind === 'code') && /(?:^|\s)(;|end-code)(?=\s|$)/i.test(lines[j])) {
            break;
          }
          if (kind !== ':' && kind !== 'code') break; // Bei VARIABLE/CONSTANT reicht 1 Zeile
        }

        const col = match.index + match[0].indexOf(name);
        const pos = new vscode.Position(i, Math.max(0, col));
        const location = new vscode.Location(uri, pos);

        const key = name.toLowerCase();
        const existing = wordIndex.get(key) || [];
        existing.push({
          name,
          kind,
          stackComment,
          docLine,
          preview: previewLines.join('\n'),
          location
        });
        wordIndex.set(key, existing);
      }
    }
  } catch (err) {
    console.error(`Fehler beim Indizieren von ${uri.fsPath}:`, err);
  }
}

export function deactivate() {
  wordIndex.clear();
}