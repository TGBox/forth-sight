import { getBuiltin } from './builtins';
import type { WorkspaceIndex } from './workspaceIndex';

const PREVIEW_LINES = 8;

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&');
}

function inlineCode(text: string): string {
  return text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``;
}

/** Source lines of a definition, limited to a few lines. */
export function definitionPreview(lines: string[], startLine: number, endLine: number): string {
  const last = Math.min(endLine, startLine + PREVIEW_LINES - 1);
  const preview = lines.slice(startLine, last + 1);
  if (endLine > last) preview.push('  ...');
  return preview.join('\n');
}

/**
 * Builds the hover text (Markdown) for a word: its definitions in the workspace
 * and, if it is a standard word, its description. Returns null for unknown words.
 */
export function buildHoverMarkdown(
  index: WorkspaceIndex,
  word: string,
  displayPath: (uri: string) => string,
): string | null {
  const parts: string[] = [];
  const entries = index.definitionsOf(word);

  for (const { uri, definition } of entries) {
    const file = index.get(uri);
    const header = `**${inlineCode(`${definition.kind} ${definition.name}`)}**`;
    const stack = definition.stackComment ? ` ${inlineCode(definition.stackComment)}` : '';
    const location = `*${escapeMarkdown(displayPath(uri))}:${definition.line + 1}*`;
    let text = `${header}${stack} — ${location}\n\n`;
    if (definition.doc) {
      text += `${definition.doc.split('\n').map(escapeMarkdown).join('  \n')}\n\n`;
    }
    if (file) {
      text += `\`\`\`forth\n${definitionPreview(file.lines, definition.startLine, definition.endLine)}\n\`\`\`\n`;
    }
    parts.push(text);
  }

  if (entries.length > 0) {
    const uses = index.referencesOf(word).length;
    parts.push(uses === 1 ? '*1 Verwendung im Arbeitsbereich*\n' : `*${uses} Verwendungen im Arbeitsbereich*\n`);
  }

  const builtin = getBuiltin(word);
  if (builtin) {
    parts.push(
      `**${inlineCode(builtin.name)}** ${inlineCode(`( ${builtin.stack} )`)} — *${escapeMarkdown(builtin.category)}, eingebaut*\n\n` +
        `${escapeMarkdown(builtin.description)}\n`,
    );
  }

  // The dictionary describes words whose source is not part of the workspace.
  const known = entries.length === 0 ? index.dictionary.get(word) : undefined;
  if (known) {
    const stack = known.stack ? ` ${inlineCode(known.stack)}` : '';
    const origin = known.source ? `, ${escapeMarkdown(known.source)}` : '';
    let text = `**${inlineCode(known.name)}**${stack} — *Wörterbuch ${escapeMarkdown(known.dictionary)}${origin}*\n`;
    if (known.description) text += `\n${known.description.split('\n').map(escapeMarkdown).join('  \n')}\n`;
    parts.push(text);
  }

  return parts.length > 0 ? parts.join('\n---\n\n') : null;
}
