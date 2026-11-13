import type { WorkspaceIndex } from './workspaceIndex';

/** A word as stored in a dictionary file. The keys match the [[builtin.words]] tables of forth-lsp. */
export interface DictionaryEntry {
  word: string;
  /** Stack comment including the parentheses, e.g. "( x -- x x )". */
  stack?: string;
  description?: string;
  /** Where the word is defined, e.g. "utils/PD.F:3604". */
  source?: string;
}

/** A word known from a dictionary, in one spelling. */
export interface DictionaryWord {
  name: string;
  stack: string;
  description: string;
  source: string;
  /** Name of the dictionary the word was first listed in. */
  dictionary: string;
}

/**
 * Words that are known without their source being indexed. Lookups are case-insensitive,
 * but every spelling is kept with its own details: systems that distinguish case may
 * define "az-pat" and "AZ-PAT" as different words.
 */
export class Dictionary {
  /** Spellings of each word, by lower-cased name. */
  private readonly words = new Map<string, DictionaryWord[]>();

  /** Adds entries. Known spellings keep what they have and only gain the details they lack. */
  add(entries: Iterable<DictionaryEntry>, dictionary: string): void {
    for (const entry of entries) {
      const name = entry.word.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const spellings = this.words.get(key);
      const known = spellings?.find(word => word.name === name);
      if (known) {
        known.stack ||= entry.stack?.trim() ?? '';
        known.description ||= entry.description?.trim() ?? '';
        known.source ||= entry.source?.trim() ?? '';
        continue;
      }
      const word: DictionaryWord = {
        name,
        stack: entry.stack?.trim() ?? '',
        description: entry.description?.trim() ?? '',
        source: entry.source?.trim() ?? '',
        dictionary,
      };
      if (spellings) spellings.push(word);
      else this.words.set(key, [word]);
    }
  }

  /** Adds bare names, e.g. from a word list file. */
  addNames(names: Iterable<string>, dictionary: string): void {
    const entries: DictionaryEntry[] = [];
    for (const word of names) entries.push({ word });
    this.add(entries, dictionary);
  }

  /** Number of words, counting spellings that differ only in case once. */
  get size(): number {
    return this.words.size;
  }

  has(name: string): boolean {
    return this.words.has(name.toLowerCase());
  }

  /** The word in exactly this spelling or, failing that, in the spelling listed first. */
  get(name: string): DictionaryWord | undefined {
    const spellings = this.words.get(name.toLowerCase());
    return spellings?.find(word => word.name === name) ?? spellings?.[0];
  }

  /** All spellings whose name starts with the prefix (case-insensitive), in alphabetical order. */
  startingWith(prefix: string, limit: number): DictionaryWord[] {
    const lower = prefix.toLowerCase();
    const keys = [...this.words.keys()].filter(key => key.startsWith(lower)).sort();
    const result: DictionaryWord[] = [];
    for (const key of keys) {
      result.push(...(this.words.get(key) ?? []));
      if (result.length >= limit) break;
    }
    return result.slice(0, limit);
  }

  /** Lower-cased names starting with a double quote; they affect how source is tokenized. */
  quoteWords(): string[] {
    return [...this.words.keys()].filter(key => key.startsWith('"') && key.length > 1);
  }
}

/** Reads a word list: names separated by whitespace, as printed by WORDS. */
export function parseWordList(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function toEntry(value: unknown): DictionaryEntry | null {
  if (typeof value === 'string') return value.trim() ? { word: value } : null;
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const word = optionalString(record.word);
  if (!word) return null;
  return {
    word,
    stack: optionalString(record.stack),
    description: optionalString(record.description),
    source: optionalString(record.source),
  };
}

/**
 * Reads a dictionary file: { "words": [ { "word", "stack", "description", "source" } ] }.
 * A plain array is accepted as well, and so are bare names in place of objects.
 */
export function parseDictionaryJson(text: string): DictionaryEntry[] {
  const data: unknown = JSON.parse(text);
  const list: unknown = Array.isArray(data) ? data : (data as { words?: unknown } | null)?.words;
  if (!Array.isArray(list)) return [];
  return list.map(toEntry).filter((entry): entry is DictionaryEntry => entry !== null);
}

/** Writes a dictionary file with one word per line, sorted by name. */
export function serializeDictionary(entries: readonly DictionaryEntry[]): string {
  const sorted = [...entries].sort((a, b) => {
    const left = a.word.toLowerCase();
    const right = b.word.toLowerCase();
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const lines = sorted.map(entry => {
    const compact: DictionaryEntry = { word: entry.word };
    if (entry.stack) compact.stack = entry.stack;
    if (entry.description) compact.description = entry.description;
    if (entry.source) compact.source = entry.source;
    return `    ${JSON.stringify(compact)}`;
  });
  return `{\n  "words": [\n${lines.join(',\n')}\n  ]\n}\n`;
}

export interface MergeResult {
  entries: DictionaryEntry[];
  /** Number of words that were not in the dictionary before. */
  added: number;
  /** Number of known words that gained a stack comment, description or source. */
  completed: number;
}

/**
 * Extends a dictionary: existing details are kept, missing ones filled in, new words appended.
 * Spellings that differ in case are separate entries.
 */
export function mergeEntries(existing: readonly DictionaryEntry[], additions: Iterable<DictionaryEntry>): MergeResult {
  const byName = new Map<string, DictionaryEntry>();
  for (const entry of existing) {
    if (!byName.has(entry.word)) byName.set(entry.word, { ...entry });
  }
  let added = 0;
  const completed = new Set<string>();
  for (const addition of additions) {
    const key = addition.word;
    const known = byName.get(key);
    if (!known) {
      byName.set(key, { ...addition });
      added++;
      continue;
    }
    for (const field of ['stack', 'description', 'source'] as const) {
      if (!known[field] && addition[field]) {
        known[field] = addition[field];
        completed.add(key);
      }
    }
  }
  return { entries: [...byName.values()], added, completed: completed.size };
}

/** The parts of a forth-lsp configuration (.forth-lsp.toml) that list additional words. */
export interface ForthLspWords {
  /** Paths of word list files, relative to the workspace root or absolute. */
  wordFiles: string[];
  words: DictionaryEntry[];
}

function tomlString(raw: string): string | undefined {
  const value = raw.trim();
  if (value.length < 2) return undefined;
  const quote = value[0];
  if ((quote !== '"' && quote !== "'") || !value.endsWith(quote)) return undefined;
  const inner = value.slice(1, -1);
  // Literal strings ('...') have no escapes; basic strings ("...") use backslash escapes.
  return quote === "'" ? inner : inner.replace(/\\(["\\])/g, '$1');
}

/**
 * Reads [builtin] word_files and the [[builtin.words]] tables of a forth-lsp configuration.
 * Only these parts are understood; this is not a general TOML parser.
 */
export function parseForthLspConfig(text: string): ForthLspWords {
  const result: ForthLspWords = { wordFiles: [], words: [] };
  let section = '';
  let current: Record<string, string> | null = null;

  const finish = (): void => {
    if (current?.word) result.words.push({ ...current, word: current.word });
    current = null;
  };

  // Arrays may span several lines.
  const joined = text.replace(/\[([^\][]*)\]/g, match => match.replace(/\r?\n/g, ' '));
  for (const raw of joined.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const header = /^\[{1,2}([^\][]+)\]{1,2}\s*(#.*)?$/.exec(line);
    if (header) {
      finish();
      section = header[1].trim();
      if (line.startsWith('[[') && section === 'builtin.words') current = {};
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(line);
    if (!pair) continue;
    const [, key, value] = pair;
    if (section === 'builtin' && key === 'word_files') {
      for (const item of value.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)) {
        result.wordFiles.push(item[2] ?? item[1].replace(/\\(["\\])/g, '$1'));
      }
    } else if (current && (key === 'word' || key === 'stack' || key === 'description')) {
      const parsed = tomlString(value.replace(/\s+#[^"']*$/, ''));
      if (parsed !== undefined) current[key] = parsed;
    }
  }
  finish();
  return result;
}

/**
 * Dictionary entries for all named definitions of an index, one per spelling. Of several
 * definitions of a name, the first one with a stack comment is used.
 */
export function entriesFromIndex(index: WorkspaceIndex, displayPath: (uri: string) => string): DictionaryEntry[] {
  const entries = new Map<string, DictionaryEntry>();
  const uris = index.uris().sort();
  for (const uri of uris) {
    for (const definition of index.get(uri)?.definitions ?? []) {
      if (!definition.name) continue;
      const key = definition.name;
      const known = entries.get(key);
      if (known?.stack) continue;
      if (known && !definition.stackComment) continue;
      const stack = definition.stackComment.includes('--') ? definition.stackComment.replace(/\s+/g, ' ') : '';
      entries.set(key, {
        word: definition.name,
        stack: stack || undefined,
        description: definition.doc || undefined,
        source: `${displayPath(uri)}:${definition.line + 1}`,
      });
    }
  }
  return [...entries.values()];
}
