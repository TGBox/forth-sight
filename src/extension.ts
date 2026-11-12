import * as vscode from 'vscode';
import { registerDiagnostics } from './features/diagnostics';
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
    ...registerGforth(),
  );

  // Indexing runs in the background; the providers work with what is indexed so far.
  service.initialize().catch((error: unknown) => {
    console.error('forth-sight: indexing the workspace failed', error);
  });
}

export function deactivate(): void {
  // All resources are released through context.subscriptions.
}
