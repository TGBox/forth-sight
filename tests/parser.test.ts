import { describe, expect, it } from 'vitest';
import { parseForth } from '../src/core/parser';

const codes = (source: string): string[] => parseForth(source).problems.map(problem => problem.code);

describe('parseForth definitions', () => {
  it('finds definitions of all standard defining words', () => {
    const file = parseForth(['variable count', '10 constant limit', 'create buffer 16 allot', ': double ( n -- 2n ) 2* ;'].join('\n'));
    expect(file.definitions.map(d => `${d.kind} ${d.name}`)).toEqual([
      'variable count',
      'constant limit',
      'create buffer',
      ': double',
    ]);
    const double = file.definitions[3];
    expect(double.isColon).toBe(true);
    expect(double.stackComment).toBe('( n -- 2n )');
    expect(double.line).toBe(3);
    expect(double.col).toBe(2);
    expect(double.endCol).toBe(25);
  });

  it('takes the documentation from the comment above or behind the definition', () => {
    const file = parseForth(
      ['\\ ----------', '\\ Section', '\\ ----------', '', '\\ Squares a number.', '\\ Overflow is ignored.', ': square dup * ;', ': cube dup square * ;  \\ third power'].join('\n'),
    );
    expect(file.definitions[0].doc).toBe('Squares a number.\nOverflow is ignored.');
    expect(file.definitions[1].doc).toBe('third power');
    expect(file.sections).toEqual([{ title: 'Section', line: 1 }]);
  });

  it('accepts a stack comment on the line after the name', () => {
    const file = parseForth(': add\n  ( a b -- c )\n  + ;');
    expect(file.definitions[0].stackComment).toBe('( a b -- c )');
  });

  it('records references with their enclosing definition, ignoring comments, strings and numbers', () => {
    const file = parseForth(': greet ( -- ) ." hello dup" 3 spaces cr ;\ngreet');
    expect(file.references.map(r => `${r.name}@${r.def}`)).toEqual(['."@0', 'spaces@0', 'cr@0', 'greet@-1']);
  });

  it('treats locals as local references', () => {
    const file = parseForth(': area {: w h -- a :} w h * ;');
    expect(file.definitions[0].locals).toEqual(['w', 'h']);
    expect(file.references.filter(r => r.local).map(r => r.name)).toEqual(['w', 'h', 'w', 'h']);
  });

  it('marks defining and immediate words', () => {
    const file = parseForth(': array create cells allot does> swap cells + ;\n: [now] 1 ; immediate');
    expect(file.definitions[0].definer).toBe(true);
    expect(file.definitions[0].hasDoes).toBe(true);
    expect(file.definitions[1].immediate).toBe(true);
  });

  it('uses user-defined defining words from the context', () => {
    const context = { definers: new Set(['array']), parsers: new Set<string>() };
    const file = parseForth('10 array scores', context);
    expect(file.definitions.map(d => `${d.kind} ${d.name}`)).toEqual(['array scores']);
  });

  it('does not treat a multi-line header block as a section heading', () => {
    const file = parseForth(['\\ ======', '\\ file.fs', '\\ Purpose of the file', '\\ ======', '\\ Part one', '\\ ======', ': a ;'].join('\n'));
    expect(file.sections).toEqual([{ title: 'Part one', line: 4 }]);
  });

  it('skips code that is disabled with 0 [if]', () => {
    const file = parseForth('0 [if] some free text [else] 1 . [then] cr');
    expect(file.references.map(r => r.name)).toEqual(['.', '[then]', 'cr']);
    expect(file.problems).toEqual([]);
  });

  it('collects included files', () => {
    expect(parseForth('include lib/util.fs\nrequire other.fs').includes.map(i => i.path)).toEqual(['lib/util.fs', 'other.fs']);
  });
});

describe('parseForth structure checks', () => {
  it('accepts well-formed control structures', () => {
    expect(
      codes(': ok ( n -- ) dup if drop else begin dup while 1- repeat drop then 10 0 ?do i case 1 of endof endcase loop ;'),
    ).toEqual([]);
    expect(codes(': multi begin dup while dup 5 > while 1- repeat drop then ;')).toEqual([]);
  });

  it('reports an if without then', () => {
    const file = parseForth(': broken ( f -- ) if 1 . ;');
    expect(file.problems).toHaveLength(1);
    expect(file.problems[0].code).toBe('unclosed-control');
    expect(file.problems[0].col).toBe(18);
  });

  it('reports closing words without an opener', () => {
    expect(codes(': broken then ;')).toEqual(['unmatched-control']);
    expect(codes(': broken 10 0 do i . repeat ;')).toEqual(['unmatched-control', 'unclosed-control']);
  });

  it('reports a definition without semicolon', () => {
    expect(codes(': first 1\n: second 2 ;')).toEqual(['unclosed-definition']);
    expect(codes(': last 1')).toEqual(['unclosed-definition']);
  });

  it('ignores postponed control words', () => {
    expect(codes(': my-if postpone if ; immediate')).toEqual([]);
  });

  it('checks conditional compilation', () => {
    expect(codes('[defined] foo [if] 1 [else] 2 [then]')).toEqual([]);
    expect(codes('1 [if] 2')).toEqual(['unclosed-control']);
  });
});
