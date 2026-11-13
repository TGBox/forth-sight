import * as vscode from 'vscode';
import { registerDiagnostics } from './features/diagnostics';
import { registerDictionary } from './features/dictionary';
import { registerGforth } from './features/gforth';
import { registerLanguageFeatures } from './features/language';
import { registerNavigation } from './features/navigation';
import { IndexService } from './indexService';

export function activate(context: vscode.ExtensionContext): void {
  const service = new IndexService();
  context.subscriptions.push(
    service,
    ...registerNavigation(service),
    ...registerLanguageFeatures(service),
    ...registerDiagnostics(service),
    ...registerDictionary(service, context.extensionUri),
    ...registerGforth(),
  );

  const indexWorkspace = (): void => {
    // Indexing runs in the background; the providers work with what is indexed so far.
    service.initialize().catch((error: unknown) => {
      console.error('forth-sight: indexing the workspace failed', error);
    });
  };
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('forth-sight.index')) indexWorkspace();
    }),
  );
  indexWorkspace();
}

export function deactivate(): void {
  // All resources are released through context.subscriptions.
}
