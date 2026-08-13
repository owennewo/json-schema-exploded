// Pretty-printer producing the same output as JSON.stringify(v, null, 2), but
// broken into lines of typed tokens so the JSON panel's raw view can syntax-
// highlight it, and recording for every node the span of lines it occupies
// (object properties start on their key's line). The raw view uses those line
// spans to highlight/scroll to the current selection, and their inverse to turn
// a click on a line back into a selection.

import { ptrKey, type Ptr } from './jsonPointer';

export type TokenKind = 'key' | 'string' | 'number' | 'bool' | 'null' | 'punct';

export interface Token {
  t: string;
  k: TokenKind;
}

export interface Line {
  /** indent level; the emitted text indents by 2 spaces per level */
  depth: number;
  tokens: Token[];
}

export interface PrettyJson {
  /** JSON.stringify(value, null, 2)-identical text (what copy-to-clipboard emits) */
  text: string;
  lines: Line[];
  /** ptrKey(pointer) -> [firstLine, lastLine], both inclusive indexes into lines */
  ranges: Map<string, [number, number]>;
  /** line index -> the deepest pointer covering it */
  lineOwner: Ptr[];
}

const scalarKind = (v: unknown): TokenKind =>
  v === null ? 'null' : typeof v === 'string' ? 'string' : typeof v === 'number' ? 'number' : 'bool';

export function prettyWithRanges(value: unknown): PrettyJson {
  const ranges = new Map<string, [number, number]>();
  const owners: { ptr: Ptr; from: number; to: number }[] = [];
  const lines: Line[] = [{ depth: 0, tokens: [] }];
  const push = (t: string, k: TokenKind) => lines[lines.length - 1].tokens.push({ t, k });
  const newline = (depth: number) => lines.push({ depth, tokens: [] });

  const write = (v: unknown, ptr: Ptr, depth: number): void => {
    const from = lines.length - 1;
    if (v === null || typeof v !== 'object') {
      push(JSON.stringify(v), scalarKind(v));
    } else if (Array.isArray(v)) {
      if (v.length === 0) {
        push('[]', 'punct');
      } else {
        push('[', 'punct');
        v.forEach((item, i) => {
          newline(depth + 1);
          write(item, [...ptr, i], depth + 1);
          if (i < v.length - 1) push(',', 'punct');
        });
        newline(depth);
        push(']', 'punct');
      }
    } else {
      const entries = Object.entries(v as Record<string, unknown>);
      if (entries.length === 0) {
        push('{}', 'punct');
      } else {
        push('{', 'punct');
        entries.forEach(([k, val], i) => {
          newline(depth + 1);
          push(JSON.stringify(k), 'key');
          push(': ', 'punct');
          write(val, [...ptr, k], depth + 1);
          if (i < entries.length - 1) push(',', 'punct');
        });
        newline(depth);
        push('}', 'punct');
      }
    }
    const to = lines.length - 1;
    ranges.set(ptrKey(ptr), [from, to]);
    owners.push({ ptr, from, to });
  };
  write(value, [], 0);

  // owners are recorded innermost-first (post-order), so the first hit for a
  // line is the deepest node covering it
  const lineOwner: Ptr[] = new Array(lines.length);
  for (const { ptr, from, to } of owners)
    for (let i = from; i <= to; i++) if (lineOwner[i] === undefined) lineOwner[i] = ptr;

  const text = lines
    .map((l) => '  '.repeat(l.depth) + l.tokens.map((t) => t.t).join(''))
    .join('\n');

  return { text, lines, ranges, lineOwner };
}
