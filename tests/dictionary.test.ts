import { describe, expect, it } from 'vitest';
import { computeDiagnostics } from '../src/core/diagnostics';
import {
  Dictionary,
  entriesFromIndex,
  mergeEntries,
  parseDictionaryJson,
  parseForthLspConfig,
  parseWordList,
  serializeDictionary,
} from '../src/core/dictionary';
import { decodeSource } from '../src/core/encoding';
import { buildHoverMarkdown } from '../src/core/hover';
import { parsePrimitives } from '../src/tools/buildDictionary';
import { WorkspaceIndex } from '../src/core/workspaceIndex';

describe('Dictionary', () => {
  it('looks words up case-insensitively and keeps the first spelling', () => {
    const dictionary = new Dictionary();
    dictionary.addNames(parseWordList('ROTDROP\r\nOR!  2PICK\n'), 'list');
    expect(dictionary.size).toBe(3);
    expect(dictionary.has('rotdrop')).toBe(true);
    expect(dictionary.get('or!')?.name).toBe('OR!');
    expect(dictionary.has('missing')).toBe(false);
  });

  it('only fills in details that a known word lacks', () => {
    const dictionary = new Dictionary();
    dictionary.add([{ word: 'MINMAX', stack: '( n min max -- m )' }], 'first');
    dictionary.add([{ word: 'MINMAX', stack: '( wrong -- )', description: 'Clamps n.' }], 'second');
    const word = dictionary.get('minmax');
    expect(word?.stack).toBe('( n min max -- m )');
    expect(word?.description).toBe('Clamps n.');
    expect(word?.dictionary).toBe('first');
  });

  it('keeps spellings that differ only in case apart', () => {
    const dictionary = new Dictionary();
    dictionary.add([{ word: 'az-pat', stack: '( -- dbfield )' }, { word: 'AZ-PAT', stack: '( rec -- addr )' }], 'db');
    expect(dictionary.size).toBe(1);
    expect(dictionary.get('az-pat')?.stack).toBe('( -- dbfield )');
    expect(dictionary.get('AZ-PAT')?.stack).toBe('( rec -- addr )');
    expect(dictionary.get('Az-Pat')?.name).toBe('az-pat');
    expect(dictionary.startingWith('az', 10).map(word => word.name)).toEqual(['az-pat', 'AZ-PAT']);
  });

  it('finds words by prefix and lists the words starting with a quote', () => {
    const dictionary = new Dictionary();
    dictionary.addNames(['STRCAT', 'strpck', 'STRDUP', 'SWAP!', '">ASCIIZ', '"'], 'list');
    expect(dictionary.startingWith('str', 10).map(word => word.name)).toEqual(['STRCAT', 'STRDUP', 'strpck']);
    expect(dictionary.startingWith('STR', 2)).toHaveLength(2);
    expect(dictionary.quoteWords()).toEqual(['">asciiz']);
  });
});

describe('dictionary files', () => {
  it('round-trips the JSON format and tolerates bare names', () => {
    const text = serializeDictionary([
      { word: 'b', stack: '( x -- )' },
      { word: 'A', description: 'First.', source: 'a.f:1' },
    ]);
    expect(parseDictionaryJson(text)).toEqual([
      { word: 'A', description: 'First.', source: 'a.f:1' },
      { word: 'b', stack: '( x -- )' },
    ]);
    expect(parseDictionaryJson('["DUP2", {"word": "X", "stack": 7}, {"stack": "( -- )"}]')).toEqual([
      { word: 'DUP2' },
      { word: 'X' },
    ]);
  });

  it('extends a dictionary without overwriting what is there', () => {
    const existing = [{ word: 'ROT-', stack: '( n1 n2 n3 -- n2 n3-n1 )' }, { word: 'PLAIN' }];
    const result = mergeEntries(existing, [
      { word: 'ROT-', stack: '( n1 n2 n3 -- n2 n3+n1 )', source: 'utils/PD.F:4014' },
      { word: 'PLAIN' },
      { word: 'plain', stack: '( -- )' },
    ]);
    expect(result.added).toBe(1);
    expect(result.completed).toBe(1);
    expect(result.entries).toEqual([
      { word: 'ROT-', stack: '( n1 n2 n3 -- n2 n3-n1 )', source: 'utils/PD.F:4014' },
      { word: 'PLAIN' },
      { word: 'plain', stack: '( -- )' },
    ]);
  });

  it('reads the word settings of a forth-lsp configuration', () => {
    const config = parseForthLspConfig(
      [
        '[format]',
        'enabled = false',
        '[builtin]',
        'word_files = ["data-al.words",',
        "  'lists/kernel.words']  # extra",
        '# [[builtin.words]]',
        '# word = "IGNORED"',
        '[[builtin.words]]',
        'word = "LOADFROM"',
        '[[builtin.words]]',
        'word = "MY-DUP"',
        'stack = "( x -- x x )"',
        'description = "Wie DUP, aber mit \\"Logging\\"."',
      ].join('\n'),
    );
    expect(config.wordFiles).toEqual(['data-al.words', 'lists/kernel.words']);
    expect(config.words).toEqual([
      { word: 'LOADFROM' },
      { word: 'MY-DUP', stack: '( x -- x x )', description: 'Wie DUP, aber mit "Logging".' },
    ]);
  });

  it('reads the rows of the primitives table', () => {
    const entries = parsePrimitives(
      [
        '| Statt | Wort | Stapeleffekt | Hinweis | Quelle |',
        '| --- | --- | --- | --- | --- |',
        '| `ROT DROP` | `ROTDROP` | `( N0 N1 N2 -- N1 N2 )` |  | utils/PD.F:3604 |',
        '| `DUP IF @ THEN` | `?@` | `( a1\\|0 -- n1\\|0 )` |  | fkernel.f:878 |',
        '| `?DUP 0=IF` | `?UNLESS` | – | conditional | fkernel.f:3717 |',
      ].join('\n'),
    );
    expect(entries).toEqual([
      { word: 'ROTDROP', stack: '( N0 N1 N2 -- N1 N2 )', description: 'Statt: ROT DROP', source: 'utils/PD.F:3604' },
      { word: '?@', stack: '( a1|0 -- n1|0 )', description: 'Statt: DUP IF @ THEN', source: 'fkernel.f:878' },
      { word: '?UNLESS', description: 'conditional\nStatt: ?DUP 0=IF', source: 'fkernel.f:3717' },
    ]);
  });

  it('decodes ISO-8859-1 sources that are not valid UTF-8', () => {
    expect(decodeSource(new Uint8Array([0x66, 0xfc, 0x72]))).toBe('für');
    expect(decodeSource(new TextEncoder().encode('für'))).toBe('für');
  });
});

describe('dictionary and index', () => {
  const dictionary = new Dictionary();
  dictionary.add([{ word: 'ROTDROP', stack: '( n0 n1 n2 -- n1 n2 )', description: 'Statt: ROT DROP', source: 'utils/PD.F:3604' }], 'data-al');
  dictionary.addNames(['">ASCIIZ', 'ZEXEC'], 'data-al');

  it('does not report dictionary words as unknown and describes them on hover', () => {
    const index = new WorkspaceIndex();
    index.setDictionary(dictionary);
    index.update([['a.f', ': run ( a b c -- ) rotdrop 2drop s" x" ">ASCIIZ zexec nonsense ;']]);
    const unknown = computeDiagnostics(index, 'a.f').filter(problem => problem.code === 'unknown-word');
    expect(unknown.map(problem => problem.message.split("'")[1])).toEqual(['nonsense']);

    const hover = buildHoverMarkdown(index, 'RotDrop', uri => uri) ?? '';
    expect(hover).toContain('`ROTDROP`');
    expect(hover).toContain('`( n0 n1 n2 -- n1 n2 )`');
    expect(hover).toContain('Wörterbuch data\\-al');
    expect(buildHoverMarkdown(index, 'nonsense', uri => uri)).toBe(null);
  });

  it('prefers the definition in the workspace over the dictionary entry', () => {
    const index = new WorkspaceIndex();
    index.setDictionary(dictionary);
    index.update([['pd.f', ': ROTDROP ( n0 n1 n2 -- n1 n2 ) rot drop ;']]);
    const hover = buildHoverMarkdown(index, 'rotdrop', uri => uri) ?? '';
    expect(hover).toContain('pd\\.f:1');
    expect(hover.includes('Wörterbuch')).toBe(false);
  });

  it('turns the definitions of an index into dictionary entries', () => {
    const index = new WorkspaceIndex();
    index.update([
      ['b.f', ': twice dup + ;\n42 CONSTANT ANSWER\n: TWICE ( d -- 2d ) 2dup d+ ;'],
      ['a.f', '\\ Doubles n.\n: twice  ( n -- 2n )\n   dup + ;'],
    ]);
    expect(entriesFromIndex(index, uri => `src/${uri}`)).toEqual([
      { word: 'twice', stack: '( n -- 2n )', description: 'Doubles n.', source: 'src/a.f:2' },
      { word: 'ANSWER', source: 'src/b.f:2' },
      { word: 'TWICE', stack: '( d -- 2d )', source: 'src/b.f:3' },
    ]);
  });
});
