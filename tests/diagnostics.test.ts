import { describe, expect, it } from 'vitest';
import { computeDiagnostics, DEFAULT_DIAGNOSTIC_OPTIONS } from '../src/core/diagnostics';
import { WorkspaceIndex } from '../src/core/workspaceIndex';

function diagnose(source: string, options = DEFAULT_DIAGNOSTIC_OPTIONS): string[] {
  const index = new WorkspaceIndex();
  index.update([['test.fs', source]]);
  return computeDiagnostics(index, 'test.fs', options).map(problem => `${problem.code}@${problem.line + 1}:${problem.col + 1}`);
}

describe('computeDiagnostics', () => {
  it('reports nothing for clean code', () => {
    expect(
      diagnose(
        [
          'decimal',
          'variable total',
          ': add ( n -- ) total +! ;',
          ": run ( -- ) 5 add ['] add drop s\" text\" type [char] x emit $ff . ;",
          '[defined] missing [if] missing [then]',
          'include other.fs',
          'run bye',
        ].join('\n'),
      ),
    ).toEqual(['unknown-word@5:24']);
  });

  it('reports unknown words unless they are configured as known', () => {
    expect(diagnose(': run ( -- ) frobnicate ;')).toEqual(['unknown-word@1:14']);
    const options = { ...DEFAULT_DIAGNOSTIC_OPTIONS, knownWords: new Set(['frobnicate']) };
    expect(diagnose(': run ( -- ) frobnicate ;', options)).toEqual([]);
    expect(diagnose(': run ( -- ) frobnicate ;', { ...DEFAULT_DIAGNOSTIC_OPTIONS, unknownWords: false })).toEqual([]);
  });

  it('accepts hexadecimal digits after hex', () => {
    expect(diagnose('hex ff constant mask decimal')).toEqual([]);
    expect(diagnose('ff constant mask')).toEqual(['unknown-word@1:1']);
  });

  it('reports redefinitions and shadowed builtin words', () => {
    expect(diagnose(': twice 2* ;\n: twice dup + ;')).toEqual(['redefinition@2:3']);
    expect(diagnose(': type ( a u -- ) 2drop ;')).toEqual(['shadows-builtin@1:3']);
    expect(diagnose('[undefined] third [if] : third 2 pick ; [then]')).toEqual([]);
  });

  it('reports stack effect mismatches and structural problems', () => {
    expect(diagnose(': broken ( a -- ) dup ;')).toEqual(['stack-effect@1:3']);
    expect(diagnose(': broken ( f -- ) if ;')).toEqual(['unclosed-control@1:19']);
    expect(diagnose(': broken ( a -- ) dup ;', { ...DEFAULT_DIAGNOSTIC_OPTIONS, stackEffects: false })).toEqual([]);
  });
});
