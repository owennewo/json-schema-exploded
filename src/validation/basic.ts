// Provider-independent checks: is the file valid JSON at all, and is it a
// structurally sane JSON Schema (types, enums, required lists, resolvable refs).

import type { JsonSchema } from '../walker';
import type { Finding, GroupResult, RuleMeta } from './types';
import { collectRefs, forEachNode, resolveRef } from './walk';

const RULES = {
  syntax: {
    id: 'basic/json-syntax',
    severity: 'error',
    title: 'document is not valid JSON',
  },
  refUnresolved: {
    id: 'basic/ref-unresolved',
    severity: 'error',
    title: '$ref does not resolve',
  },
  refExternal: {
    id: 'basic/ref-external',
    severity: 'warn',
    title: 'external $ref',
    hint: 'LLM structured-output consumers only resolve internal refs — inline it or move the target into #/$defs',
  },
  badType: {
    id: 'basic/bad-type',
    severity: 'error',
    title: 'invalid `type` value',
    hint: 'valid types: object, array, string, number, integer, boolean, null',
  },
  badEnum: {
    id: 'basic/bad-enum',
    severity: 'error',
    title: '`enum` must be a non-empty array',
  },
  dupEnum: {
    id: 'basic/dup-enum',
    severity: 'warn',
    title: 'duplicate enum values',
  },
  requiredShape: {
    id: 'basic/required-shape',
    severity: 'error',
    title: '`required` must be an array of strings',
  },
  requiredUnknown: {
    id: 'basic/required-unknown',
    severity: 'warn',
    title: '`required` names a property that is not declared',
    hint: 'checked only on nodes without allOf/$ref (inherited properties are not traced)',
  },
} satisfies Record<string, RuleMeta>;

const VALID_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

/** line/column of a JSON.parse failure, best-effort across engines */
function syntaxFinding(raw: string): Finding {
  try {
    JSON.parse(raw);
    return { path: [], note: 'unparseable for an unknown reason' };
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    let line: number | undefined;
    let col: number | undefined;
    const lc = msg.match(/line (\d+) column (\d+)/);
    const pos = msg.match(/position (\d+)/);
    if (lc) {
      line = Number(lc[1]);
      col = Number(lc[2]);
    } else if (pos) {
      const before = raw.slice(0, Number(pos[1]));
      line = before.split('\n').length;
      col = before.length - before.lastIndexOf('\n');
    }
    return { path: [], note: line !== undefined ? `${msg} (line ${line}, col ${col})` : msg };
  }
}

export function runBasic(raw: string | undefined, doc: JsonSchema | undefined): GroupResult {
  const group: GroupResult = {
    id: 'basic',
    label: 'Basic',
    note: 'JSON syntax and JSON Schema structural sanity',
    rules: [],
  };
  if (doc === undefined) {
    if (raw === undefined) {
      group.skipped = 'no schema loaded';
      return group;
    }
    group.rules.push({ meta: RULES.syntax, findings: [syntaxFinding(raw)] });
    return group;
  }

  const findings = new Map<RuleMeta, Finding[]>();
  const add = (meta: RuleMeta, f: Finding) => {
    const arr = findings.get(meta);
    if (arr) arr.push(f);
    else findings.set(meta, [f]);
  };

  forEachNode(doc, (node, ptr) => {
    if (node.type !== undefined) {
      const types = typeof node.type === 'string' ? [node.type] : Array.isArray(node.type) ? node.type : undefined;
      if (types === undefined) add(RULES.badType, { path: ptr, note: JSON.stringify(node.type) });
      else {
        for (const t of types) {
          if (typeof t !== 'string' || !VALID_TYPES.has(t))
            add(RULES.badType, { path: ptr, note: JSON.stringify(t) });
        }
      }
    }
    if (node.enum !== undefined) {
      if (!Array.isArray(node.enum) || node.enum.length === 0) {
        add(RULES.badEnum, { path: ptr });
      } else {
        const seen = new Set<string>();
        for (const v of node.enum) {
          const key = JSON.stringify(v);
          if (seen.has(key)) add(RULES.dupEnum, { path: ptr, note: key });
          seen.add(key);
        }
      }
    }
    if (node.required !== undefined) {
      if (!Array.isArray(node.required) || node.required.some((r) => typeof r !== 'string')) {
        add(RULES.requiredShape, { path: ptr });
      } else if (node.properties !== undefined && node.allOf === undefined && node.$ref === undefined) {
        for (const name of node.required) {
          if (!(name in node.properties)) add(RULES.requiredUnknown, { path: ptr, note: name });
        }
      }
    }
  });

  for (const { ref, ptr } of collectRefs(doc)) {
    if (ref === '#' || ref.startsWith('#/')) {
      if (resolveRef(doc, ref) === undefined) add(RULES.refUnresolved, { path: ptr, note: ref });
    } else {
      add(RULES.refExternal, { path: ptr, note: ref });
    }
  }

  group.rules = [...findings.entries()].map(([meta, f]) => ({ meta, findings: f }));
  return group;
}
