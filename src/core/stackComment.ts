/** Number of cells a word takes from and leaves on the data stack. */
export interface StackEffect {
  in: number;
  out: number;
}

// Items named like "d", "ud2" or "xd1" denote double-cell values by convention.
const DOUBLE_CELL_ITEM = /^[+-]?[ux]?d\d*$/i;
// "i*x", "xn ... x1" and alternatives ("a | b") describe a variable number of cells.
const VARIABLE_ITEM = /^(\w\*\w+|\.\.\.|…|\|)$/;
// Other stacks are marked with a prefix, e.g. "R: x --" or "F: r1 r2 -- r3".
const STACK_PREFIX = /^([A-Za-z]+):$/;

function countCells(items: string[]): number | null {
  let cells = 0;
  for (const item of items) {
    if (VARIABLE_ITEM.test(item)) return null;
    // Quoted or bracketed items describe text parsed from the input stream.
    if (item.startsWith('"') || item.endsWith('"') || item.startsWith('<')) continue;
    cells += DOUBLE_CELL_ITEM.test(item) ? 2 : 1;
  }
  return cells;
}

/**
 * Derives the data stack effect from a stack comment such as "( a u -- flag )".
 * Returns null if the comment is not a stack comment or describes a variable effect.
 */
export function parseStackEffect(comment: string): StackEffect | null {
  const text = comment.trim();
  if (!text.startsWith('(') || !text.includes('--')) return null;

  // Builtin descriptions may list several stacks: "( x -- ) ( R: -- x )".
  const groups = text
    .split(/\)\s*\(/)
    .map(group => group.replace(/^\(\s*/, '').replace(/\s*\)\s*$/, '').trim());

  for (const group of groups) {
    const items = group.split(/\s+/).filter(Boolean);
    const prefix = items.length > 0 ? STACK_PREFIX.exec(items[0]) : null;
    if (prefix) {
      const stack = prefix[1].toLowerCase();
      if (stack === 'r' || stack === 'f' || stack === 'c' || stack === 'l') continue;
      // Anything else ("compilation:", "run-time:") is not a plain stack effect.
      if (stack !== 's') return null;
      items.shift();
    }
    const separator = items.indexOf('--');
    if (separator < 0) return null;
    const inputs = countCells(items.slice(0, separator));
    const outputs = countCells(items.slice(separator + 1));
    if (inputs === null || outputs === null) return null;
    return { in: inputs, out: outputs };
  }
  // Only other stacks are affected.
  return { in: 0, out: 0 };
}
