"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPTY_CONTEXT = void 0;
exports.parseForth = parseForth;
const builtins_1 = require("./builtins");
const tokenizer_1 = require("./tokenizer");
exports.EMPTY_CONTEXT = { definers: new Set(), parsers: new Set() };
const CLOSER_FOR = {
    orig: 'then',
    dest: 'until, again oder repeat',
    do: 'loop oder +loop',
    case: 'endcase',
    of: 'endof',
    quotation: ';]',
};
const DO_WORDS = new Set(['do', '?do', '+do', '-do', 'u+do', 'u-do']);
const LOOP_WORDS = new Set(['loop', '+loop', '-loop']);
const COND_OPEN = new Set(['[if]', '[ifdef]', '[ifundef]']);
const COND_CLOSE = new Set(['[then]', '[endif]']);
const INPUT_PARSING_WORDS = new Set(['parse-name', 'parse', 'word', 'name']);
const QUIET_OPERANDS = new Set(['[defined]', '[undefined]', '[ifdef]', '[ifundef]', 'see', 'locate', 'forget']);
const INCLUDE_WORDS = new Set(['include', 'require', 'needs']);
const CHAR_WORDS = new Set(['char', '[char]']);
const SEPARATOR_LINE = /^\\\s*[-=*#_~]{6,}\s*$/;
/** Parses Forth source into definitions, references and structural problems. */
function parseForth(text, context = exports.EMPTY_CONTEXT) {
    const tokens = (0, tokenizer_1.tokenize)(text);
    const roles = new Array(tokens.length).fill('other');
    const definitions = [];
    const references = [];
    const problems = [];
    const includes = [];
    let current = null;
    let currentIndex = -1;
    let control = [];
    let inCode = false;
    let hexDigits = false;
    const conditionals = [];
    const problem = (token, message, code, severity = 'error') => {
        problems.push({ line: token.line, col: token.col, endCol: token.endCol, message, severity, code });
    };
    const addReference = (index, quiet = false) => {
        const token = tokens[index];
        roles[index] = 'ref';
        const local = current !== null && current.locals.includes(token.text.toLowerCase());
        references.push({ name: token.text, line: token.line, col: token.col, token: index, def: currentIndex, local, quiet });
    };
    const startDefinition = (definerIndex, nameIndex, kind, isColon) => {
        const definer = tokens[definerIndex];
        const name = tokens[nameIndex];
        roles[nameIndex] = 'name';
        const next = tokens[nameIndex + 1];
        const definition = {
            name: name.text,
            kind,
            line: name.line,
            col: name.col,
            startLine: definer.line,
            startCol: definer.col,
            endLine: name.endLine,
            endCol: name.endCol,
            stackComment: next?.kind === 'parenComment' ? next.text : '',
            doc: '',
            isColon,
            bodyStart: nameIndex + 1,
            bodyEnd: nameIndex + 1,
            locals: [],
            immediate: false,
            hasDoes: false,
            definer: false,
            parsing: false,
            conditional: conditionals.length > 0,
        };
        definitions.push(definition);
        return definition;
    };
    const closeDefinition = (endIndex, endToken) => {
        if (!current)
            return;
        for (const entry of control) {
            const word = entry.token.text;
            problem(entry.token, `'${word}' wird nicht mit ${CLOSER_FOR[entry.kind]} abgeschlossen.`, 'unclosed-control');
        }
        current.bodyEnd = endIndex;
        current.endLine = endToken.endLine;
        current.endCol = endToken.endCol;
        current = null;
        currentIndex = -1;
        control = [];
    };
    // Pops the control-flow stack if its top entry has the expected kind.
    const closeControl = (token, expected, opener) => {
        const top = control[control.length - 1];
        if (top?.kind === expected) {
            control.pop();
            return true;
        }
        problem(token, `'${token.text}' ohne passendes ${opener}.`, 'unmatched-control');
        return false;
    };
    const handleControl = (lower, token) => {
        if (lower === 'if' || lower === 'ahead') {
            control.push({ kind: 'orig', token });
        }
        else if (lower === 'else') {
            if (closeControl(token, 'orig', "'if'"))
                control.push({ kind: 'orig', token });
        }
        else if (lower === 'then' || lower === 'endif') {
            closeControl(token, 'orig', "'if'");
        }
        else if (lower === 'begin') {
            control.push({ kind: 'dest', token });
        }
        else if (lower === 'until' || lower === 'again') {
            closeControl(token, 'dest', "'begin'");
        }
        else if (lower === 'while') {
            // Standard control-flow stack: the forward reference goes below the loop start.
            const dest = control[control.length - 1];
            if (dest?.kind === 'dest') {
                control.splice(control.length - 1, 0, { kind: 'orig', token });
            }
            else {
                problem(token, "'while' ohne passendes 'begin'.", 'unmatched-control');
            }
        }
        else if (lower === 'repeat') {
            if (closeControl(token, 'dest', "'begin'"))
                closeControl(token, 'orig', "'while'");
        }
        else if (DO_WORDS.has(lower)) {
            control.push({ kind: 'do', token });
        }
        else if (LOOP_WORDS.has(lower)) {
            closeControl(token, 'do', "'do'");
        }
        else if (lower === 'case') {
            control.push({ kind: 'case', token });
        }
        else if (lower === 'of' || lower === '?of') {
            if (control[control.length - 1]?.kind === 'case') {
                control.push({ kind: 'of', token });
            }
            else {
                problem(token, `'${token.text}' ohne passendes 'case'.`, 'unmatched-control');
            }
        }
        else if (lower === 'endof') {
            closeControl(token, 'of', "'of'");
        }
        else if (lower === 'endcase') {
            closeControl(token, 'case', "'case'");
        }
        else if (lower === '[:') {
            control.push({ kind: 'quotation', token });
        }
        else if (lower === ';]') {
            closeControl(token, 'quotation', "'[:'");
        }
    };
    // Reads a locals declaration; returns the index of its last token.
    const readLocals = (start, closers, hasComment) => {
        let index = start + 1;
        let inComment = false;
        for (; index < tokens.length; index++) {
            const token = tokens[index];
            if (token.kind !== 'word')
                continue;
            const lower = token.text.toLowerCase();
            if (closers.has(lower))
                break;
            if (hasComment && lower === '--')
                inComment = true;
            else if (!inComment && lower !== '|' && current) {
                current.locals.push(lower);
                roles[index] = 'name';
                references.push({ name: token.text, line: token.line, col: token.col, token: index, def: currentIndex, local: true, quiet: true });
            }
        }
        return index;
    };
    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        if (token.kind !== 'word')
            continue;
        const lower = token.text.toLowerCase();
        const next = tokens[index + 1];
        const operand = next?.kind === 'operand' ? next : undefined;
        if (inCode) {
            if (lower === 'end-code') {
                inCode = false;
                closeDefinition(index, token);
            }
            continue;
        }
        if (lower === ':') {
            if (current) {
                const open = current;
                problems.push({
                    line: open.line,
                    col: open.col,
                    endCol: open.col + open.name.length,
                    message: `Definition '${open.name || ':noname'}' ist nicht mit ';' abgeschlossen.`,
                    severity: 'error',
                    code: 'unclosed-definition',
                });
                closeDefinition(index, tokens[index - 1] ?? token);
            }
            if (operand) {
                current = startDefinition(index, index + 1, ':', true);
                currentIndex = definitions.length - 1;
                index++;
            }
            continue;
        }
        if (lower === ':noname' && !current) {
            // Anonymous definition: tracked for structure checks, but not listed.
            current = startDefinition(index, index, ':noname', true);
            current.name = '';
            roles[index] = 'other';
            definitions.pop();
            currentIndex = -1;
            continue;
        }
        if (lower === ';') {
            if (current) {
                const finished = current;
                closeDefinition(index, token);
                const following = tokens[index + 1];
                if (following?.kind === 'word' && following.text.toLowerCase() === 'immediate')
                    finished.immediate = true;
            }
            continue;
        }
        if (lower === '[if]' && isDisabledBlock(tokens, index)) {
            // "0 [if] ... [then]" is commonly used to comment out code or free text.
            index = skipConditional(tokens, index);
            if (tokens[index]?.text.toLowerCase() === '[else]')
                conditionals.push(token);
            continue;
        }
        if (COND_OPEN.has(lower)) {
            conditionals.push(token);
        }
        else if (COND_CLOSE.has(lower)) {
            if (!conditionals.pop())
                problem(token, `'${token.text}' ohne passendes '[if]'.`, 'unmatched-control');
        }
        else if (lower === '[else]' && conditionals.length === 0) {
            problem(token, "'[else]' ohne passendes '[if]'.", 'unmatched-control');
        }
        if (current) {
            if (lower === '{:' || lower === '{') {
                index = readLocals(index, new Set([':}', '}']), true);
                continue;
            }
            if (lower === 'locals|') {
                index = readLocals(index, new Set(['|']), false);
                continue;
            }
            handleControl(lower, token);
            if (lower === 'does>' || lower === ';code')
                current.hasDoes = true;
            if (builtins_1.DEFINERS.has(lower) || context.definers.has(lower))
                current.definer = true;
            else if (INPUT_PARSING_WORDS.has(lower))
                current.parsing = true;
        }
        else {
            if (lower === 'does>' && definitions.length > 0)
                definitions[definitions.length - 1].hasDoes = true;
            if (lower === 'hex')
                hexDigits = true;
            else if (lower === 'decimal')
                hexDigits = false;
            if (builtins_1.DEFINERS.has(lower) && operand) {
                addReference(index);
                startDefinition(index, index + 1, lower, false);
                if (lower === 'code') {
                    current = definitions[definitions.length - 1];
                    currentIndex = definitions.length - 1;
                    inCode = true;
                }
                index++;
                continue;
            }
            const userDefiner = context.definers.has(lower);
            if ((userDefiner || context.parsers.has(lower)) && next?.kind === 'word' && next.line === token.line) {
                addReference(index);
                if (userDefiner)
                    startDefinition(index, index + 1, lower, false);
                index++;
                continue;
            }
        }
        if (operand) {
            const owner = operand.operandOf ?? '';
            addReference(index);
            if (INCLUDE_WORDS.has(owner)) {
                includes.push({ path: operand.text, line: operand.line, col: operand.col });
            }
            else if (!CHAR_WORDS.has(owner)) {
                addReference(index + 1, QUIET_OPERANDS.has(owner));
            }
            index++;
            continue;
        }
        if ((0, tokenizer_1.isNumber)(token.text, hexDigits)) {
            roles[index] = 'number';
            continue;
        }
        addReference(index);
    }
    if (current) {
        const open = current;
        if (open.name) {
            problems.push({
                line: open.line,
                col: open.col,
                endCol: open.col + open.name.length,
                message: `Definition '${open.name}' ist nicht mit ';' abgeschlossen.`,
                severity: 'error',
                code: 'unclosed-definition',
            });
        }
        closeDefinition(tokens.length, tokens[tokens.length - 1]);
    }
    for (const token of conditionals) {
        problem(token, `'${token.text}' wird nicht mit [then] abgeschlossen.`, 'unclosed-control');
    }
    const lines = text.split(/\r?\n/);
    const { fullLine, trailing } = collectComments(tokens);
    for (const definition of definitions) {
        definition.doc = findDoc(definition, fullLine, trailing);
    }
    return {
        lines,
        tokens,
        roles,
        definitions,
        references,
        problems,
        sections: findSections(fullLine, lines.length),
        includes,
    };
}
function isDisabledBlock(tokens, ifIndex) {
    const previous = tokens[ifIndex - 1];
    if (previous?.kind !== 'word')
        return false;
    const flag = previous.text.toLowerCase();
    return flag === '0' || flag === 'false';
}
/** Returns the index of the [else] or [then] that ends the block starting at the given [if]. */
function skipConditional(tokens, ifIndex) {
    let depth = 0;
    for (let index = ifIndex + 1; index < tokens.length; index++) {
        if (tokens[index].kind !== 'word')
            continue;
        const lower = tokens[index].text.toLowerCase();
        if (COND_OPEN.has(lower))
            depth++;
        else if (COND_CLOSE.has(lower)) {
            if (depth === 0)
                return index;
            depth--;
        }
        else if (lower === '[else]' && depth === 0)
            return index;
    }
    return tokens.length;
}
function collectComments(tokens) {
    const fullLine = new Map();
    const trailing = new Map();
    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        if (token.kind !== 'lineComment' && token.kind !== 'parenComment')
            continue;
        const previous = tokens[index - 1];
        const next = tokens[index + 1];
        const first = !previous || previous.endLine < token.line;
        const last = !next || next.line > token.endLine;
        if (token.kind === 'lineComment') {
            (first ? fullLine : trailing).set(token.line, token.text);
        }
        else if (first && last && token.line === token.endLine) {
            fullLine.set(token.line, token.text);
        }
    }
    return { fullLine, trailing };
}
function stripComment(comment) {
    return comment.replace(/^\\[gG]?\s?/, '').trim();
}
function findDoc(definition, fullLine, trailing) {
    const sameLine = trailing.get(definition.startLine);
    if (sameLine)
        return stripComment(sameLine);
    const block = [];
    for (let line = definition.startLine - 1; line >= 0; line--) {
        const comment = fullLine.get(line);
        if (comment === undefined || SEPARATOR_LINE.test(comment))
            break;
        block.unshift(stripComment(comment));
    }
    return block.join('\n').trim();
}
/**
 * Finds headings of the form: separator line, one title line, separator line.
 * Longer comment blocks between separators (such as a file header) are not headings.
 */
function findSections(fullLine, lineCount) {
    const sections = [];
    for (let line = 0; line < lineCount; line++) {
        const comment = fullLine.get(line);
        if (comment === undefined || !SEPARATOR_LINE.test(comment))
            continue;
        let title = '';
        let titleLine = -1;
        let textLines = 0;
        let end = line + 1;
        for (; end < lineCount; end++) {
            const inner = fullLine.get(end);
            if (inner === undefined)
                break;
            if (SEPARATOR_LINE.test(inner))
                break;
            const stripped = stripComment(inner);
            if (stripped)
                textLines++;
            if (!title && stripped) {
                title = stripped;
                titleLine = end;
            }
        }
        const closed = end < lineCount && fullLine.get(end) !== undefined;
        if (!closed)
            continue;
        if (textLines === 1)
            sections.push({ title, line: titleLine });
        // The closing separator may open the next heading.
        line = end - 1;
    }
    return sections;
}
//# sourceMappingURL=parser.js.map