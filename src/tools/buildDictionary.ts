/**
 * Command line tool: scans a Forth code base and extends a dictionary file with
 * the words it defines. Existing entries are kept; they only gain missing details.
 *
 *   node out/tools/buildDictionary.js <source-root> [--out <file>] [--exclude <a,b>]
 *                                     [--primitives <file>] [--dry-run]
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  entriesFromIndex,
  mergeEntries,
  parseDictionaryJson,
  serializeDictionary,
  type DictionaryEntry,
} from '../core/dictionary';
import { decodeSource } from '../core/encoding';
import { WorkspaceIndex } from '../core/workspaceIndex';

const DEFAULT_OUT = path.join('dictionaries', 'data-al', 'data-al.dictionary.json');
const DEFAULT_EXCLUDES = ['node_modules', '.git', 'obsolete', 'Java', 'Z-DATA', 'target'];
const SOURCE_EXTENSIONS = new Set(['.f', '.fs', '.fth', '.4th', '.seq']);
// Headers that are loaded as Forth source (FLOAD xcall.h).
const SOURCE_FILES = new Set(['xcall.h']);

interface Options {
  root: string | null;
  out: string;
  excludes: Set<string>;
  primitives: string | null;
  dryRun: boolean;
}

const USAGE = `Aufruf: node out/tools/buildDictionary.js <Quellordner> [Optionen]

  --out <Datei>          Wörterbuch, das erweitert wird (Standard: ${DEFAULT_OUT})
  --exclude <a,b,c>      Ordnernamen, die übersprungen werden (Standard: ${DEFAULT_EXCLUDES.join(',')})
  --primitives <Datei>   Markdown-Tabelle der Primitive (tutorial/Primitives.md) einlesen
  --dry-run              nur zählen, nichts schreiben`;

function parseArguments(args: string[]): Options {
  const options: Options = { root: null, out: DEFAULT_OUT, excludes: new Set(DEFAULT_EXCLUDES), primitives: null, dryRun: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const value = (): string => {
      const next = args[++index];
      if (next === undefined) throw new Error(`Nach ${arg} fehlt ein Wert.`);
      return next;
    };
    if (arg === '--out') options.out = value();
    else if (arg === '--exclude') options.excludes = new Set(value().split(',').map(name => name.trim()).filter(Boolean));
    else if (arg === '--primitives') options.primitives = value();
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--')) throw new Error(`Unbekannte Option ${arg}.`);
    else if (options.root === null) options.root = arg;
    else throw new Error(`Unerwartetes Argument ${arg}.`);
  }
  if (options.root === null && options.primitives === null) throw new Error('Es fehlt der Quellordner.');
  return options;
}

function isSource(name: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(name).toLowerCase()) || SOURCE_FILES.has(name.toLowerCase());
}

/** All Forth source files below the folder, skipping excluded folder names (case-insensitive). */
function findSources(folder: string, excludes: ReadonlySet<string>): string[] {
  const skip = new Set([...excludes].map(name => name.toLowerCase()));
  const result: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!skip.has(entry.name.toLowerCase())) walk(full);
      } else if (entry.isFile() && isSource(entry.name)) {
        result.push(full);
      }
    }
  };
  walk(folder);
  return result.sort();
}

function scan(root: string, excludes: ReadonlySet<string>): { entries: DictionaryEntry[]; files: number } {
  const files = findSources(root, excludes);
  const index = new WorkspaceIndex();
  index.update(files.map(file => [file, decodeSource(fs.readFileSync(file))] as const));
  const entries = entriesFromIndex(index, file => path.relative(root, file).split(path.sep).join('/'));
  return { entries, files: files.length };
}

function stripCode(cell: string): string {
  return cell.trim().replace(/^`+\s?|\s?`+$/g, '').replace(/\\\|/g, '|');
}

/**
 * Reads the table rows of tutorial/Primitives.md:
 * | sequence | `WORD` | `( stack )` | hint | source |
 */
export function parsePrimitives(markdown: string): DictionaryEntry[] {
  const entries: DictionaryEntry[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    // Cells are separated by "|"; a literal bar inside a cell is written "\|".
    const cells = line.split(/(?<!\\)\|/).slice(1, -1);
    if (cells.length !== 5 || !cells[1].trim().startsWith('`')) continue;
    const [sequence, word, stack, hint, source] = cells.map(stripCode);
    const description = [hint, sequence ? `Statt: ${sequence}` : ''].filter(Boolean).join('\n');
    entries.push({
      word,
      stack: stack.startsWith('(') ? stack : undefined,
      description: description || undefined,
      source: source || undefined,
    });
  }
  return entries;
}

function main(): void {
  let options: Options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  const existing = fs.existsSync(options.out) ? parseDictionaryJson(decodeSource(fs.readFileSync(options.out))) : [];
  const additions: DictionaryEntry[] = [];
  if (options.primitives !== null) {
    const primitives = parsePrimitives(decodeSource(fs.readFileSync(options.primitives)));
    console.log(`${primitives.length} Primitive aus ${options.primitives} gelesen.`);
    additions.push(...primitives);
  }
  if (options.root !== null) {
    const { entries, files } = scan(options.root, options.excludes);
    console.log(`${files} Quelldateien in ${options.root} gelesen, ${entries.length} Wörter gefunden.`);
    additions.push(...entries);
  }

  const merged = mergeEntries(existing, additions);
  const withStack = merged.entries.filter(entry => entry.stack).length;
  console.log(
    `Wörterbuch: ${existing.length} vorhandene Wörter, ${merged.added} neu, ${merged.completed} ergänzt; ` +
      `${withStack} von ${merged.entries.length} mit Stack-Kommentar.`,
  );
  if (options.dryRun) return;
  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(options.out, serializeDictionary(merged.entries), 'utf8');
  console.log(`Geschrieben: ${options.out}`);
}

if (require.main === module) main();
