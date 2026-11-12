import { getBuiltin } from './builtins';
import type { Problem } from './parser';
import { analyzeDefinition } from './stackAnalysis';
import type { WorkspaceIndex } from './workspaceIndex';

export interface DiagnosticOptions {
  unknownWords: boolean;
  redefinitions: boolean;
  stackEffects: boolean;
  /** Additional words to treat as known (lower case). */
  knownWords: ReadonlySet<string>;
}

export const DEFAULT_DIAGNOSTIC_OPTIONS: DiagnosticOptions = {
  unknownWords: true,
  redefinitions: true,
  stackEffects: true,
  knownWords: new Set(),
};

/** Collects all problems of one indexed file. */
export function computeDiagnostics(
  index: WorkspaceIndex,
  uri: string,
  options: DiagnosticOptions = DEFAULT_DIAGNOSTIC_OPTIONS,
): Problem[] {
  const file = index.get(uri);
  if (!file) return [];
  const problems: Problem[] = [...file.problems];

  if (options.unknownWords) {
    for (const reference of file.references) {
      if (reference.local || reference.quiet) continue;
      const lower = reference.name.toLowerCase();
      if (getBuiltin(lower) || index.isDefined(lower) || options.knownWords.has(lower)) continue;
      problems.push({
        line: reference.line,
        col: reference.col,
        endCol: reference.col + reference.name.length,
        message: `Unbekanntes Wort '${reference.name}': weder im Arbeitsbereich definiert noch als eingebautes Wort bekannt.`,
        severity: 'warning',
        code: 'unknown-word',
      });
    }
  }

  if (options.redefinitions) {
    const seen = new Map<string, number>();
    for (const definition of file.definitions) {
      // Definitions inside [if] ... [then] are usually deliberate alternatives.
      if (definition.conditional) continue;
      const lower = definition.name.toLowerCase();
      const previous = seen.get(lower);
      const range = { line: definition.line, col: definition.col, endCol: definition.col + definition.name.length };
      if (previous !== undefined) {
        problems.push({
          ...range,
          message: `'${definition.name}' wird neu definiert (vorherige Definition in Zeile ${previous + 1}).`,
          severity: 'info',
          code: 'redefinition',
        });
      } else if (getBuiltin(lower)) {
        problems.push({
          ...range,
          message: `'${definition.name}' überdeckt das gleichnamige eingebaute Wort.`,
          severity: 'info',
          code: 'shadows-builtin',
        });
      }
      seen.set(lower, definition.line);
    }
  }

  if (options.stackEffects) {
    for (const definition of file.definitions) {
      const findings = analyzeDefinition(file, definition, lower => index.effectOf(lower));
      for (const finding of findings ?? []) {
        const token = finding.token >= 0 ? file.tokens[finding.token] : undefined;
        problems.push({
          line: token?.line ?? definition.line,
          col: token?.col ?? definition.col,
          endCol: token?.endCol ?? definition.col + definition.name.length,
          message: finding.message,
          severity: 'warning',
          code: 'stack-effect',
        });
      }
    }
  }

  return problems;
}
