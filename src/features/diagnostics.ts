import * as vscode from 'vscode';
import { computeDiagnostics, type DiagnosticOptions } from '../core/diagnostics';
import type { Severity } from '../core/parser';
import { FORTH_LANGUAGE, isForth, type IndexService } from '../indexService';

const SOURCE = 'forth-sight';
const ADD_KNOWN_WORD_COMMAND = 'forth-sight.addKnownWord';
const KNOWN_WORDS_SETTING = 'diagnostics.knownWords';

const SEVERITIES: Record<Severity, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

function readOptions(): (DiagnosticOptions & { enabled: boolean }) {
  const config = vscode.workspace.getConfiguration('forth-sight');
  return {
    enabled: config.get('diagnostics.enabled', true),
    unknownWords: config.get('diagnostics.unknownWords', true),
    redefinitions: config.get('diagnostics.redefinitions', true),
    stackEffects: config.get('diagnostics.stackEffects', true),
    knownWords: new Set(config.get<string[]>(KNOWN_WORDS_SETTING, []).map(word => word.toLowerCase())),
  };
}

async function addKnownWord(word: unknown): Promise<void> {
  if (typeof word !== 'string' || !word) return;
  const config = vscode.workspace.getConfiguration('forth-sight');
  const words = config.get<string[]>(KNOWN_WORDS_SETTING, []);
  if (words.some(known => known.toLowerCase() === word.toLowerCase())) return;
  const target = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await config.update(KNOWN_WORDS_SETTING, [...words, word], target);
}

export function registerDiagnostics(service: IndexService): vscode.Disposable[] {
  const collection = vscode.languages.createDiagnosticCollection(SOURCE);

  // Any change can affect other files (definitions, stack comments), so all open documents are refreshed.
  const refresh = (): void => {
    const options = readOptions();
    collection.clear();
    // Before the workspace is indexed, words from other files would be reported as unknown.
    if (!options.enabled || !service.ready) return;
    for (const document of vscode.workspace.textDocuments) {
      if (!isForth(document)) continue;
      service.sync(document);
      const diagnostics = computeDiagnostics(service.index, document.uri.toString(), options).map(problem => {
        const range = new vscode.Range(problem.line, problem.col, problem.line, problem.endCol);
        const diagnostic = new vscode.Diagnostic(range, problem.message, SEVERITIES[problem.severity]);
        diagnostic.source = SOURCE;
        diagnostic.code = problem.code;
        return diagnostic;
      });
      collection.set(document.uri, diagnostics);
    }
  };

  const codeActionProvider: vscode.CodeActionProvider = {
    provideCodeActions(document, _range, context) {
      return context.diagnostics
        .filter(diagnostic => diagnostic.source === SOURCE && diagnostic.code === 'unknown-word')
        .map(diagnostic => {
          const word = document.getText(diagnostic.range);
          const action = new vscode.CodeAction(`'${word}' als bekanntes Wort eintragen`, vscode.CodeActionKind.QuickFix);
          action.diagnostics = [diagnostic];
          action.command = { command: ADD_KNOWN_WORD_COMMAND, title: action.title, arguments: [word] };
          return action;
        });
    },
  };

  return [
    collection,
    service.onDidChange(refresh),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('forth-sight.diagnostics')) refresh();
    }),
    vscode.commands.registerCommand(ADD_KNOWN_WORD_COMMAND, addKnownWord),
    vscode.languages.registerCodeActionsProvider(FORTH_LANGUAGE, codeActionProvider, {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }),
  ];
}
