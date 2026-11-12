"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeDefinition = analyzeDefinition;
const stackComment_1 = require("./stackComment");
const tokenizer_1 = require("./tokenizer");
/** Thrown when a definition cannot be analysed with certainty. */
class GiveUp extends Error {
}
// Words that end the analysis because their effect depends on compile-time state.
const UNSUPPORTED = new Set([
    'postpone', '[compile]', '[', ']', 'literal', '2literal', 'sliteral', 'fliteral', '[:', ';]',
    'does>', ';code', '[if]', '[else]', '[then]', '[endif]', '[ifdef]', '[ifundef]', 'ahead', '?of',
]);
const TERMINATORS = new Set(['abort', 'bye', 'quit']);
const STRING_EFFECTS = {
    's"': { in: 0, out: 2 },
    's\\"': { in: 0, out: 2 },
    '."': { in: 0, out: 0 },
    '.\\"': { in: 0, out: 0 },
    '.(': { in: 0, out: 0 },
    'c"': { in: 0, out: 1 },
    'abort"': { in: 1, out: 0 },
};
function signed(value) {
    return value > 0 ? `+${value}` : `${value}`;
}
/**
 * Compares the stack comment of a colon definition with the effect of its body.
 * Returns the mismatches found, or null if the definition cannot be analysed
 * reliably (unknown words, variable stack effects, compile-time tricks).
 */
function analyzeDefinition(file, definition, lookup) {
    if (!definition.isColon || definition.immediate || definition.hasDoes || definition.definer || definition.parsing) {
        return null;
    }
    const declared = (0, stackComment_1.parseStackEffect)(definition.stackComment);
    if (!declared)
        return null;
    const expected = declared.out - declared.in;
    const findings = [];
    const frames = [];
    const { tokens, roles } = file;
    let depth = 0;
    let lowest = 0;
    let dead = false;
    const apply = (effect) => {
        if (dead)
            return;
        depth -= effect.in;
        if (depth < lowest)
            lowest = depth;
        depth += effect.out;
    };
    const pop = (count) => apply({ in: count, out: 0 });
    const push = (count) => apply({ in: 0, out: count });
    const openFrame = (kind) => {
        const frame = { kind, entryDead: dead, depth, skipDepth: depth, ends: [], elseSeen: false, exitDepth: null };
        frames.push(frame);
        return frame;
    };
    const closeFrame = (kind) => {
        const frame = frames.pop();
        if (frame?.kind !== kind)
            throw new GiveUp();
        return frame;
    };
    const topFrame = (kind) => {
        const frame = frames[frames.length - 1];
        if (frame?.kind !== kind)
            throw new GiveUp();
        return frame;
    };
    // Continues after a set of alternative branches; reports branches of different depth.
    const merge = (frame, tokenIndex) => {
        if (frame.entryDead)
            return;
        const live = frame.ends.filter((end) => end !== 'dead');
        if (live.length === 0) {
            dead = true;
            return;
        }
        if (live.some(end => end !== live[0])) {
            const depths = [...new Set(live)].map(signed).join(' und ');
            const construct = frame.kind === 'case' ? 'case ... endcase' : 'if ... then';
            findings.push({
                token: tokenIndex,
                message: `Die Zweige von ${construct} hinterlassen unterschiedlich viele Werte auf dem Stack (Stack-Effekt bis hierher: ${depths}).`,
            });
            throw new GiveUp();
        }
        dead = false;
        depth = live[0];
    };
    // Skips comments and returns the lower-cased text of the word at or after the index.
    const wordAt = (index) => {
        for (let at = index; at < definition.bodyEnd; at++) {
            const kind = tokens[at].kind;
            if (kind === 'word')
                return tokens[at].text.toLowerCase();
            if (kind !== 'lineComment' && kind !== 'parenComment')
                break;
        }
        return '';
    };
    try {
        for (let index = definition.bodyStart; index < definition.bodyEnd; index++) {
            const token = tokens[index];
            if (token.kind === 'string') {
                if (token.literal)
                    push(2);
                continue;
            }
            if (token.kind !== 'word')
                continue;
            const lower = token.text.toLowerCase();
            const operand = tokens[index + 1]?.kind === 'operand' ? tokens[index + 1].text.toLowerCase() : null;
            if (roles[index] === 'number') {
                const cells = (0, tokenizer_1.numberCells)(token.text);
                if (cells === null)
                    throw new GiveUp();
                if (cells === 1 && wordAt(index + 1) === 'pick' && /^\d+$/.test(token.text)) {
                    // "n pick" needs n+1 values and adds one.
                    apply({ in: Number(token.text) + 1, out: Number(token.text) + 2 });
                    while (tokens[index].text.toLowerCase() !== 'pick')
                        index++;
                }
                else {
                    push(cells);
                }
                continue;
            }
            if (roles[index] === 'name')
                continue;
            if (UNSUPPORTED.has(lower))
                throw new GiveUp();
            switch (lower) {
                case '{:':
                case '{':
                case 'locals|': {
                    let count = 0;
                    let counting = true;
                    const closers = lower === 'locals|' ? ['|'] : [':}', '}'];
                    for (index++; index < definition.bodyEnd; index++) {
                        const inner = tokens[index].text.toLowerCase();
                        if (tokens[index].kind !== 'word')
                            continue;
                        if (closers.includes(inner))
                            break;
                        if (lower !== 'locals|' && (inner === '|' || inner === '--'))
                            counting = false;
                        else if (counting)
                            count++;
                    }
                    pop(count);
                    continue;
                }
                case 'if': {
                    pop(1);
                    openFrame('if');
                    continue;
                }
                case '?dup': {
                    // Only the idioms "?dup if" and "?dup 0= if" have a predictable effect.
                    const following = wordAt(index + 1);
                    let negated = false;
                    let at = index + 1;
                    if (following === '0=') {
                        negated = true;
                        while (tokens[at].text.toLowerCase() !== '0=')
                            at++;
                        at++;
                    }
                    if (wordAt(at) !== 'if')
                        throw new GiveUp();
                    while (tokens[at].text.toLowerCase() !== 'if')
                        at++;
                    index = at;
                    pop(1);
                    const frame = openFrame('if');
                    if (negated)
                        frame.skipDepth = depth + 1;
                    else
                        depth += 1;
                    frame.depth = depth;
                    continue;
                }
                case 'else': {
                    const frame = topFrame('if');
                    if (frame.elseSeen)
                        throw new GiveUp();
                    frame.elseSeen = true;
                    frame.ends.push(dead ? 'dead' : depth);
                    dead = frame.entryDead;
                    depth = frame.skipDepth;
                    continue;
                }
                case 'then':
                case 'endif': {
                    const frame = closeFrame('if');
                    frame.ends.push(dead ? 'dead' : depth);
                    if (!frame.elseSeen)
                        frame.ends.push(frame.skipDepth);
                    merge(frame, index);
                    continue;
                }
                case 'begin':
                    openFrame('begin');
                    continue;
                case 'while': {
                    pop(1);
                    const frame = topFrame('begin');
                    if (frame.exitDepth !== null)
                        throw new GiveUp();
                    frame.exitDepth = depth;
                    continue;
                }
                case 'repeat': {
                    const frame = closeFrame('begin');
                    if (frame.exitDepth === null || (!dead && depth !== frame.depth))
                        throw new GiveUp();
                    dead = frame.entryDead;
                    depth = frame.exitDepth;
                    continue;
                }
                case 'until': {
                    pop(1);
                    const frame = closeFrame('begin');
                    if (frame.exitDepth !== null || (!dead && depth !== frame.depth))
                        throw new GiveUp();
                    dead = frame.entryDead;
                    depth = frame.depth;
                    continue;
                }
                case 'again': {
                    const frame = closeFrame('begin');
                    if (frame.exitDepth !== null || (!dead && depth !== frame.depth))
                        throw new GiveUp();
                    dead = true;
                    continue;
                }
                case 'do':
                case '?do':
                case '+do':
                case '-do':
                case 'u+do':
                case 'u-do':
                    pop(2);
                    openFrame('do');
                    continue;
                case 'loop':
                case '+loop':
                case '-loop': {
                    if (lower !== 'loop')
                        pop(1);
                    const frame = closeFrame('do');
                    if (!dead && depth !== frame.depth)
                        throw new GiveUp();
                    dead = frame.entryDead;
                    depth = frame.depth;
                    continue;
                }
                case 'leave':
                    topDoFrame(frames);
                    dead = true;
                    continue;
                case '?leave':
                    topDoFrame(frames);
                    pop(1);
                    continue;
                case 'unloop':
                    continue;
                case 'case':
                    openFrame('case');
                    continue;
                case 'of': {
                    topFrame('case');
                    pop(2);
                    openFrame('of');
                    continue;
                }
                case 'endof': {
                    closeFrame('of');
                    const frame = topFrame('case');
                    frame.ends.push(dead ? 'dead' : depth);
                    dead = frame.entryDead;
                    depth = frame.depth;
                    continue;
                }
                case 'endcase': {
                    pop(1);
                    const frame = closeFrame('case');
                    frame.ends.push(dead ? 'dead' : depth);
                    merge(frame, index);
                    continue;
                }
                case 'exit': {
                    if (!dead && depth !== expected) {
                        findings.push({
                            token: index,
                            message: `Stack-Effekt bei exit ist ${signed(depth)}, der Stack-Kommentar ${definition.stackComment} ergibt ${signed(expected)}.`,
                        });
                    }
                    dead = true;
                    continue;
                }
                case 'recurse':
                    apply(declared);
                    continue;
                case 'throw':
                    pop(1);
                    continue;
                case '[char]':
                case "[']":
                case 'action-of':
                    push(1);
                    index++;
                    continue;
                case 'is':
                    pop(1);
                    index++;
                    continue;
                case 'to':
                case '+to': {
                    const target = operand && !definition.locals.includes(operand) ? lookup(operand) : { in: 0, out: 1 };
                    if (!target)
                        throw new GiveUp();
                    pop(target.out);
                    index++;
                    continue;
                }
                default:
                    break;
            }
            if (TERMINATORS.has(lower)) {
                dead = true;
                continue;
            }
            const stringEffect = STRING_EFFECTS[lower];
            if (stringEffect) {
                apply(stringEffect);
                continue;
            }
            // User-defined string words such as feld" act at compile time or at run time.
            if ((0, tokenizer_1.isStringWord)(lower) || operand !== null)
                throw new GiveUp();
            const effect = definition.locals.includes(lower) ? { in: 0, out: 1 } : lookup(lower);
            if (!effect)
                throw new GiveUp();
            apply(effect);
        }
        if (frames.length > 0)
            throw new GiveUp();
    }
    catch (error) {
        if (error instanceof GiveUp)
            return findings.length > 0 ? findings : null;
        throw error;
    }
    if (!dead && depth !== expected) {
        findings.push({
            token: -1,
            message: `Stack-Effekt des Rumpfs ist ${signed(depth)}, der Stack-Kommentar ${definition.stackComment} ergibt ${signed(expected)}.`,
        });
    }
    else if (lowest < -declared.in) {
        findings.push({
            token: -1,
            message: `Der Rumpf greift auf ${-lowest} Stackwerte zu, der Stack-Kommentar ${definition.stackComment} nennt nur ${declared.in}.`,
        });
    }
    return findings;
}
function topDoFrame(frames) {
    if (!frames.some(frame => frame.kind === 'do'))
        throw new GiveUp();
}
//# sourceMappingURL=stackAnalysis.js.map