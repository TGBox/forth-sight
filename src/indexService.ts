import * as vscode from 'vscode';
import type { Definition, ParsedFile } from './core/parser';
import type { Token } from './core/tokenizer';
import { WorkspaceIndex } from './core/workspaceIndex';

export const FORTH_LANGUAGE = 'forth';
const FORTH_GLOB = '**/*.{fs,fth,4th,f,seq}';
const EXCLUDE_GLOB = '**/node_modules/**';
const CHANGE_DELAY_MS = 300;

export function isForth(document: vscode.TextDocument): boolean {
  return document.languageId === FORTH_LANGUAGE;
}

export function tokenRange(token: Token): vscode.Range {
  return new vscode.Range(token.line, token.col, token.endLine, token.endCol);
}

export function nameRange(definition: Definition): vscode.Range {
  return new vscode.Range(definition.line, definition.col, definition.line, definition.col + definition.name.length);
}

export function fullRange(definition: Definition): vscode.Range {
  return new vscode.Range(definition.startLine, definition.startCol, definition.endLine, definition.endCol);
}

/** Keeps the workspace index in step with files on disk and with unsaved editor contents. */
export class IndexService implements vscode.Disposable {
  readonly index = new WorkspaceIndex();

  private readonly versions = new Map<string, number>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [this.changeEmitter];

  /** Fires after the index has changed. */
  readonly onDidChange = this.changeEmitter.event;

  /** False until the workspace has been indexed for the first time. */
  ready = false;

  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher(FORTH_GLOB);
    this.disposables.push(
      watcher,
      watcher.onDidChange(uri => void this.loadFromDisk(uri)),
      watcher.onDidCreate(uri => void this.loadFromDisk(uri)),
      watcher.onDidDelete(uri => this.forget(uri)),
      vscode.workspace.onDidOpenTextDocument(document => {
        if (!isForth(document)) return;
        this.sync(document);
        this.changeEmitter.fire();
      }),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (isForth(event.document)) this.scheduleSync(event.document);
      }),
      vscode.workspace.onDidCloseTextDocument(document => {
        if (!isForth(document)) return;
        this.cancelTimer(document.uri.toString());
        // Unsaved changes are gone now: fall back to the file on disk.
        if (vscode.workspace.getWorkspaceFolder(document.uri)) void this.loadFromDisk(document.uri, true);
        else this.forget(document.uri);
      }),
    );
  }

  /** Indexes all Forth files of the workspace and all open Forth documents. */
  async initialize(): Promise<void> {
    const uris = await vscode.workspace.findFiles(FORTH_GLOB, EXCLUDE_GLOB);
    const entries: Array<readonly [string, string]> = [];
    await Promise.all(
      uris.map(async uri => {
        const text = await this.read(uri);
        if (text !== undefined) entries.push([uri.toString(), text]);
      }),
    );
    for (const document of vscode.workspace.textDocuments) {
      if (!isForth(document)) continue;
      entries.push([document.uri.toString(), document.getText()]);
      this.versions.set(document.uri.toString(), document.version);
    }
    this.index.update(entries);
    this.ready = true;
    this.changeEmitter.fire();
  }

  /** Returns the parse result for the current contents of the document. */
  sync(document: vscode.TextDocument): ParsedFile {
    const key = document.uri.toString();
    let file = this.index.get(key);
    if (!file || this.versions.get(key) !== document.version) {
      this.index.update([[key, document.getText()]]);
      this.versions.set(key, document.version);
      file = this.index.get(key);
    }
    if (!file) throw new Error(`Forth document is not indexed: ${key}`);
    return file;
  }

  private scheduleSync(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    this.cancelTimer(key);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        if (document.isClosed) return;
        this.sync(document);
        this.changeEmitter.fire();
      }, CHANGE_DELAY_MS),
    );
  }

  private cancelTimer(key: string): void {
    const timer = this.timers.get(key);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(key);
  }

  private async read(uri: vscode.Uri): Promise<string | undefined> {
    try {
      return new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      return undefined;
    }
  }

  private async loadFromDisk(uri: vscode.Uri, closed = false): Promise<void> {
    const key = uri.toString();
    // Open documents are the source of truth for their files.
    if (!closed && vscode.workspace.textDocuments.some(document => document.uri.toString() === key)) return;
    const text = await this.read(uri);
    this.versions.delete(key);
    if (text === undefined) this.index.remove(key);
    else this.index.update([[key, text]]);
    this.changeEmitter.fire();
  }

  private forget(uri: vscode.Uri): void {
    const key = uri.toString();
    this.versions.delete(key);
    this.index.remove(key);
    this.changeEmitter.fire();
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const disposable of this.disposables) disposable.dispose();
  }
}
