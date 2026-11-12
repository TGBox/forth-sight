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
exports.registerGforth = registerGforth;
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const indexService_1 = require("../indexService");
const TERMINAL_NAME = 'gforth';
/** Runs Forth code in a gforth REPL inside the integrated terminal. */
class GforthRepl {
    terminal;
    closeListener = vscode.window.onDidCloseTerminal(terminal => {
        if (terminal === this.terminal)
            this.terminal = undefined;
    });
    /** Starts a fresh gforth process, replacing a running one. */
    restart(cwd) {
        this.terminal?.dispose();
        const config = vscode.workspace.getConfiguration('forth-sight');
        this.terminal = vscode.window.createTerminal({
            name: TERMINAL_NAME,
            shellPath: config.get('gforth.path', 'gforth'),
            shellArgs: config.get('gforth.arguments', []),
            cwd,
        });
        this.terminal.show(true);
        return this.terminal;
    }
    current(cwd) {
        return this.terminal ?? this.restart(cwd);
    }
    dispose() {
        this.closeListener.dispose();
        this.terminal?.dispose();
    }
}
function activeForthEditor() {
    const editor = vscode.window.activeTextEditor;
    if (editor && (0, indexService_1.isForth)(editor.document))
        return editor;
    void vscode.window.showInformationMessage('Dieser Befehl benötigt eine geöffnete Forth-Datei.');
    return undefined;
}
function directoryOf(document) {
    return document.uri.scheme === 'file' ? path.dirname(document.uri.fsPath) : undefined;
}
function registerGforth() {
    const repl = new GforthRepl();
    const startRepl = () => {
        const editor = vscode.window.activeTextEditor;
        repl.restart(editor ? directoryOf(editor.document) : undefined).show();
    };
    // Loads the file into a fresh gforth, so that earlier definitions do not interfere.
    const loadFile = async () => {
        const editor = activeForthEditor();
        if (!editor)
            return;
        const { document } = editor;
        if (document.uri.scheme !== 'file') {
            void vscode.window.showWarningMessage('Die Datei muss zuerst gespeichert werden.');
            return;
        }
        if (document.isDirty && !(await document.save()))
            return;
        const terminal = repl.restart(directoryOf(document));
        terminal.sendText(`s" ${document.uri.fsPath}" included`);
    };
    // Sends the selection, or the current line and then moves on to the next one.
    const sendSelection = async () => {
        const editor = activeForthEditor();
        if (!editor)
            return;
        const { document, selection } = editor;
        const text = selection.isEmpty ? document.lineAt(selection.active.line).text : document.getText(selection);
        if (text.trim())
            repl.current(directoryOf(document)).sendText(text);
        if (selection.isEmpty)
            await vscode.commands.executeCommand('cursorMove', { to: 'down', by: 'line' });
    };
    return [
        repl,
        vscode.commands.registerCommand('forth-sight.startRepl', startRepl),
        vscode.commands.registerCommand('forth-sight.loadFile', loadFile),
        vscode.commands.registerCommand('forth-sight.sendSelection', sendSelection),
    ];
}
//# sourceMappingURL=gforth.js.map