import * as vscode from 'vscode';
import { BUILTINS } from '../core/builtins';
import { buildHoverMarkdown, definitionPreview } from '../core/hover';
import type { Definition } from '../core/parser';
import { enclosingDefinition, tokenIndexAt, wordAt } from '../core/workspaceIndex';
import { FORTH_LANGUAGE, tokenRange, type IndexService } from '../indexService';
import { symbolKind } from './navigation';

const TOKEN_TYPES = ['function', 'variable', 'property', 'macro', 'parameter'];
const TOKEN_MODIFIERS = ['declaration', 'readonly'];
const LEGEND = new vscode.SemanticTokensLegend(TOKEN_TYPES, TOKEN_MODIFIERS);
const DECLARATION = 1;
const READONLY = 2;

function displayPath(uri: string): string {
  return vscode.workspace.asRelativePath(vscode.Uri.parse(uri));
}

function completionKind(definition: Definition): vscode.CompletionItemKind {
  switch (symbolKind(definition)) {
    case vscode.SymbolKind.Function:
      return vscode.CompletionItemKind.Function;
    case vscode.SymbolKind.Constant:
      return vscode.CompletionItemKind.Constant;
    case vscode.SymbolKind.Field:
      return vscode.CompletionItemKind.Field;
    default:
      return vscode.CompletionItemKind.Variable;
  }
}

/** Semantic token type and modifiers for uses of a user-defined word. */
function semanticType(definition: Definition): { type: number; modifiers: number } {
  if (definition.definer || definition.immediate) return { type: TOKEN_TYPES.indexOf('macro'), modifiers: 0 };
  switch (symbolKind(definition)) {
    case vscode.SymbolKind.Function:
      return { type: TOKEN_TYPES.indexOf('function'), modifiers: 0 };
    case vscode.SymbolKind.Constant:
      return { type: TOKEN_TYPES.indexOf('variable'), modifiers: READONLY };
    case vscode.SymbolKind.Field:
      return { type: TOKEN_TYPES.indexOf('property'), modifiers: 0 };
    default:
      return { type: TOKEN_TYPES.indexOf('variable'), modifiers: 0 };
  }
}

export function registerLanguageFeatures(service: IndexService): vscode.Disposable[] {
  const { index } = service;

  const hoverProvider: vscode.HoverProvider = {
    provideHover(document, position) {
      const file = service.sync(document);
      const word = wordAt(file, position.line, position.character);
      if (!word) return null;
      const range = tokenRange(word.token);

      const enclosing = enclosingDefinition(file, word.index);
      if (enclosing >= 0 && file.definitions[enclosing].locals.includes(word.token.text.toLowerCase())) {
        const text = new vscode.MarkdownString('Lokale Variable von ');
        text.appendCodeblock(`: ${file.definitions[enclosing].name}`, FORTH_LANGUAGE);
        return new vscode.Hover(text, range);
      }

      const markdown = buildHoverMarkdown(index, word.token.text, displayPath);
      return markdown ? new vscode.Hover(new vscode.MarkdownString(markdown), range) : null;
    },
  };

  const completionProvider: vscode.CompletionItemProvider = {
    provideCompletionItems(document, position) {
      const file = service.sync(document);
      const at = tokenIndexAt(file, position.line, position.character);
      const token = at >= 0 ? file.tokens[at] : undefined;
      if (token && token.kind !== 'word' && token.kind !== 'operand') return [];

      const range = token ? tokenRange(token) : new vscode.Range(position, position);
      const items: vscode.CompletionItem[] = [];
      const seen = new Set<string>();

      const enclosing = at >= 0 ? enclosingDefinition(file, at) : -1;
      for (const local of enclosing >= 0 ? file.definitions[enclosing].locals : []) {
        if (seen.has(local)) continue;
        seen.add(local);
        const item = new vscode.CompletionItem(local, vscode.CompletionItemKind.Variable);
        item.detail = 'lokale Variable';
        item.range = range;
        items.push(item);
      }

      for (const { uri, definition } of index.allDefinitions()) {
        const lower = definition.name.toLowerCase();
        // The word being typed is not a suggestion for itself.
        if (!definition.name || seen.has(lower) || (token && definition.line === token.line && definition.col === token.col && uri === document.uri.toString())) continue;
        seen.add(lower);
        const item = new vscode.CompletionItem(definition.name, completionKind(definition));
        item.detail = definition.stackComment || definition.kind;
        const documentation = new vscode.MarkdownString();
        if (definition.doc) documentation.appendText(`${definition.doc}\n\n`);
        const source = index.get(uri);
        if (source) documentation.appendCodeblock(definitionPreview(source.lines, definition.startLine, definition.endLine), FORTH_LANGUAGE);
        documentation.appendText(`${displayPath(uri)}:${definition.line + 1}`);
        item.documentation = documentation;
        item.range = range;
        item.sortText = `0${lower}`;
        items.push(item);
      }

      for (const [lower, builtin] of BUILTINS) {
        if (seen.has(lower)) continue;
        const item = new vscode.CompletionItem(builtin.name, vscode.CompletionItemKind.Keyword);
        item.detail = `( ${builtin.stack} )`;
        item.documentation = `${builtin.description} (${builtin.category})`;
        item.range = range;
        item.sortText = `1${lower}`;
        items.push(item);
      }
      return items;
    },
  };

  const semanticEmitter = new vscode.EventEmitter<void>();
  const semanticProvider: vscode.DocumentSemanticTokensProvider = {
    onDidChangeSemanticTokens: semanticEmitter.event,
    provideDocumentSemanticTokens(document) {
      const file = service.sync(document);
      const entries: Array<{ line: number; col: number; length: number; type: number; modifiers: number }> = [];

      for (const definition of file.definitions) {
        if (!definition.name) continue;
        const { type, modifiers } = semanticType(definition);
        entries.push({ line: definition.line, col: definition.col, length: definition.name.length, type, modifiers: modifiers | DECLARATION });
      }
      for (const reference of file.references) {
        const position = { line: reference.line, col: reference.col, length: reference.name.length };
        if (reference.local) {
          entries.push({ ...position, type: TOKEN_TYPES.indexOf('parameter'), modifiers: 0 });
          continue;
        }
        const definition = index.definitionsOf(reference.name)[0]?.definition;
        if (definition) entries.push({ ...position, ...semanticType(definition) });
      }

      entries.sort((a, b) => a.line - b.line || a.col - b.col);
      const builder = new vscode.SemanticTokensBuilder(LEGEND);
      for (const entry of entries) builder.push(entry.line, entry.col, entry.length, entry.type, entry.modifiers);
      return builder.build();
    },
  };

  return [
    semanticEmitter,
    service.onDidChange(() => semanticEmitter.fire()),
    vscode.languages.registerHoverProvider(FORTH_LANGUAGE, hoverProvider),
    vscode.languages.registerCompletionItemProvider(FORTH_LANGUAGE, completionProvider),
    vscode.languages.registerDocumentSemanticTokensProvider(FORTH_LANGUAGE, semanticProvider, LEGEND),
  ];
}
