import * as vscode from 'vscode';
import type { Definition, ParsedFile } from '../core/parser';
import { enclosingDefinition, wordAt, type DefinitionEntry } from '../core/workspaceIndex';
import { FORTH_LANGUAGE, fullRange, nameRange, type IndexService } from '../indexService';

const FUNCTION_KINDS = new Set([':', 'code', 'defer']);
const CONSTANT_KINDS = new Set(['constant', '2constant', 'fconstant']);
const VARIABLE_KINDS = new Set(['variable', '2variable', 'fvariable', 'value', '2value', 'fvalue', 'user']);
const FIELD_KINDS = new Set(['field:', 'cfield:', 'ffield:', '2field:', '+field', 'field']);

export function symbolKind(definition: Definition): vscode.SymbolKind {
  if (definition.isColon || FUNCTION_KINDS.has(definition.kind)) return vscode.SymbolKind.Function;
  if (CONSTANT_KINDS.has(definition.kind)) return vscode.SymbolKind.Constant;
  if (VARIABLE_KINDS.has(definition.kind)) return vscode.SymbolKind.Variable;
  if (FIELD_KINDS.has(definition.kind)) return vscode.SymbolKind.Field;
  if (definition.kind === 'create' || definition.kind === 'buffer:') return vscode.SymbolKind.Array;
  if (definition.kind === 'begin-structure' || definition.kind === 'end-struct') return vscode.SymbolKind.Struct;
  return vscode.SymbolKind.Object;
}

/** What a position in a document refers to. */
interface Target {
  file: ParsedFile;
  name: string;
  range: vscode.Range;
  /** Index of the definition whose local variable the name is, or -1 for a global word. */
  localIn: number;
}

function targetAt(service: IndexService, document: vscode.TextDocument, position: vscode.Position): Target | null {
  const file = service.sync(document);
  const word = wordAt(file, position.line, position.character);
  if (!word) return null;
  const { token, index } = word;
  const enclosing = enclosingDefinition(file, index);
  const isLocal = enclosing >= 0 && file.definitions[enclosing].locals.includes(token.text.toLowerCase());
  return {
    file,
    name: token.text,
    range: new vscode.Range(token.line, token.col, token.endLine, token.endCol),
    localIn: isLocal ? enclosing : -1,
  };
}

function location(uri: string, line: number, col: number, length: number): vscode.Location {
  return new vscode.Location(vscode.Uri.parse(uri), new vscode.Range(line, col, line, col + length));
}

/** All places where the target is used, optionally with its definitions. */
function occurrences(service: IndexService, document: vscode.TextDocument, target: Target, withDefinitions: boolean): vscode.Location[] {
  const key = target.name.toLowerCase();
  if (target.localIn >= 0) {
    return target.file.references
      .filter(reference => reference.local && reference.def === target.localIn && reference.name.toLowerCase() === key)
      .map(reference => new vscode.Location(document.uri, new vscode.Range(reference.line, reference.col, reference.line, reference.col + reference.name.length)));
  }
  const result = service.index
    .referencesOf(key)
    .map(({ uri, reference }) => location(uri, reference.line, reference.col, reference.name.length));
  if (withDefinitions) {
    for (const { uri, definition } of service.index.definitionsOf(key)) {
      result.push(location(uri, definition.line, definition.col, definition.name.length));
    }
  }
  return result;
}

function callItem(entry: DefinitionEntry): vscode.CallHierarchyItem {
  const { definition } = entry;
  return new vscode.CallHierarchyItem(
    symbolKind(definition),
    definition.name,
    definition.stackComment,
    vscode.Uri.parse(entry.uri),
    fullRange(definition),
    nameRange(definition),
  );
}

function documentSymbols(file: ParsedFile, document: vscode.TextDocument): vscode.DocumentSymbol[] {
  const lastLine = Math.max(document.lineCount - 1, 0);
  const root: vscode.DocumentSymbol[] = [];
  const sections = file.sections.map((section, index) => {
    const endLine = index + 1 < file.sections.length ? Math.max(file.sections[index + 1].line - 2, section.line) : lastLine;
    const range = new vscode.Range(section.line, 0, endLine, document.lineAt(endLine).text.length);
    const titleRange = document.lineAt(section.line).range;
    const symbol = new vscode.DocumentSymbol(section.title, '', vscode.SymbolKind.Namespace, range, titleRange);
    root.push(symbol);
    return symbol;
  });

  for (const definition of file.definitions) {
    if (!definition.name) continue;
    const detail = definition.stackComment || (definition.isColon ? '' : definition.kind);
    const symbol = new vscode.DocumentSymbol(definition.name, detail, symbolKind(definition), fullRange(definition), nameRange(definition));
    const section = sections.find(candidate => candidate.range.contains(symbol.range));
    (section ? section.children : root).push(symbol);
  }
  return root.sort((a, b) => a.range.start.compareTo(b.range.start));
}

/** True if the characters of the query appear in this order in the name. */
function fuzzyMatch(name: string, query: string): boolean {
  let at = 0;
  for (const char of query) {
    at = name.indexOf(char, at);
    if (at < 0) return false;
    at++;
  }
  return true;
}

export function registerNavigation(service: IndexService): vscode.Disposable[] {
  const { index } = service;

  const definitionProvider: vscode.DefinitionProvider = {
    provideDefinition(document, position) {
      const target = targetAt(service, document, position);
      if (!target) return null;
      if (target.localIn >= 0) {
        const declaration = occurrences(service, document, target, false)[0];
        return declaration ?? null;
      }
      return index
        .definitionsOf(target.name)
        .map(({ uri, definition }) => location(uri, definition.line, definition.col, definition.name.length));
    },
  };

  const referenceProvider: vscode.ReferenceProvider = {
    provideReferences(document, position, context) {
      const target = targetAt(service, document, position);
      return target ? occurrences(service, document, target, context.includeDeclaration) : [];
    },
  };

  const renameProvider: vscode.RenameProvider = {
    prepareRename(document, position) {
      const target = targetAt(service, document, position);
      if (!target || (target.localIn < 0 && !index.isDefined(target.name))) {
        throw new Error('Nur selbst definierte Wörter können umbenannt werden.');
      }
      return target.range;
    },
    provideRenameEdits(document, position, newName) {
      const target = targetAt(service, document, position);
      if (!target) return null;
      if (!/^\S+$/.test(newName)) throw new Error('Ein Forth-Wort darf keine Leerzeichen enthalten.');
      const edit = new vscode.WorkspaceEdit();
      for (const occurrence of occurrences(service, document, target, true)) {
        edit.replace(occurrence.uri, occurrence.range, newName);
      }
      return edit;
    },
  };

  const highlightProvider: vscode.DocumentHighlightProvider = {
    provideDocumentHighlights(document, position) {
      const target = targetAt(service, document, position);
      if (!target) return [];
      const own = document.uri.toString();
      const key = target.name.toLowerCase();
      const highlights = occurrences(service, document, target, false)
        .filter(occurrence => occurrence.uri.toString() === own)
        .map(occurrence => new vscode.DocumentHighlight(occurrence.range, vscode.DocumentHighlightKind.Read));
      if (target.localIn < 0) {
        for (const definition of target.file.definitions) {
          if (definition.name.toLowerCase() === key) {
            highlights.push(new vscode.DocumentHighlight(nameRange(definition), vscode.DocumentHighlightKind.Write));
          }
        }
      }
      return highlights;
    },
  };

  const documentSymbolProvider: vscode.DocumentSymbolProvider = {
    provideDocumentSymbols(document) {
      return documentSymbols(service.sync(document), document);
    },
  };

  const workspaceSymbolProvider: vscode.WorkspaceSymbolProvider = {
    provideWorkspaceSymbols(query) {
      const needle = query.toLowerCase();
      return index
        .allDefinitions()
        .filter(({ definition }) => definition.name && fuzzyMatch(definition.name.toLowerCase(), needle))
        .map(({ uri, definition }) => {
          const target = vscode.Uri.parse(uri);
          return new vscode.SymbolInformation(
            definition.name,
            symbolKind(definition),
            vscode.workspace.asRelativePath(target),
            new vscode.Location(target, nameRange(definition)),
          );
        });
    },
  };

  const callHierarchyProvider: vscode.CallHierarchyProvider = {
    prepareCallHierarchy(document, position) {
      const target = targetAt(service, document, position);
      if (!target || target.localIn >= 0) return [];
      return index.definitionsOf(target.name).map(callItem);
    },
    provideCallHierarchyIncomingCalls(item) {
      const callers = new Map<string, { entry: DefinitionEntry; ranges: vscode.Range[] }>();
      for (const { uri, reference } of index.referencesOf(item.name)) {
        const definition = reference.def >= 0 ? index.get(uri)?.definitions[reference.def] : undefined;
        if (!definition) continue;
        const key = `${uri}#${reference.def}`;
        const caller = callers.get(key) ?? { entry: { uri, index: reference.def, definition }, ranges: [] };
        caller.ranges.push(new vscode.Range(reference.line, reference.col, reference.line, reference.col + reference.name.length));
        callers.set(key, caller);
      }
      return [...callers.values()].map(caller => new vscode.CallHierarchyIncomingCall(callItem(caller.entry), caller.ranges));
    },
    provideCallHierarchyOutgoingCalls(item) {
      const uri = item.uri.toString();
      const file = index.get(uri);
      if (!file) return [];
      const start = item.selectionRange.start;
      const caller = file.definitions.findIndex(definition => definition.line === start.line && definition.col === start.character);
      if (caller < 0) return [];
      const callees = new Map<string, vscode.Range[]>();
      for (const reference of file.references) {
        if (reference.def !== caller || reference.local) continue;
        const key = reference.name.toLowerCase();
        const ranges = callees.get(key) ?? [];
        ranges.push(new vscode.Range(reference.line, reference.col, reference.line, reference.col + reference.name.length));
        callees.set(key, ranges);
      }
      const calls: vscode.CallHierarchyOutgoingCall[] = [];
      for (const [name, ranges] of callees) {
        for (const entry of index.definitionsOf(name)) {
          calls.push(new vscode.CallHierarchyOutgoingCall(callItem(entry), ranges));
        }
      }
      return calls;
    },
  };

  return [
    vscode.languages.registerDefinitionProvider(FORTH_LANGUAGE, definitionProvider),
    vscode.languages.registerReferenceProvider(FORTH_LANGUAGE, referenceProvider),
    vscode.languages.registerRenameProvider(FORTH_LANGUAGE, renameProvider),
    vscode.languages.registerDocumentHighlightProvider(FORTH_LANGUAGE, highlightProvider),
    vscode.languages.registerDocumentSymbolProvider(FORTH_LANGUAGE, documentSymbolProvider),
    vscode.languages.registerWorkspaceSymbolProvider(workspaceSymbolProvider),
    vscode.languages.registerCallHierarchyProvider(FORTH_LANGUAGE, callHierarchyProvider),
  ];
}
