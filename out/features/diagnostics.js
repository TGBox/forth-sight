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
exports.registerDiagnostics = registerDiagnostics;
const vscode = __importStar(require("vscode"));
const diagnostics_1 = require("../core/diagnostics");
const indexService_1 = require("../indexService");
const SOURCE = 'forth-sight';
const ADD_KNOWN_WORD_COMMAND = 'forth-sight.addKnownWord';
const KNOWN_WORDS_SETTING = 'diagnostics.knownWords';
const SEVERITIES = {
    error: vscode.DiagnosticSeverity.Error,
    warning: vscode.DiagnosticSeverity.Warning,
    info: vscode.DiagnosticSeverity.Information,
};
function readOptions() {
    const config = vscode.workspace.getConfiguration('forth-sight');
    return {
        enabled: config.get('diagnostics.enabled', true),
        unknownWords: config.get('diagnostics.unknownWords', true),
        redefinitions: config.get('diagnostics.redefinitions', true),
        stackEffects: config.get('diagnostics.stackEffects', true),
        knownWords: new Set(config.get(KNOWN_WORDS_SETTING, []).map(word => word.toLowerCase())),
    };
}
async function addKnownWord(word) {
    if (typeof word !== 'string' || !word)
        return;
    const config = vscode.workspace.getConfiguration('forth-sight');
    const words = config.get(KNOWN_WORDS_SETTING, []);
    if (words.some(known => known.toLowerCase() === word.toLowerCase()))
        return;
    const target = vscode.workspace.workspaceFolders?.length
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
    await config.update(KNOWN_WORDS_SETTING, [...words, word], target);
}
function registerDiagnostics(service) {
    const collection = vscode.languages.createDiagnosticCollection(SOURCE);
    // Any change can affect other files (definitions, stack comments), so all open documents are refreshed.
    const refresh = () => {
        const options = readOptions();
        collection.clear();
        // Before the workspace is indexed, words from other files would be reported as unknown.
        if (!options.enabled || !service.ready)
            return;
        for (const document of vscode.workspace.textDocuments) {
            if (!(0, indexService_1.isForth)(document))
                continue;
            service.sync(document);
            const diagnostics = (0, diagnostics_1.computeDiagnostics)(service.index, document.uri.toString(), options).map(problem => {
                const range = new vscode.Range(problem.line, problem.col, problem.line, problem.endCol);
                const diagnostic = new vscode.Diagnostic(range, problem.message, SEVERITIES[problem.severity]);
                diagnostic.source = SOURCE;
                diagnostic.code = problem.code;
                return diagnostic;
            });
            collection.set(document.uri, diagnostics);
        }
    };
    const codeActionProvider = {
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
            if (event.affectsConfiguration('forth-sight.diagnostics'))
                refresh();
        }),
        vscode.commands.registerCommand(ADD_KNOWN_WORD_COMMAND, addKnownWord),
        vscode.languages.registerCodeActionsProvider(indexService_1.FORTH_LANGUAGE, codeActionProvider, {
            providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
        }),
    ];
}
//# sourceMappingURL=diagnostics.js.map