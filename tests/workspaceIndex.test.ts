import { describe, expect, it } from 'vitest';
import { buildHoverMarkdown } from '../src/core/hover';
import { enclosingDefinition, WorkspaceIndex, wordAt } from '../src/core/workspaceIndex';

const MATH = ['\\ Berechnet das Quadrat', ': square ( n -- n^2 )', '  dup * ;'].join('\n');

describe('WorkspaceIndex', () => {
  it('finds definitions case-insensitively across files', () => {
    const index = new WorkspaceIndex();
    index.update([
      ['math.fs', MATH],
      ['main.fs', ': main 3 SQUARE . ;'],
    ]);
    const entries = index.definitionsOf('Square');
    expect(entries).toHaveLength(1);
    expect(entries[0].uri).toBe('math.fs');
    expect(entries[0].definition.line).toBe(1);
    expect(index.referencesOf('square').map(entry => entry.uri)).toEqual(['main.fs']);
  });

  it('forgets the definitions of removed and replaced files', () => {
    const index = new WorkspaceIndex();
    index.update([['const.fs', '42 constant answer']]);
    expect(index.isDefined('answer')).toBe(true);
    index.update([['const.fs', '42 constant reply']]);
    expect(index.isDefined('answer')).toBe(false);
    index.remove('const.fs');
    expect(index.isDefined('reply')).toBe(false);
  });

  it('recognises words created by user-defined defining words in other files', () => {
    const index = new WorkspaceIndex();
    index.update([
      ['use.fs', '10 array scores\n: first ( -- n ) 0 scores @ ;'],
      ['lib.fs', ': array create cells allot does> swap cells + ;'],
    ]);
    expect(index.definitionsOf('scores').map(entry => entry.definition.kind)).toEqual(['array']);
  });

  it('excludes same-named locals from the references of a global word', () => {
    const index = new WorkspaceIndex();
    index.update([['a.fs', 'variable w\n: area {: w h :} w h * ;\n: get w @ ;']]);
    expect(index.referencesOf('w').map(entry => entry.reference.line)).toEqual([2]);
  });

  it('locates the word and the definition at a position', () => {
    const index = new WorkspaceIndex();
    index.update([['math.fs', MATH]]);
    const file = index.get('math.fs');
    if (!file) throw new Error('file not indexed');
    expect(wordAt(file, 2, 3)?.token.text).toBe('dup');
    expect(wordAt(file, 0, 5)).toBeNull();
    expect(wordAt(file, 1, 12)).toBeNull();
    const dup = wordAt(file, 2, 3);
    expect(dup ? enclosingDefinition(file, dup.index) : -1).toBe(0);
  });
});

describe('buildHoverMarkdown', () => {
  it('describes user-defined words with stack comment, documentation and source', () => {
    const index = new WorkspaceIndex();
    index.update([['math.fs', MATH]]);
    const hover = buildHoverMarkdown(index, 'SQUARE', uri => uri);
    expect(hover).toContain(': square');
    expect(hover).toContain('( n -- n^2 )');
    expect(hover).toContain('Berechnet das Quadrat');
    expect(hover).toContain('dup * ;');
    expect(hover).toContain('math\\.fs:2');
  });

  it('describes builtin words', () => {
    const hover = buildHoverMarkdown(new WorkspaceIndex(), '/string', uri => uri);
    expect(hover).toContain('( c-addr1 u1 n -- c-addr2 u2 )');
    expect(hover).toContain('eingebaut');
  });

  it('returns null for unknown words', () => {
    expect(buildHoverMarkdown(new WorkspaceIndex(), 'mystery', uri => uri)).toBeNull();
  });
});
