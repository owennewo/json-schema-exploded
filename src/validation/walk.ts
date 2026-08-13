// Lexical walk over every subschema node of a JSON Schema document. Does not
// follow $refs — the parsed document is a tree, so the walk always terminates;
// ref cycles are handled separately via the $defs graph (defCycles).

import type { JsonSchema } from '../walker';
import type { Ptr } from '../jsonPointer';

const SINGLE = ['items', 'contains', 'not', 'if', 'then', 'else', 'propertyNames'] as const;
const MAPS = ['properties', 'patternProperties', '$defs', 'definitions'] as const;
const LISTS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const;

function isSchema(v: unknown): v is JsonSchema {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function forEachNode(
  root: JsonSchema,
  cb: (node: JsonSchema, ptr: Ptr) => void,
  basePtr: Ptr = [],
): void {
  cb(root, basePtr);
  for (const k of SINGLE) {
    const v = root[k];
    if (isSchema(v)) forEachNode(v, cb, [...basePtr, k]);
  }
  if (isSchema(root.additionalProperties)) {
    forEachNode(root.additionalProperties as JsonSchema, cb, [...basePtr, 'additionalProperties']);
  }
  for (const k of MAPS) {
    const m = root[k];
    if (isSchema(m)) {
      for (const [name, sub] of Object.entries(m)) {
        if (isSchema(sub)) forEachNode(sub, cb, [...basePtr, k, name]);
      }
    }
  }
  for (const k of LISTS) {
    const arr = root[k];
    if (Array.isArray(arr)) {
      arr.forEach((sub, i) => {
        if (isSchema(sub)) forEachNode(sub, cb, [...basePtr, k, i]);
      });
    }
  }
}

export function typeSet(node: JsonSchema): Set<string> {
  const t = node.type;
  if (typeof t === 'string') return new Set([t]);
  if (Array.isArray(t)) return new Set(t.filter((v): v is string => typeof v === 'string'));
  return new Set();
}

export function isObjectNode(node: JsonSchema): boolean {
  return typeSet(node).has('object') || node.properties !== undefined;
}

export function collectRefs(root: JsonSchema, basePtr: Ptr = []): { ref: string; ptr: Ptr }[] {
  const out: { ref: string; ptr: Ptr }[] = [];
  forEachNode(root, (n, p) => {
    if (typeof n.$ref === 'string') out.push({ ref: n.$ref, ptr: p });
  }, basePtr);
  return out;
}

/** resolve an internal "#/a/b" ref against the document; undefined if it doesn't land */
export function resolveRef(doc: JsonSchema, ref: string): unknown {
  if (ref === '#') return doc;
  if (!ref.startsWith('#/')) return undefined;
  let node: unknown = doc;
  for (const raw of ref.slice(2).split('/')) {
    const seg = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[seg];
    if (node === undefined) return undefined;
  }
  return node;
}

/** names of $defs entries that can reach themselves through the ref graph */
export function defCycles(doc: JsonSchema): Set<string> {
  const defs = doc.$defs ?? {};
  const graph = new Map<string, Set<string>>();
  for (const [name, def] of Object.entries(defs)) {
    const targets = new Set<string>();
    for (const { ref } of collectRefs(def)) {
      if (ref.startsWith('#/$defs/')) {
        const t = ref.slice('#/$defs/'.length).split('/')[0];
        if (defs[t]) targets.add(t);
      }
    }
    graph.set(name, targets);
  }
  const cyclic = new Set<string>();
  for (const name of graph.keys()) {
    const seen = new Set<string>();
    const stack = [...(graph.get(name) ?? [])];
    while (stack.length) {
      const t = stack.pop()!;
      if (t === name) {
        cyclic.add(name);
        break;
      }
      if (seen.has(t)) continue;
      seen.add(t);
      for (const n of graph.get(t) ?? []) stack.push(n);
    }
  }
  return cyclic;
}
