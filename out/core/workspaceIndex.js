"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceIndex = void 0;
exports.definitionEffect = definitionEffect;
exports.tokenIndexAt = tokenIndexAt;
exports.wordAt = wordAt;
exports.enclosingDefinition = enclosingDefinition;
const builtins_1 = require("./builtins");
const parser_1 = require("./parser");
const stackComment_1 = require("./stackComment");
const ONE_CELL = { in: 0, out: 1 };
const KIND_EFFECTS = {
    variable: ONE_CELL,
    '2variable': ONE_CELL,
    fvariable: ONE_CELL,
    create: ONE_CELL,
    'buffer:': ONE_CELL,
    user: ONE_CELL,
    constant: ONE_CELL,
    value: ONE_CELL,
    'begin-structure': ONE_CELL,
    '2constant': { in: 0, out: 2 },
    '2value': { in: 0, out: 2 },
    'field:': { in: 1, out: 1 },
    'cfield:': { in: 1, out: 1 },
    'ffield:': { in: 1, out: 1 },
    '2field:': { in: 1, out: 1 },
    '+field': { in: 1, out: 1 },
    marker: { in: 0, out: 0 },
};
function sameSet(a, b) {
    if (a.size !== b.size)
        return false;
    for (const item of a)
        if (!b.has(item))
            return false;
    return true;
}
/** Data stack effect of calling a user-defined word, or null if it is not known. */
function definitionEffect(definition) {
    if (definition.immediate || definition.definer || definition.parsing || definition.hasDoes)
        return null;
    if (definition.isColon || definition.kind === 'defer' || definition.kind === 'code') {
        return (0, stackComment_1.parseStackEffect)(definition.stackComment);
    }
    return KIND_EFFECTS[definition.kind] ?? null;
}
/** All parsed Forth files of a workspace, with lookups across files. Names are case-insensitive. */
class WorkspaceIndex {
    texts = new Map();
    files = new Map();
    context = { definers: new Set(), parsers: new Set() };
    byName = null;
    /** Adds or replaces files and re-parses whatever depends on them. */
    update(entries) {
        for (const [uri, text] of entries) {
            this.texts.set(uri, text);
            this.files.set(uri, (0, parser_1.parseForth)(text, this.context));
        }
        this.settle();
    }
    remove(uri) {
        if (!this.texts.delete(uri))
            return;
        this.files.delete(uri);
        this.settle();
    }
    clear() {
        this.texts.clear();
        this.files.clear();
        this.context = { definers: new Set(), parsers: new Set() };
        this.byName = null;
    }
    // User-defined defining words change how every file is parsed, so parsing is
    // repeated until the set of such words no longer changes.
    settle() {
        for (let round = 0; round < 5; round++) {
            const definers = new Set();
            const parsers = new Set();
            for (const file of this.files.values()) {
                for (const definition of file.definitions) {
                    if (definition.definer)
                        definers.add(definition.name.toLowerCase());
                    else if (definition.parsing)
                        parsers.add(definition.name.toLowerCase());
                }
            }
            if (sameSet(definers, this.context.definers) && sameSet(parsers, this.context.parsers))
                break;
            this.context = { definers, parsers };
            for (const [uri, text] of this.texts)
                this.files.set(uri, (0, parser_1.parseForth)(text, this.context));
        }
        this.byName = null;
    }
    has(uri) {
        return this.files.has(uri);
    }
    get(uri) {
        return this.files.get(uri);
    }
    uris() {
        return [...this.files.keys()];
    }
    definitionMap() {
        if (!this.byName) {
            this.byName = new Map();
            for (const [uri, file] of this.files) {
                file.definitions.forEach((definition, index) => {
                    const key = definition.name.toLowerCase();
                    const list = this.byName?.get(key);
                    if (list)
                        list.push({ uri, index, definition });
                    else
                        this.byName?.set(key, [{ uri, index, definition }]);
                });
            }
        }
        return this.byName;
    }
    definitionsOf(name) {
        return this.definitionMap().get(name.toLowerCase()) ?? [];
    }
    allDefinitions() {
        return [...this.definitionMap().values()].flat();
    }
    isDefined(name) {
        return this.definitionMap().has(name.toLowerCase());
    }
    /** All uses of a global word (uses of same-named local variables are excluded). */
    referencesOf(name) {
        const key = name.toLowerCase();
        const result = [];
        for (const [uri, file] of this.files) {
            for (const reference of file.references) {
                if (!reference.local && reference.name.toLowerCase() === key)
                    result.push({ uri, reference });
            }
        }
        return result;
    }
    /** Data stack effect of a word as seen by callers, or null if unknown or ambiguous. */
    effectOf(lower) {
        const entries = this.definitionsOf(lower);
        if (entries.length === 0)
            return (0, builtins_1.getBuiltin)(lower)?.effect ?? null;
        const effects = entries.map(entry => definitionEffect(entry.definition));
        const first = effects[0];
        if (!first || effects.some(effect => !effect || effect.in !== first.in || effect.out !== first.out))
            return null;
        return first;
    }
}
exports.WorkspaceIndex = WorkspaceIndex;
/** Index of the token that contains the position, or -1. */
function tokenIndexAt(file, line, col) {
    let low = 0;
    let high = file.tokens.length - 1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        const token = file.tokens[middle];
        if (token.endLine < line || (token.endLine === line && token.endCol < col))
            low = middle + 1;
        else if (token.line > line || (token.line === line && token.col > col))
            high = middle - 1;
        else
            return middle;
    }
    return -1;
}
/** The word under the position, if it is code rather than a comment, string or number. */
function wordAt(file, line, col) {
    const index = tokenIndexAt(file, line, col);
    if (index < 0)
        return null;
    const token = file.tokens[index];
    if (token.kind !== 'word' && token.kind !== 'operand')
        return null;
    if (file.roles[index] === 'number')
        return null;
    if (token.kind === 'operand' && file.roles[index] === 'other')
        return null;
    return { token, index };
}
/** Index of the colon definition whose body contains the token, or -1. */
function enclosingDefinition(file, tokenIndex) {
    return file.definitions.findIndex(definition => definition.isColon && tokenIndex >= definition.bodyStart && tokenIndex < definition.bodyEnd);
}
//# sourceMappingURL=workspaceIndex.js.map