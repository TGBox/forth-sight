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
exports.IndexService = exports.FORTH_LANGUAGE = void 0;
exports.isForth = isForth;
exports.tokenRange = tokenRange;
exports.nameRange = nameRange;
exports.fullRange = fullRange;
const vscode = __importStar(require("vscode"));
const workspaceIndex_1 = require("./core/workspaceIndex");
exports.FORTH_LANGUAGE = 'forth';
const FORTH_GLOB = '**/*.{fs,fth,4th,f,seq}';
const EXCLUDE_GLOB = '**/node_modules/**';
const CHANGE_DELAY_MS = 300;
function isForth(document) {
    return document.languageId === exports.FORTH_LANGUAGE;
}
function tokenRange(token) {
    return new vscode.Range(token.line, token.col, token.endLine, token.endCol);
}
function nameRange(definition) {
    return new vscode.Range(definition.line, definition.col, definition.line, definition.col + definition.name.length);
}
function fullRange(definition) {
    return new vscode.Range(definition.startLine, definition.startCol, definition.endLine, definition.endCol);
}
/** Keeps the workspace index in step with files on disk and with unsaved editor contents. */
class IndexService {
    index = new workspaceIndex_1.WorkspaceIndex();
    versions = new Map();
    timers = new Map();
    changeEmitter = new vscode.EventEmitter();
    disposables = [this.changeEmitter];
    /** Fires after the index has changed. */
    onDidChange = this.changeEmitter.event;
    /** False until the workspace has been indexed for the first time. */
    ready = false;
    constructor() {
        const watcher = vscode.workspace.createFileSystemWatcher(FORTH_GLOB);
        this.disposables.push(watcher, watcher.onDidChange(uri => void this.loadFromDisk(uri)), watcher.onDidCreate(uri => void this.loadFromDisk(uri)), watcher.onDidDelete(uri => this.forget(uri)), vscode.workspace.onDidOpenTextDocument(document => {
            if (!isForth(document))
                return;
            this.sync(document);
            this.changeEmitter.fire();
        }), vscode.workspace.onDidChangeTextDocument(event => {
            if (isForth(event.document))
                this.scheduleSync(event.document);
        }), vscode.workspace.onDidCloseTextDocument(document => {
            if (!isForth(document))
                return;
            this.cancelTimer(document.uri.toString());
            // Unsaved changes are gone now: fall back to the file on disk.
            if (vscode.workspace.getWorkspaceFolder(document.uri))
                void this.loadFromDisk(document.uri, true);
            else
                this.forget(document.uri);
        }));
    }
    /** Indexes all Forth files of the workspace and all open Forth documents. */
    async initialize() {
        const uris = await vscode.workspace.findFiles(FORTH_GLOB, EXCLUDE_GLOB);
        const entries = [];
        await Promise.all(uris.map(async (uri) => {
            const text = await this.read(uri);
            if (text !== undefined)
                entries.push([uri.toString(), text]);
        }));
        for (const document of vscode.workspace.textDocuments) {
            if (!isForth(document))
                continue;
            entries.push([document.uri.toString(), document.getText()]);
            this.versions.set(document.uri.toString(), document.version);
        }
        this.index.update(entries);
        this.ready = true;
        this.changeEmitter.fire();
    }
    /** Returns the parse result for the current contents of the document. */
    sync(document) {
        const key = document.uri.toString();
        let file = this.index.get(key);
        if (!file || this.versions.get(key) !== document.version) {
            this.index.update([[key, document.getText()]]);
            this.versions.set(key, document.version);
            file = this.index.get(key);
        }
        if (!file)
            throw new Error(`Forth document is not indexed: ${key}`);
        return file;
    }
    scheduleSync(document) {
        const key = document.uri.toString();
        this.cancelTimer(key);
        this.timers.set(key, setTimeout(() => {
            this.timers.delete(key);
            if (document.isClosed)
                return;
            this.sync(document);
            this.changeEmitter.fire();
        }, CHANGE_DELAY_MS));
    }
    cancelTimer(key) {
        const timer = this.timers.get(key);
        if (timer !== undefined)
            clearTimeout(timer);
        this.timers.delete(key);
    }
    async read(uri) {
        try {
            return new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
        }
        catch {
            return undefined;
        }
    }
    async loadFromDisk(uri, closed = false) {
        const key = uri.toString();
        // Open documents are the source of truth for their files.
        if (!closed && vscode.workspace.textDocuments.some(document => document.uri.toString() === key))
            return;
        const text = await this.read(uri);
        this.versions.delete(key);
        if (text === undefined)
            this.index.remove(key);
        else
            this.index.update([[key, text]]);
        this.changeEmitter.fire();
    }
    forget(uri) {
        const key = uri.toString();
        this.versions.delete(key);
        this.index.remove(key);
        this.changeEmitter.fire();
    }
    dispose() {
        for (const timer of this.timers.values())
            clearTimeout(timer);
        this.timers.clear();
        for (const disposable of this.disposables)
            disposable.dispose();
    }
}
exports.IndexService = IndexService;
//# sourceMappingURL=indexService.js.map