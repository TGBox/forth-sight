import { describe, expect, it } from 'vitest';
import { isNumber, numberCells, tokenize } from '../src/core/tokenizer';

const summary = (source: string): string[] => tokenize(source).map(token => `${token.kind}:${token.text}`);

describe('tokenize', () => {
  it('separates comments from code', () => {
    expect(summary(': sq ( n -- n ) dup * ; \\ square')).toEqual([
      'word::',
      'operand:sq',
      'parenComment:( n -- n )',
      'word:dup',
      'word:*',
      'word:;',
      'lineComment:\\ square',
    ]);
  });

  it('reports positions for tokens on later lines', () => {
    const tokens = tokenize('variable a\r\n  variable b');
    expect(tokens[3].text).toBe('b');
    expect(tokens[3].line).toBe(1);
    expect(tokens[3].col).toBe(11);
    expect(tokens[3].endCol).toBe(12);
  });

  it('reads strings of standard and user-defined string words', () => {
    expect(summary('." a ( b" cr')).toEqual(['word:."', 'string:a ( b', 'word:cr']);
    expect(summary('1 feld" Name (SV)" 2')).toEqual(['word:1', 'word:feld"', 'string:Name (SV)', 'word:2']);
    expect(summary('s\\" a\\"b" type')).toEqual(['word:s\\"', 'string:a\\"b', 'word:type']);
  });

  it('does not treat the operand of [char] as a string or comment start', () => {
    expect(summary(': q [char] " emit [char] ( emit ;')).toEqual([
      'word::',
      'operand:q',
      'word:[char]',
      'operand:"',
      'word:emit',
      'word:[char]',
      'operand:(',
      'word:emit',
      'word:;',
    ]);
  });

  it('lets defining words parse a name only outside colon definitions', () => {
    expect(summary('create buf : mk create , ;')).toEqual([
      'word:create',
      'operand:buf',
      'word::',
      'operand:mk',
      'word:create',
      'word:,',
      'word:;',
    ]);
  });
});

describe('isNumber', () => {
  it('recognises the number formats of Forth-2012 and gforth', () => {
    for (const text of ['0', '-17', '0105', '12.', '$ff', '#10', '%1010', '0x1F', "'a'", '1e3', '-1.5e-2']) {
      expect(isNumber(text)).toBe(true);
    }
    for (const text of ['1+', '2dup', '-', "'", 'ff', '0=', '.']) {
      expect(isNumber(text)).toBe(false);
    }
    expect(isNumber('ff', true)).toBe(true);
  });

  it('knows how many cells a literal occupies', () => {
    expect(numberCells('42')).toBe(1);
    expect(numberCells('42.')).toBe(2);
    expect(numberCells('1e0')).toBeNull();
  });
});
