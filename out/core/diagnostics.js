"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_DIAGNOSTIC_OPTIONS = void 0;
exports.computeDiagnostics = computeDiagnostics;
const builtins_1 = require("./builtins");
const stackAnalysis_1 = require("./stackAnalysis");
exports.DEFAULT_DIAGNOSTIC_OPTIONS = {
    unknownWords: true,
    redefinitions: true,
    stackEffects: true,
    knownWords: new Set(),
};
/** Collects all problems of one indexed file. */
function computeDiagnostics(index, uri, options = exports.DEFAULT_DIAGNOSTIC_OPTIONS) {
    const file = index.get(uri);
    if (!file)
        return [];
    const problems = [...file.problems];
    if (options.unknownWords) {
        for (const reference of file.references) {
            if (reference.local || reference.quiet)
                continue;
            const lower = reference.name.toLowerCase();
            if ((0, builtins_1.getBuiltin)(lower) || index.isDefined(lower) || options.knownWords.has(lower))
                continue;
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
        const seen = new Map();
        for (const definition of file.definitions) {
            // Definitions inside [if] ... [then] are usually deliberate alternatives.
            if (definition.conditional)
                continue;
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
            }
            else if ((0, builtins_1.getBuiltin)(lower)) {
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
            const findings = (0, stackAnalysis_1.analyzeDefinition)(file, definition, lower => index.effectOf(lower));
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
//# sourceMappingURL=diagnostics.js.map