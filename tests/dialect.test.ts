import { describe, expect, it } from 'vitest';
import { computeDiagnostics } from '../src/core/diagnostics';
import { parseForth, type ParseContext } from '../src/core/parser';
import { tokenize } from '../src/core/tokenizer';
import { WorkspaceIndex } from '../src/core/workspaceIndex';

const CONTEXT: ParseContext = { definers: new Set(), parsers: new Set(), quoteWords: new Set(['">asciiz', '"mainpopup"']) };
const parse = (source: string): ReturnType<typeof parseForth> => parseForth(source, CONTEXT);
const names = (source: string): string[] => parse(source).definitions.map(definition => `${definition.kind} ${definition.name}`);
const problems = (source: string): string[] => parse(source).problems.map(problem => problem.code);
const summary = (source: string): string[] => tokenize(source).map(token => `${token.kind}:${token.text}`);

describe('Win32Forth / Data-AL dialect: tokenizer', () => {
  it('reads block comments in double parentheses and C style', () => {
    expect(summary('1 (( : x ;\n)) 2')).toEqual(['word:1', 'parenComment:(( : x ;\n))', 'word:2']);
    expect(summary('/* $Id: PX.F $\n */ [FORTH]')).toEqual(['parenComment:/* $Id: PX.F $\n */', 'word:[FORTH]']);
  });

  it("reads strings delimited by an apostrophe after S'", () => {
    expect(summary(`S' say "hi" now' type`)).toEqual(["word:S'", 'string:say "hi" now', 'word:type']);
  });

  it('treats words starting with a quote as words', () => {
    expect(summary('S" a" ">ASCIIZ zexec')).toEqual(['word:S"', 'string:a', 'word:">ASCIIZ', 'word:zexec']);
    expect(summary('"CASE\n  of" x" 1 endof')).toEqual(['word:"CASE', 'word:of"', 'string:x', 'word:1', 'word:endof']);
    expect(tokenize('"MAINPOPUP" REL>ABS', new Set(['"mainpopup"']))[0].kind).toBe('word');
    expect(summary('"two words" type')).toEqual(['string:two words', 'word:type']);
  });

  it('only takes a path on the same line as the operand of CD and HI', () => {
    expect(summary('CD\n[ELSE]')).toEqual(['word:CD', 'word:[ELSE]']);
    expect(summary('HI DATA\\PX.F \\ main')).toEqual(['word:HI', 'operand:DATA\\PX.F', 'lineComment:\\ main']);
  });

  it('does not let assembler source change the compile state', () => {
    expect(names('CODE A!  ( n a -- )\n   mov [ebx], eax ] next c;\nVARIABLE AFTER')).toEqual(['code A!', 'variable AFTER']);
    expect(names('CODE LOST  ( -- )\n   next\n: FOUND ;')).toEqual(['code LOST', ': FOUND']);
  });
});

describe('Win32Forth / Data-AL dialect: parser', () => {
  it('reads named parameters with uninitialised locals after a backslash', () => {
    const file = parse(': MYWORT  { addr len \\ buf -- result }\n   addr len buf PLACE buf ;\n: NEXT ;');
    expect(file.definitions.map(definition => definition.name)).toEqual(['MYWORT', 'NEXT']);
    expect(file.definitions[0].locals).toEqual(['addr', 'len', 'buf']);
    expect(file.definitions[0].stackComment).toBe('( addr len -- result )');
  });

  it('accepts the extended control structures', () => {
    expect(problems(': a ( n -- ) ?IF drop THEN ;')).toEqual([]);
    expect(problems(': a ( f -- ) UNLESS 1 ELSE 2 THEN drop ;')).toEqual([]);
    expect(problems(': a ( n -- ) CASE 5 OF 1 ENDOF 2 4 OFWITHIN 2 ENDOF OF| 8 , 5 , |OF 3 ENDOF END-CASE ;')).toEqual([]);
    expect(problems(': a ( a c -- ) "CASE OF" hello" 1 ENDOF OF~" wor[0-3]d" 2 ENDOF "ENDCASE ;')).toEqual([]);
    expect(problems(': a ( -- ) DO| 1 , 8 , |DO I . LOOP ;')).toEqual([]);
    expect(problems(': a ( coll -- ) EACH {{ ( item -- ) drop }} ;')).toEqual([]);
    expect(problems(': a ( n -- ) ?IF drop ;')).toEqual(['unclosed-control']);
  });

  it('accepts the conditional compilation words', () => {
    expect(problems('[IFDEBUG] 1 [ELSE] 2 [THEN]\n#IFDEF DELPHI 0 #ELSE 1 #ENDIF\n\\+ MINI HI MINI.F')).toEqual([]);
    expect(problems('#ENDIF')).toEqual(['unmatched-control']);
  });

  it('finds definitions made by colon-like words', () => {
    expect(names('IS: .HELLO ( -- ) ." hello" ;\nSEL: DRIVE ( -- ) ;\nTEST: adds\n   1 1 + 2 ASSERT=\n   ;TEST\n: LAST ;')).toEqual([
      'is: .HELLO',
      'sel: DRIVE',
      'test: adds',
      ': LAST',
    ]);
    expect(names(': .HELLO ( -- ) ." hello" ;IS MYMESSAGE\n: LAST ;')).toEqual([': .HELLO', ': LAST']);
    expect(problems(': .HELLO ( -- ) ." hello" ;IS MYMESSAGE\n: LAST ;')).toEqual([]);
  });

  it('tracks anonymous definitions without listing them', () => {
    const source = 'WM_COMMAND :: ( h m w l -- ? ) IF 1 THEN ;\nBDRUCK :F: ( h m w l -- ? ) ;\nMAKE SELWORD ( r t -- ) CHECK ;AND\n: LAST ;';
    expect(names(source)).toEqual([': LAST']);
    expect(problems(source)).toEqual([]);
    expect(parse(source).references.map(reference => reference.name)).toContain('SELWORD');
  });

  it('finds classes, methods, DLL functions and database definitions', () => {
    expect(
      names(
        [
          'OBJ SUBCLASS: VEHICLE',
          '-METHOD DRIVE',
          'OBJ CLASSVARS:',
          ';SUBCLASS: MYCLASS',
          'PROC_STDCALL AlEpaUpload ( a b -- ec )',
          '2 CALLBACK MYCB (MYCB)',
          'REORDERER FUNNY ( a b -- b a )',
          '#define XCALL_rust_example 152',
          'DBSINGLE az-pat  REQUIRED,',
          'IS-RECORD azschein AZSCHEIN',
          'az-pat DB-FIELD AZ-PAT',
        ].join('\n'),
      ),
    ).toEqual([
      'subclass: VEHICLE',
      '-method DRIVE',
      ';subclass: MYCLASS',
      'proc_stdcall AlEpaUpload',
      'callback MYCB',
      'reorderer FUNNY',
      '#define XCALL_rust_example',
      'dbsingle az-pat',
      'is-record azschein',
      'is-record AZSCHEIN',
      'db-field AZ-PAT',
    ]);
  });

  it('records the files loaded with HI and FLOAD', () => {
    const file = parse('HI DATA\\DB\\DBP.F \\ tables\nFLOAD xcall.h\n?DEBUG @0= ?HI DATA\\OV.F');
    expect(file.includes.map(include => include.path)).toEqual(['DATA\\DB\\DBP.F', 'xcall.h', 'DATA\\OV.F']);
  });

  it('does not report method implementations, other spellings or syntax words', () => {
    const index = new WorkspaceIndex();
    index.update([
      [
        'db.f',
        '-METHOD DRIVE\nSEL: DRIVE ( -- ) ;\nSEL: DRIVE ( -- ) ;\nIS-RECORD azschein AZSCHEIN\naz-pat DB-FIELD AZ-PAT\n: twice ; : twice ;',
      ],
    ]);
    const found = computeDiagnostics(index, 'db.f').map(problem => `${problem.code}:${problem.message.split("'")[1]}`);
    expect(found).toEqual(['redefinition:twice']);
  });

  it('re-reads files once a word starting with a quote becomes known', () => {
    const index = new WorkspaceIndex();
    index.update([['use.f', ': run ( -- ) S" a" "PATH S" b" type ;']]);
    expect(index.referencesOf('"path')).toHaveLength(0);
    index.update([['def.f', ': "PATH ( a c -- a c ) ;']]);
    expect(index.referencesOf('"path').map(entry => entry.uri)).toEqual(['use.f']);
  });
});
