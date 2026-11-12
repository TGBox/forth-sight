import { getBuiltin } from './builtins';
import { parseForth, type Definition, type ParseContext, type ParsedFile, type Reference } from './parser';
import { parseStackEffect, type StackEffect } from './stackComment';
import type { Token } from './tokenizer';

export interface DefinitionEntry {
  uri: string;
  /** Index into the definitions of the file. */
  index: number;
  definition: Definition;
}

export interface ReferenceEntry {
  uri: string;
  reference: Reference;
}

const ONE_CELL: StackEffect = { in: 0, out: 1 };
const KIND_EFFECTS: Record<string, StackEffect> = {
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

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

/** Data stack effect of calling a user-defined word, or null if it is not known. */
export function definitionEffect(definition: Definition): StackEffect | null {
  if (definition.immediate || definition.definer || definition.parsing || definition.hasDoes) return null;
  if (definition.isColon || definition.kind === 'defer' || definition.kind === 'code') {
    return parseStackEffect(definition.stackComment);
  }
  return KIND_EFFECTS[definition.kind] ?? null;
}

/** All parsed Forth files of a workspace, with lookups across files. Names are case-insensitive. */
export class WorkspaceIndex {
  private readonly texts = new Map<string, string>();
  private readonly files = new Map<string, ParsedFile>();
  private context: ParseContext = { definers: new Set(), parsers: new Set() };
  private byName: Map<string, DefinitionEntry[]> | null = null;

  /** Adds or replaces files and re-parses whatever depends on them. */
  update(entries: Iterable<readonly [uri: string, text: string]>): void {
    for (const [uri, text] of entries) {
      this.texts.set(uri, text);
      this.files.set(uri, parseForth(text, this.context));
    }
    this.settle();
  }

  remove(uri: string): void {
    if (!this.texts.delete(uri)) return;
    this.files.delete(uri);
    this.settle();
  }

  clear(): void {
    this.texts.clear();
    this.files.clear();
    this.context = { definers: new Set(), parsers: new Set() };
    this.byName = null;
  }

  // User-defined defining words change how every file is parsed, so parsing is
  // repeated until the set of such words no longer changes.
  private settle(): void {
    for (let round = 0; round < 5; round++) {
      const definers = new Set<string>();
      const parsers = new Set<string>();
      for (const file of this.files.values()) {
        for (const definition of file.definitions) {
          if (definition.definer) definers.add(definition.name.toLowerCase());
          else if (definition.parsing) parsers.add(definition.name.toLowerCase());
        }
      }
      if (sameSet(definers, this.context.definers) && sameSet(parsers, this.context.parsers)) break;
      this.context = { definers, parsers };
      for (const [uri, text] of this.texts) this.files.set(uri, parseForth(text, this.context));
    }
    this.byName = null;
  }

  has(uri: string): boolean {
    return this.files.has(uri);
  }

  get(uri: string): ParsedFile | undefined {
    return this.files.get(uri);
  }

  uris(): string[] {
    return [...this.files.keys()];
  }

  private definitionMap(): Map<string, DefinitionEntry[]> {
    if (!this.byName) {
      this.byName = new Map();
      for (const [uri, file] of this.files) {
        file.definitions.forEach((definition, index) => {
          const key = definition.name.toLowerCase();
          const list = this.byName?.get(key);
          if (list) list.push({ uri, index, definition });
          else this.byName?.set(key, [{ uri, index, definition }]);
        });
      }
    }
    return this.byName;
  }

  definitionsOf(name: string): DefinitionEntry[] {
    return this.definitionMap().get(name.toLowerCase()) ?? [];
  }

  allDefinitions(): DefinitionEntry[] {
    return [...this.definitionMap().values()].flat();
  }

  isDefined(name: string): boolean {
    return this.definitionMap().has(name.toLowerCase());
  }

  /** All uses of a global word (uses of same-named local variables are excluded). */
  referencesOf(name: string): ReferenceEntry[] {
    const key = name.toLowerCase();
    const result: ReferenceEntry[] = [];
    for (const [uri, file] of this.files) {
      for (const reference of file.references) {
        if (!reference.local && reference.name.toLowerCase() === key) result.push({ uri, reference });
      }
    }
    return result;
  }

  /** Data stack effect of a word as seen by callers, or null if unknown or ambiguous. */
  effectOf(lower: string): StackEffect | null {
    const entries = this.definitionsOf(lower);
    if (entries.length === 0) return getBuiltin(lower)?.effect ?? null;
    const effects = entries.map(entry => definitionEffect(entry.definition));
    const first = effects[0];
    if (!first || effects.some(effect => !effect || effect.in !== first.in || effect.out !== first.out)) return null;
    return first;
  }
}

/** Index of the token that contains the position, or -1. */
export function tokenIndexAt(file: ParsedFile, line: number, col: number): number {
  let low = 0;
  let high = file.tokens.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const token = file.tokens[middle];
    if (token.endLine < line || (token.endLine === line && token.endCol < col)) low = middle + 1;
    else if (token.line > line || (token.line === line && token.col > col)) high = middle - 1;
    else return middle;
  }
  return -1;
}

/** The word under the position, if it is code rather than a comment, string or number. */
export function wordAt(file: ParsedFile, line: number, col: number): { token: Token; index: number } | null {
  const index = tokenIndexAt(file, line, col);
  if (index < 0) return null;
  const token = file.tokens[index];
  if (token.kind !== 'word' && token.kind !== 'operand') return null;
  if (file.roles[index] === 'number') return null;
  if (token.kind === 'operand' && file.roles[index] === 'other') return null;
  return { token, index };
}

/** Index of the colon definition whose body contains the token, or -1. */
export function enclosingDefinition(file: ParsedFile, tokenIndex: number): number {
  return file.definitions.findIndex(
    definition => definition.isColon && tokenIndex >= definition.bodyStart && tokenIndex < definition.bodyEnd,
  );
}
