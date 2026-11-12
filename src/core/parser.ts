import { DEFINERS } from './builtins';
import { isNumber, tokenize, type Token } from './tokenizer';

export interface Definition {
  name: string;
  /** Lower-cased defining word, e.g. ":", "variable" or the name of a user-defined defining word. */
  kind: string;
  /** Position of the name. */
  line: number;
  col: number;
  /** Position of the defining word. */
  startLine: number;
  startCol: number;
  /** End of the definition (after ";" for colon definitions, otherwise after the name). */
  endLine: number;
  endCol: number;
  stackComment: string;
  doc: string;
  isColon: boolean;
  /** Token range of the body of a colon definition: [bodyStart, bodyEnd). */
  bodyStart: number;
  bodyEnd: number;
  locals: string[];
  immediate: boolean;
  hasDoes: boolean;
  /** The word defines new words when executed (it calls create, variable, ...). */
  definer: boolean;
  /** The word parses the next token of the input when executed. */
  parsing: boolean;
  /** Defined inside [if] ... [then], i.e. possibly an alternative or fallback definition. */
  conditional: boolean;
}

export interface Reference {
  name: string;
  line: number;
  col: number;
  /** Index into ParsedFile.tokens. */
  token: number;
  /** Index of the enclosing colon definition in ParsedFile.definitions, or -1. */
  def: number;
  /** The name refers to a local variable of the enclosing definition. */
  local: boolean;
  /** Do not report this reference as unknown (e.g. the operand of [defined]). */
  quiet: boolean;
}

export type Severity = 'error' | 'warning' | 'info';

export interface Problem {
  line: number;
  col: number;
  endCol: number;
  message: string;
  severity: Severity;
  code: string;
}

export interface Section {
  title: string;
  line: number;
}

export interface Include {
  path: string;
  line: number;
  col: number;
}

/** How the parser classified each token. */
export type TokenRole = 'other' | 'number' | 'ref' | 'name';

export interface ParsedFile {
  lines: string[];
  tokens: Token[];
  roles: TokenRole[];
  definitions: Definition[];
  references: Reference[];
  problems: Problem[];
  sections: Section[];
  includes: Include[];
}

/** Words defined elsewhere that influence how a file is parsed. */
export interface ParseContext {
  /** Lower-cased names of user-defined defining words. */
  definers: ReadonlySet<string>;
  /** Lower-cased names of user-defined words that parse the next token. */
  parsers: ReadonlySet<string>;
}

export const EMPTY_CONTEXT: ParseContext = { definers: new Set(), parsers: new Set() };

type ControlKind = 'orig' | 'dest' | 'do' | 'case' | 'of' | 'quotation';

interface ControlEntry {
  kind: ControlKind;
  token: Token;
}

const CLOSER_FOR: Record<ControlKind, string> = {
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
export function parseForth(text: string, context: ParseContext = EMPTY_CONTEXT): ParsedFile {
  const tokens = tokenize(text);
  const roles: TokenRole[] = new Array<TokenRole>(tokens.length).fill('other');
  const definitions: Definition[] = [];
  const references: Reference[] = [];
  const problems: Problem[] = [];
  const includes: Include[] = [];

  let current: Definition | null = null;
  let currentIndex = -1;
  let control: ControlEntry[] = [];
  let inCode = false;
  let hexDigits = false;
  const conditionals: Token[] = [];

  const problem = (token: Token, message: string, code: string, severity: Severity = 'error'): void => {
    problems.push({ line: token.line, col: token.col, endCol: token.endCol, message, severity, code });
  };

  const addReference = (index: number, quiet = false): void => {
    const token = tokens[index];
    roles[index] = 'ref';
    const local = current !== null && current.locals.includes(token.text.toLowerCase());
    references.push({ name: token.text, line: token.line, col: token.col, token: index, def: currentIndex, local, quiet });
  };

  const startDefinition = (definerIndex: number, nameIndex: number, kind: string, isColon: boolean): Definition => {
    const definer = tokens[definerIndex];
    const name = tokens[nameIndex];
    roles[nameIndex] = 'name';
    const next = tokens[nameIndex + 1];
    const definition: Definition = {
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

  const closeDefinition = (endIndex: number, endToken: Token): void => {
    if (!current) return;
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
  const closeControl = (token: Token, expected: ControlKind, opener: string): boolean => {
    const top = control[control.length - 1];
    if (top?.kind === expected) {
      control.pop();
      return true;
    }
    problem(token, `'${token.text}' ohne passendes ${opener}.`, 'unmatched-control');
    return false;
  };

  const handleControl = (lower: string, token: Token): void => {
    if (lower === 'if' || lower === 'ahead') {
      control.push({ kind: 'orig', token });
    } else if (lower === 'else') {
      if (closeControl(token, 'orig', "'if'")) control.push({ kind: 'orig', token });
    } else if (lower === 'then' || lower === 'endif') {
      closeControl(token, 'orig', "'if'");
    } else if (lower === 'begin') {
      control.push({ kind: 'dest', token });
    } else if (lower === 'until' || lower === 'again') {
      closeControl(token, 'dest', "'begin'");
    } else if (lower === 'while') {
      // Standard control-flow stack: the forward reference goes below the loop start.
      const dest = control[control.length - 1];
      if (dest?.kind === 'dest') {
        control.splice(control.length - 1, 0, { kind: 'orig', token });
      } else {
        problem(token, "'while' ohne passendes 'begin'.", 'unmatched-control');
      }
    } else if (lower === 'repeat') {
      if (closeControl(token, 'dest', "'begin'")) closeControl(token, 'orig', "'while'");
    } else if (DO_WORDS.has(lower)) {
      control.push({ kind: 'do', token });
    } else if (LOOP_WORDS.has(lower)) {
      closeControl(token, 'do', "'do'");
    } else if (lower === 'case') {
      control.push({ kind: 'case', token });
    } else if (lower === 'of' || lower === '?of') {
      if (control[control.length - 1]?.kind === 'case') {
        control.push({ kind: 'of', token });
      } else {
        problem(token, `'${token.text}' ohne passendes 'case'.`, 'unmatched-control');
      }
    } else if (lower === 'endof') {
      closeControl(token, 'of', "'of'");
    } else if (lower === 'endcase') {
      closeControl(token, 'case', "'case'");
    } else if (lower === '[:') {
      control.push({ kind: 'quotation', token });
    } else if (lower === ';]') {
      closeControl(token, 'quotation', "'[:'");
    }
  };

  // Reads a locals declaration; returns the index of its last token.
  const readLocals = (start: number, closers: ReadonlySet<string>, hasComment: boolean): number => {
    let index = start + 1;
    let inComment = false;
    for (; index < tokens.length; index++) {
      const token = tokens[index];
      if (token.kind !== 'word') continue;
      const lower = token.text.toLowerCase();
      if (closers.has(lower)) break;
      if (hasComment && lower === '--') inComment = true;
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
    if (token.kind !== 'word') continue;
    const lower = token.text.toLowerCase();
    const next: Token | undefined = tokens[index + 1];
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
        const open: Definition = current;
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
        const finished: Definition = current;
        closeDefinition(index, token);
        const following = tokens[index + 1];
        if (following?.kind === 'word' && following.text.toLowerCase() === 'immediate') finished.immediate = true;
      }
      continue;
    }

    if (lower === '[if]' && isDisabledBlock(tokens, index)) {
      // "0 [if] ... [then]" is commonly used to comment out code or free text.
      index = skipConditional(tokens, index);
      if (tokens[index]?.text.toLowerCase() === '[else]') conditionals.push(token);
      continue;
    }
    if (COND_OPEN.has(lower)) {
      conditionals.push(token);
    } else if (COND_CLOSE.has(lower)) {
      if (!conditionals.pop()) problem(token, `'${token.text}' ohne passendes '[if]'.`, 'unmatched-control');
    } else if (lower === '[else]' && conditionals.length === 0) {
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
      if (lower === 'does>' || lower === ';code') current.hasDoes = true;
      if (DEFINERS.has(lower) || context.definers.has(lower)) current.definer = true;
      else if (INPUT_PARSING_WORDS.has(lower)) current.parsing = true;
    } else {
      if (lower === 'does>' && definitions.length > 0) definitions[definitions.length - 1].hasDoes = true;
      if (lower === 'hex') hexDigits = true;
      else if (lower === 'decimal') hexDigits = false;

      if (DEFINERS.has(lower) && operand) {
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
        if (userDefiner) startDefinition(index, index + 1, lower, false);
        index++;
        continue;
      }
    }

    if (operand) {
      const owner = operand.operandOf ?? '';
      addReference(index);
      if (INCLUDE_WORDS.has(owner)) {
        includes.push({ path: operand.text, line: operand.line, col: operand.col });
      } else if (!CHAR_WORDS.has(owner)) {
        addReference(index + 1, QUIET_OPERANDS.has(owner));
      }
      index++;
      continue;
    }

    if (isNumber(token.text, hexDigits)) {
      roles[index] = 'number';
      continue;
    }

    addReference(index);
  }

  if (current) {
    const open: Definition = current;
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

function isDisabledBlock(tokens: Token[], ifIndex: number): boolean {
  const previous = tokens[ifIndex - 1];
  if (previous?.kind !== 'word') return false;
  const flag = previous.text.toLowerCase();
  return flag === '0' || flag === 'false';
}

/** Returns the index of the [else] or [then] that ends the block starting at the given [if]. */
function skipConditional(tokens: Token[], ifIndex: number): number {
  let depth = 0;
  for (let index = ifIndex + 1; index < tokens.length; index++) {
    if (tokens[index].kind !== 'word') continue;
    const lower = tokens[index].text.toLowerCase();
    if (COND_OPEN.has(lower)) depth++;
    else if (COND_CLOSE.has(lower)) {
      if (depth === 0) return index;
      depth--;
    } else if (lower === '[else]' && depth === 0) return index;
  }
  return tokens.length;
}

interface CommentLines {
  /** Comments that are alone on their line, by line number. */
  fullLine: Map<number, string>;
  /** Backslash comments that follow code, by line number. */
  trailing: Map<number, string>;
}

function collectComments(tokens: Token[]): CommentLines {
  const fullLine = new Map<number, string>();
  const trailing = new Map<number, string>();
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind !== 'lineComment' && token.kind !== 'parenComment') continue;
    const previous = tokens[index - 1];
    const next = tokens[index + 1];
    const first = !previous || previous.endLine < token.line;
    const last = !next || next.line > token.endLine;
    if (token.kind === 'lineComment') {
      (first ? fullLine : trailing).set(token.line, token.text);
    } else if (first && last && token.line === token.endLine) {
      fullLine.set(token.line, token.text);
    }
  }
  return { fullLine, trailing };
}

function stripComment(comment: string): string {
  return comment.replace(/^\\[gG]?\s?/, '').trim();
}

function findDoc(definition: Definition, fullLine: Map<number, string>, trailing: Map<number, string>): string {
  const sameLine = trailing.get(definition.startLine);
  if (sameLine) return stripComment(sameLine);

  const block: string[] = [];
  for (let line = definition.startLine - 1; line >= 0; line--) {
    const comment = fullLine.get(line);
    if (comment === undefined || SEPARATOR_LINE.test(comment)) break;
    block.unshift(stripComment(comment));
  }
  return block.join('\n').trim();
}

/**
 * Finds headings of the form: separator line, one title line, separator line.
 * Longer comment blocks between separators (such as a file header) are not headings.
 */
function findSections(fullLine: Map<number, string>, lineCount: number): Section[] {
  const sections: Section[] = [];
  for (let line = 0; line < lineCount; line++) {
    const comment = fullLine.get(line);
    if (comment === undefined || !SEPARATOR_LINE.test(comment)) continue;
    let title = '';
    let titleLine = -1;
    let textLines = 0;
    let end = line + 1;
    for (; end < lineCount; end++) {
      const inner = fullLine.get(end);
      if (inner === undefined) break;
      if (SEPARATOR_LINE.test(inner)) break;
      const stripped = stripComment(inner);
      if (stripped) textLines++;
      if (!title && stripped) {
        title = stripped;
        titleLine = end;
      }
    }
    const closed = end < lineCount && fullLine.get(end) !== undefined;
    if (!closed) continue;
    if (textLines === 1) sections.push({ title, line: titleLine });
    // The closing separator may open the next heading.
    line = end - 1;
  }
  return sections;
}
