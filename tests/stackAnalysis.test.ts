import { describe, expect, it } from 'vitest';
import { analyzeDefinition } from '../src/core/stackAnalysis';
import { parseStackEffect } from '../src/core/stackComment';
import { WorkspaceIndex } from '../src/core/workspaceIndex';

/** Analyses the last definition of the source. */
function analyze(source: string): string[] | null {
  const index = new WorkspaceIndex();
  index.update([['test.fs', source]]);
  const file = index.get('test.fs');
  if (!file) throw new Error('file not indexed');
  const definition = file.definitions[file.definitions.length - 1];
  const findings = analyzeDefinition(file, definition, lower => index.effectOf(lower));
  return findings ? findings.map(finding => finding.message) : null;
}

describe('parseStackEffect', () => {
  it('counts cells on both sides', () => {
    expect(parseStackEffect('( a u -- flag )')).toEqual({ in: 2, out: 1 });
    expect(parseStackEffect('( -- )')).toEqual({ in: 0, out: 0 });
    expect(parseStackEffect('( d n -- ud )')).toEqual({ in: 3, out: 2 });
    expect(parseStackEffect('( x "name" -- )')).toEqual({ in: 1, out: 0 });
    expect(parseStackEffect('( x -- ) ( R: -- x )')).toEqual({ in: 1, out: 0 });
  });

  it('returns null for variable effects and ordinary comments', () => {
    expect(parseStackEffect('( fk -- i true | false )')).toBeNull();
    expect(parseStackEffect('( i*x xt -- j*x )')).toBeNull();
    expect(parseStackEffect('( just a remark )')).toBeNull();
    expect(parseStackEffect('( compilation: -- orig )')).toBeNull();
  });
});

describe('analyzeDefinition', () => {
  it('accepts definitions that match their stack comment', () => {
    expect(analyze(': square ( n -- n2 ) dup * ;')).toEqual([]);
    expect(analyze(': max3 ( a b c -- m ) max max ;')).toEqual([]);
    expect(analyze(': sign ( n -- -1|0|1 ) dup 0< if drop -1 exit then 0> if 1 else 0 then ;')).toEqual([]);
    expect(analyze(': sum ( n -- sum ) 0 swap 0 ?do i + loop ;')).toEqual([]);
    expect(analyze(': skip0 ( a u -- a2 u2 ) begin dup while over c@ 0= while 1 /string repeat then ;')).toBeNull();
    expect(analyze(': drain ( a u -- a2 0 ) begin dup while 1 /string repeat ;')).toEqual([]);
    expect(analyze(': third ( a b c -- a b c a ) 2 pick ;')).toEqual([]);
    expect(analyze(': show ( n -- ) ?dup if . then ;')).toEqual([]);
    expect(analyze(': name ( n -- a u ) case 1 of s" one" endof 2 of s" two" endof s" many" rot endcase ;')).toEqual([]);
  });

  it('uses the stack comments of other user-defined words', () => {
    const helper = ': pair ( n -- n n ) dup ;\nvariable total\n';
    expect(analyze(`${helper}: add ( n -- ) pair + total +! ;`)).toEqual([]);
  });

  it('reports a body that does not match the stack comment', () => {
    const findings = analyze(': broken ( a b -- c ) drop drop ;');
    expect(findings).toHaveLength(1);
    expect(findings?.[0]).toContain('-2');
    expect(findings?.[0]).toContain('( a b -- c )');
  });

  it('reports an exit with the wrong stack depth', () => {
    const findings = analyze(': check ( a u -- f ) dup 0= if drop false exit then nip 0> ;');
    expect(findings).toHaveLength(1);
    expect(findings?.[0]).toContain('exit');
  });

  it('reports branches of different depth', () => {
    const findings = analyze(': pick-one ( f -- n ) if 1 2 else 3 then ;');
    expect(findings).toHaveLength(1);
    expect(findings?.[0]).toContain('if ... then');
  });

  it('reports a body that uses more values than the comment names', () => {
    const findings = analyze(': hidden ( a -- a ) swap swap ;');
    expect(findings).toHaveLength(1);
    expect(findings?.[0]).toContain('2 Stackwerte');
  });

  it('stays silent when the effect cannot be determined', () => {
    expect(analyze(': call ( xt -- ) execute ;')).toBeNull();
    expect(analyze(': uses-unknown ( -- ) mystery ;')).toBeNull();
    expect(analyze(': no-comment dup ;')).toBeNull();
    expect(analyze(': count-up ( n -- ) 0 ?do i loop ;')).toBeNull();
    expect(analyze(': fsquare ( r -- r2 ) fdup f* ;')).toBeNull();
    expect(analyze('create table 1 , 2 , does> ( n -- x ) swap cells + @ ;\n: second ( -- x ) 1 table ;')).toBeNull();
  });
});
