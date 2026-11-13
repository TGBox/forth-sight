import * as path from 'node:path';
import * as vscode from 'vscode';
import { Dictionary, parseDictionaryJson, parseForthLspConfig, parseWordList } from '../core/dictionary';
import { decodeSource } from '../core/encoding';
import type { IndexService } from '../indexService';

const FORTH_LSP_CONFIG = '.forth-lsp.toml';
const RELOAD_DELAY_MS = 500;

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return decodeSource(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

/** Adds a word list (any extension) or a dictionary file (.json) to the dictionary. */
async function addFile(dictionary: Dictionary, uri: vscode.Uri, label: string): Promise<void> {
  const text = await readText(uri);
  if (text === undefined) {
    console.warn(`forth-sight: dictionary file not found: ${uri.fsPath}`);
    return;
  }
  if (!uri.path.toLowerCase().endsWith('.json')) {
    dictionary.addNames(parseWordList(text), label);
    return;
  }
  try {
    dictionary.add(parseDictionaryJson(text), label);
  } catch (error) {
    console.warn(`forth-sight: dictionary file is not valid JSON: ${uri.fsPath}`, error);
  }
}

function resolvePath(folder: vscode.Uri, file: string): vscode.Uri {
  return path.isAbsolute(file) ? vscode.Uri.file(file) : vscode.Uri.joinPath(folder, file);
}

/** Dictionaries shipped with the extension: all files of dictionaries/<name>/. */
async function addBundled(dictionary: Dictionary, extensionUri: vscode.Uri, name: string): Promise<void> {
  const folder = vscode.Uri.joinPath(extensionUri, 'dictionaries', name);
  let files: Array<[string, vscode.FileType]>;
  try {
    files = await vscode.workspace.fs.readDirectory(folder);
  } catch {
    console.warn(`forth-sight: bundled dictionary not found: ${name}`);
    return;
  }
  // Dictionary files come first: they carry the spelling and details of a word.
  const names = files
    .filter(([, type]) => type === vscode.FileType.File)
    .map(([file]) => file)
    .sort((a, b) => Number(b.endsWith('.json')) - Number(a.endsWith('.json')) || a.localeCompare(b));
  for (const file of names) {
    if (file.endsWith('.json') || file.endsWith('.words')) {
      await addFile(dictionary, vscode.Uri.joinPath(folder, file), name);
    }
  }
}

/** Words listed for forth-lsp in the workspace folder: inline words and word list files. */
async function addForthLspWords(dictionary: Dictionary, folder: vscode.WorkspaceFolder): Promise<void> {
  const text = await readText(vscode.Uri.joinPath(folder.uri, FORTH_LSP_CONFIG));
  if (text === undefined) return;
  const config = parseForthLspConfig(text);
  dictionary.add(config.words, FORTH_LSP_CONFIG);
  for (const file of config.wordFiles) {
    await addFile(dictionary, resolvePath(folder.uri, file), path.basename(file));
  }
}

async function loadDictionary(extensionUri: vscode.Uri): Promise<Dictionary> {
  const config = vscode.workspace.getConfiguration('forth-sight');
  const dictionary = new Dictionary();
  const folders = vscode.workspace.workspaceFolders ?? [];

  // Sources close to the project come first, so that their details take precedence.
  for (const file of config.get<string[]>('dictionary.files', [])) {
    if (path.isAbsolute(file)) await addFile(dictionary, vscode.Uri.file(file), path.basename(file));
    else for (const folder of folders) await addFile(dictionary, resolvePath(folder.uri, file), path.basename(file));
  }
  if (config.get('dictionary.useForthLspConfig', true)) {
    for (const folder of folders) await addForthLspWords(dictionary, folder);
  }
  for (const name of config.get<string[]>('dictionary.bundled', [])) {
    await addBundled(dictionary, extensionUri, name);
  }
  return dictionary;
}

/** Loads the dictionaries and keeps them in step with the settings and the word files. */
export function registerDictionary(service: IndexService, extensionUri: vscode.Uri): vscode.Disposable[] {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;

  const reload = (): void => {
    const current = ++generation;
    loadDictionary(extensionUri).then(
      dictionary => {
        // A later reload supersedes this one.
        if (current === generation) service.setDictionary(dictionary);
      },
      (error: unknown) => console.error('forth-sight: loading the dictionaries failed', error),
    );
  };
  const scheduleReload = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(reload, RELOAD_DELAY_MS);
  };

  const watcher = vscode.workspace.createFileSystemWatcher(`**/{${FORTH_LSP_CONFIG},*.words}`);
  reload();

  return [
    watcher,
    watcher.onDidChange(scheduleReload),
    watcher.onDidCreate(scheduleReload),
    watcher.onDidDelete(scheduleReload),
    vscode.workspace.onDidChangeWorkspaceFolders(scheduleReload),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('forth-sight.dictionary')) scheduleReload();
    }),
    new vscode.Disposable(() => {
      if (timer !== undefined) clearTimeout(timer);
    }),
  ];
}
