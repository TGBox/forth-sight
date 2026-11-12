import * as path from 'node:path';
import * as vscode from 'vscode';
import { isForth } from '../indexService';

const TERMINAL_NAME = 'gforth';

/** Runs Forth code in a gforth REPL inside the integrated terminal. */
class GforthRepl implements vscode.Disposable {
  private terminal: vscode.Terminal | undefined;
  private readonly closeListener = vscode.window.onDidCloseTerminal(terminal => {
    if (terminal === this.terminal) this.terminal = undefined;
  });

  /** Starts a fresh gforth process, replacing a running one. */
  restart(cwd?: string): vscode.Terminal {
    this.terminal?.dispose();
    const config = vscode.workspace.getConfiguration('forth-sight');
    this.terminal = vscode.window.createTerminal({
      name: TERMINAL_NAME,
      shellPath: config.get('gforth.path', 'gforth'),
      shellArgs: config.get<string[]>('gforth.arguments', []),
      cwd,
    });
    this.terminal.show(true);
    return this.terminal;
  }

  current(cwd?: string): vscode.Terminal {
    return this.terminal ?? this.restart(cwd);
  }

  dispose(): void {
    this.closeListener.dispose();
    this.terminal?.dispose();
  }
}

function activeForthEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor && isForth(editor.document)) return editor;
  void vscode.window.showInformationMessage('Dieser Befehl benötigt eine geöffnete Forth-Datei.');
  return undefined;
}

function directoryOf(document: vscode.TextDocument): string | undefined {
  return document.uri.scheme === 'file' ? path.dirname(document.uri.fsPath) : undefined;
}

export function registerGforth(): vscode.Disposable[] {
  const repl = new GforthRepl();

  const startRepl = (): void => {
    const editor = vscode.window.activeTextEditor;
    repl.restart(editor ? directoryOf(editor.document) : undefined).show();
  };

  // Loads the file into a fresh gforth, so that earlier definitions do not interfere.
  const loadFile = async (): Promise<void> => {
    const editor = activeForthEditor();
    if (!editor) return;
    const { document } = editor;
    if (document.uri.scheme !== 'file') {
      void vscode.window.showWarningMessage('Die Datei muss zuerst gespeichert werden.');
      return;
    }
    if (document.isDirty && !(await document.save())) return;
    const terminal = repl.restart(directoryOf(document));
    terminal.sendText(`s" ${document.uri.fsPath}" included`);
  };

  // Sends the selection, or the current line and then moves on to the next one.
  const sendSelection = async (): Promise<void> => {
    const editor = activeForthEditor();
    if (!editor) return;
    const { document, selection } = editor;
    const text = selection.isEmpty ? document.lineAt(selection.active.line).text : document.getText(selection);
    if (text.trim()) repl.current(directoryOf(document)).sendText(text);
    if (selection.isEmpty) await vscode.commands.executeCommand('cursorMove', { to: 'down', by: 'line' });
  };

  return [
    repl,
    vscode.commands.registerCommand('forth-sight.startRepl', startRepl),
    vscode.commands.registerCommand('forth-sight.loadFile', loadFile),
    vscode.commands.registerCommand('forth-sight.sendSelection', sendSelection),
  ];
}
