import { DEFINERS, IMMEDIATE_PARSERS, INTERPRET_PARSERS, STRING_WORDS } from './builtins';

export type TokenKind =
  /** An ordinary whitespace-delimited word or number. */
  | 'word'
  /** The token consumed by a parsing word, e.g. the name after ":" or the character after "[char]". */
  | 'operand'
  /** A backslash comment running to the end of the line. */
  | 'lineComment'
  /** A parenthesis comment. */
  | 'parenComment'
  /** The text of a string, without its delimiters. */
  | 'string';

export interface Token {
  kind: TokenKind;
  text: string;
  line: number;
  col: number;
  endLine: number;
  endCol: number;
  /** For operands: the lower-cased parsing word that consumed this token. */
  operandOf?: string;
  /** For strings: true for gforth string literals ("text") that have no leading string word. */
  literal?: boolean;
}

const WHITESPACE = /\s/;

/** True for words such as s" or a user-defined feld" that parse a string up to the next quote. */
export function isStringWord(lower: string): boolean {
  return STRING_WORDS.has(lower) || (lower.length > 1 && lower.endsWith('"') && !lower.startsWith('"'));
}

/**
 * Splits Forth source into tokens. Because Forth has no fixed syntax, the tokenizer
 * follows the standard parsing words (comments, strings, defining words) and tracks
 * whether it is inside a colon definition, where non-immediate parsing words do not parse.
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const length = text.length;
  let offset = 0;
  let line = 0;
  let lineStart = 0;
  let compiling = false;
  let pendingOperand: string | null = null;

  // Advances the line bookkeeping up to the given offset (offsets only ever grow).
  let scanned = 0;
  const syncLine = (target: number): void => {
    for (; scanned < target; scanned++) {
      if (text.charCodeAt(scanned) === 10) {
        line++;
        lineStart = scanned + 1;
      }
    }
  };

  const push = (kind: TokenKind, start: number, end: number, extra?: Partial<Token>): void => {
    syncLine(start);
    const startLine = line;
    const startCol = start - lineStart;
    syncLine(end);
    tokens.push({
      kind,
      text: text.slice(start, end),
      line: startLine,
      col: startCol,
      endLine: line,
      endCol: end - lineStart,
      ...extra,
    });
  };

  const endOfLine = (from: number): number => {
    let end = text.indexOf('\n', from);
    if (end < 0) end = length;
    if (end > from && text.charCodeAt(end - 1) === 13) end--;
    return end;
  };

  // Reads a string body starting at `from` up to the closing quote on the same line.
  const readString = (from: number, escapes: boolean, extra?: Partial<Token>): number => {
    const limit = endOfLine(from);
    let end = from;
    while (end < limit && text[end] !== '"') {
      if (escapes && text[end] === '\\' && end + 1 < limit) end++;
      end++;
    }
    push('string', from, end, extra);
    return end < limit ? end + 1 : end;
  };

  while (offset < length) {
    while (offset < length && WHITESPACE.test(text[offset])) offset++;
    if (offset >= length) break;

    const start = offset;
    while (offset < length && !WHITESPACE.test(text[offset])) offset++;
    const lower = text.slice(start, offset).toLowerCase();

    if (pendingOperand !== null) {
      push('operand', start, offset, { operandOf: pendingOperand });
      pendingOperand = null;
      continue;
    }

    if (lower === '\\' || lower === '\\g' || (lower.startsWith('#!') && start === 0)) {
      offset = endOfLine(start);
      push('lineComment', start, offset);
      continue;
    }

    if (lower === '(') {
      const close = text.indexOf(')', offset);
      offset = close < 0 ? length : close + 1;
      push('parenComment', start, offset);
      continue;
    }

    if (lower === '.(') {
      push('word', start, offset);
      const from = Math.min(offset + 1, length);
      const close = text.indexOf(')', from);
      const end = close < 0 ? length : close;
      push('string', from, end);
      offset = Math.min(end + 1, length);
      continue;
    }

    if (lower.startsWith('"') && lower.length > 1) {
      // gforth string literal: "text" (may contain spaces).
      if (lower.endsWith('"')) {
        push('string', start + 1, offset - 1, { literal: true });
      } else {
        offset = readString(start + 1, true, { literal: true });
      }
      continue;
    }

    push('word', start, offset);

    if (isStringWord(lower)) {
      // Exactly one delimiter character follows the string word.
      const from = offset < length && text[offset] !== '\n' && text[offset] !== '\r' ? offset + 1 : offset;
      offset = readString(Math.min(from, length), lower.includes('\\'));
      continue;
    }

    if (lower === ':') {
      compiling = true;
      pendingOperand = lower;
    } else if (lower === ':noname' || lower === ']') {
      compiling = true;
    } else if (lower === ';' || lower === '[') {
      compiling = false;
    } else if (IMMEDIATE_PARSERS.has(lower)) {
      pendingOperand = lower;
    } else if (!compiling && (DEFINERS.has(lower) || INTERPRET_PARSERS.has(lower))) {
      pendingOperand = lower;
    }
  }

  return tokens;
}

const DECIMAL = /^[-+]?\d+\.?\d*$/;
const FLOAT = /^[-+]?\d+\.?\d*e[-+]?\d*$/i;
const PREFIXED = /^(\$-?[0-9a-f]+|0x[0-9a-f]+|#-?\d+|&-?\d+|%-?[01]+)\.?$/i;
const CHAR_LITERAL = /^'.'?$/u;
const HEX_DIGITS = /^-?[0-9a-f]+\.?$/i;

/** True if the token is a number literal (hexDigits: the current base is assumed to be 16). */
export function isNumber(text: string, hexDigits = false): boolean {
  return (
    DECIMAL.test(text) ||
    FLOAT.test(text) ||
    PREFIXED.test(text) ||
    (text.length > 1 && CHAR_LITERAL.test(text)) ||
    (hexDigits && HEX_DIGITS.test(text))
  );
}

/** Number of data stack cells a number literal occupies, or null for float literals. */
export function numberCells(text: string): number | null {
  if (FLOAT.test(text) && !PREFIXED.test(text)) return null;
  if (CHAR_LITERAL.test(text)) return 1;
  return text.includes('.') ? 2 : 1;
}
