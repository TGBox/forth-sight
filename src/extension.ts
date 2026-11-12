import * as vscode from 'vscode';

/**
 * Formats the greeting message using user configuration or default fallback.
 */
export function formatGreeting(customGreeting?: string): string {
  const trimmed = (customGreeting ?? '').trim();
  return trimmed.length > 0 ? trimmed : 'Hallo aus forth-sight!';
}

/**
 * Called when the extension is activated.
 */
export function activate(context: vscode.ExtensionContext): void {
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(rocket) forth-sight';
  statusBarItem.tooltip = 'forth-sight: Klicken zum Ausführen';
  statusBarItem.command = 'forth-sight.helloWorld';
  statusBarItem.show();

  const helloDisposable = vscode.commands.registerCommand('forth-sight.helloWorld', () => {
    const config = vscode.workspace.getConfiguration('forth-sight');
    const greeting = formatGreeting(config.get<string>('greeting'));
    vscode.window.showInformationMessage(greeting);
  });


  context.subscriptions.push(statusBarItem, helloDisposable);
}

/**
 * Called when the extension is deactivated.
 */
export function deactivate(): void {
  // Clean up resources if necessary
}
