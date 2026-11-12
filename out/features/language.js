"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerLanguageFeatures = registerLanguageFeatures;
const vscode = __importStar(require("vscode"));
const builtins_1 = require("../core/builtins");
const hover_1 = require("../core/hover");
const workspaceIndex_1 = require("../core/workspaceIndex");
const indexService_1 = require("../indexService");
const navigation_1 = require("./navigation");
const TOKEN_TYPES = ['function', 'variable', 'property', 'macro', 'parameter'];
const TOKEN_MODIFIERS = ['declaration', 'readonly'];
const LEGEND = new vscode.SemanticTokensLegend(TOKEN_TYPES, TOKEN_MODIFIERS);
const DECLARATION = 1;
const READONLY = 2;
function displayPath(uri) {
    return vscode.workspace.asRelativePath(vscode.Uri.parse(uri));
}
function completionKind(definition) {
    switch ((0, navigation_1.symbolKind)(definition)) {
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
function semanticType(definition) {
    if (definition.definer || definition.immediate)
        return { type: TOKEN_TYPES.indexOf('macro'), modifiers: 0 };
    switch ((0, navigation_1.symbolKind)(definition)) {
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
function registerLanguageFeatures(service) {
    const { index } = service;
    const hoverProvider = {
        provideHover(document, position) {
            const file = service.sync(document);
            const word = (0, workspaceIndex_1.wordAt)(file, position.line, position.character);
            if (!word)
                return null;
            const range = (0, indexService_1.tokenRange)(word.token);
            const enclosing = (0, workspaceIndex_1.enclosingDefinition)(file, word.index);
            if (enclosing >= 0 && file.definitions[enclosing].locals.includes(word.token.text.toLowerCase())) {
                const text = new vscode.MarkdownString('Lokale Variable von ');
                text.appendCodeblock(`: ${file.definitions[enclosing].name}`, indexService_1.FORTH_LANGUAGE);
                return new vscode.Hover(text, range);
            }
            const markdown = (0, hover_1.buildHoverMarkdown)(index, word.token.text, displayPath);
            return markdown ? new vscode.Hover(new vscode.MarkdownString(markdown), range) : null;
        },
    };
    const completionProvider = {
        provideCompletionItems(document, position) {
            const file = service.sync(document);
            const at = (0, workspaceIndex_1.tokenIndexAt)(file, position.line, position.character);
            const token = at >= 0 ? file.tokens[at] : undefined;
            if (token && token.kind !== 'word' && token.kind !== 'operand')
                return [];
            const range = token ? (0, indexService_1.tokenRange)(token) : new vscode.Range(position, position);
            const items = [];
            const seen = new Set();
            const enclosing = at >= 0 ? (0, workspaceIndex_1.enclosingDefinition)(file, at) : -1;
            for (const local of enclosing >= 0 ? file.definitions[enclosing].locals : []) {
                if (seen.has(local))
                    continue;
                seen.add(local);
                const item = new vscode.CompletionItem(local, vscode.CompletionItemKind.Variable);
                item.detail = 'lokale Variable';
                item.range = range;
                items.push(item);
            }
            for (const { uri, definition } of index.allDefinitions()) {
                const lower = definition.name.toLowerCase();
                // The word being typed is not a suggestion for itself.
                if (!definition.name || seen.has(lower) || (token && definition.line === token.line && definition.col === token.col && uri === document.uri.toString()))
                    continue;
                seen.add(lower);
                const item = new vscode.CompletionItem(definition.name, completionKind(definition));
                item.detail = definition.stackComment || definition.kind;
                const documentation = new vscode.MarkdownString();
                if (definition.doc)
                    documentation.appendText(`${definition.doc}\n\n`);
                const source = index.get(uri);
                if (source)
                    documentation.appendCodeblock((0, hover_1.definitionPreview)(source.lines, definition.startLine, definition.endLine), indexService_1.FORTH_LANGUAGE);
                documentation.appendText(`${displayPath(uri)}:${definition.line + 1}`);
                item.documentation = documentation;
                item.range = range;
                item.sortText = `0${lower}`;
                items.push(item);
            }
            for (const [lower, builtin] of builtins_1.BUILTINS) {
                if (seen.has(lower))
                    continue;
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
    const semanticEmitter = new vscode.EventEmitter();
    const semanticProvider = {
        onDidChangeSemanticTokens: semanticEmitter.event,
        provideDocumentSemanticTokens(document) {
            const file = service.sync(document);
            const entries = [];
            for (const definition of file.definitions) {
                if (!definition.name)
                    continue;
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
                if (definition)
                    entries.push({ ...position, ...semanticType(definition) });
            }
            entries.sort((a, b) => a.line - b.line || a.col - b.col);
            const builder = new vscode.SemanticTokensBuilder(LEGEND);
            for (const entry of entries)
                builder.push(entry.line, entry.col, entry.length, entry.type, entry.modifiers);
            return builder.build();
        },
    };
    return [
        semanticEmitter,
        service.onDidChange(() => semanticEmitter.fire()),
        vscode.languages.registerHoverProvider(indexService_1.FORTH_LANGUAGE, hoverProvider),
        vscode.languages.registerCompletionItemProvider(indexService_1.FORTH_LANGUAGE, completionProvider),
        vscode.languages.registerDocumentSemanticTokensProvider(indexService_1.FORTH_LANGUAGE, semanticProvider, LEGEND),
    ];
}
//# sourceMappingURL=language.js.map