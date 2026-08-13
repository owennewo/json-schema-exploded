// Mapping between walker ids (schema paths like "tax_status.client.tax_residencies[]"
// or "$defs/person_details.first_name") and JSON pointer paths into the raw schema
// document (["properties","tax_status","properties","client",...]). Used by the JSON
// panel to highlight the selection and to select from a clicked JSON node.
//
// allOf is transparent in ids (the walker merges inline allOf branches into the
// entity's rows), so idToPointer searches allOf branches when a property is not in
// `properties`, and pointerToId skips over allOf/<i> steps.

import { DEF_PREFIX, ROOT_ID, type JsonSchema } from './walker';

export type Ptr = (string | number)[];

/** stable serialization of a pointer, used as map/set key */
export function ptrKey(ptr: Ptr): string {
  return JSON.stringify(ptr);
}

function findProp(
  node: JsonSchema,
  name: string,
): { segs: Ptr; schema: JsonSchema } | undefined {
  const own = node.properties?.[name];
  if (own !== undefined) return { segs: ['properties', name], schema: own };
  const branches = node.allOf ?? [];
  for (let i = 0; i < branches.length; i++) {
    const hit = findProp(branches[i], name);
    if (hit) return { segs: ['allOf', i, ...hit.segs], schema: hit.schema };
  }
  return undefined;
}

/** pointer into `doc` for a walker entity/row id; undefined when unmappable (edges, drift) */
export function idToPointer(doc: JsonSchema, id: string): Ptr | undefined {
  if (id === ROOT_ID) return [];
  if (id.startsWith('e:')) return undefined;
  let node: JsonSchema = doc;
  const ptr: Ptr = [];
  let rest = id;
  if (id.startsWith(DEF_PREFIX)) {
    const after = id.slice(DEF_PREFIX.length);
    const dot = after.indexOf('.');
    const defName = dot === -1 ? after : after.slice(0, dot);
    const def = doc.$defs?.[defName];
    if (!def) return undefined;
    ptr.push('$defs', defName);
    node = def;
    rest = dot === -1 ? '' : after.slice(dot + 1);
  }
  for (const seg of rest ? rest.split('.') : []) {
    const isArrayItems = seg.endsWith('[]');
    const name = isArrayItems ? seg.slice(0, -2) : seg;
    const hit = findProp(node, name);
    if (!hit) return undefined;
    ptr.push(...hit.segs);
    node = hit.schema;
    if (isArrayItems) {
      if (!node.items || typeof node.items !== 'object') return undefined;
      ptr.push('items');
      node = node.items;
    }
  }
  return ptr;
}

/**
 * The section a walker id lives in: the top-level property (`tax_status`) or
 * `$defs` entry (`$defs/person_details`) at the head of its path — the unit
 * that gets lifted out and sent to a model on its own. An array section is
 * named by the property, not its items, so the `[]` is dropped. Undefined for
 * the root itself and for edge ids, which sit in no section.
 */
export function sectionOf(id: string | undefined): string | undefined {
  if (!id || id === ROOT_ID || id.startsWith('e:')) return undefined;
  const from = id.startsWith(DEF_PREFIX) ? DEF_PREFIX.length : 0;
  const dot = id.indexOf('.', from);
  const head = dot === -1 ? id : id.slice(0, dot);
  return head.endsWith('[]') ? head.slice(0, -2) : head;
}

/** the raw schema node a walker id points at, straight from the document */
export function nodeAt(doc: JsonSchema, id: string): JsonSchema | undefined {
  const ptr = idToPointer(doc, id);
  if (!ptr) return undefined;
  let n: unknown = doc;
  for (const seg of ptr) {
    if (n === null || typeof n !== 'object') return undefined;
    n = (n as Record<string | number, unknown>)[seg];
  }
  return n !== null && typeof n === 'object' && !Array.isArray(n) ? (n as JsonSchema) : undefined;
}

/**
 * Best-effort reverse: walker id for the deepest schema-path prefix of `ptr`.
 * A click anywhere inside a property's subtree (description, enum, ...) maps to
 * that property. Returns undefined only for pointers outside any mappable zone
 * (e.g. a foreign $defs entry key of the wrong shape).
 */
export function pointerToId(ptr: Ptr): string | undefined {
  const segs: string[] = [];
  let prefix = '';
  let i = 0;
  if (ptr[0] === '$defs') {
    if (typeof ptr[1] !== 'string') return undefined;
    prefix = DEF_PREFIX + ptr[1];
    i = 2;
  }
  while (i < ptr.length) {
    const s = ptr[i];
    if (s === 'allOf' && typeof ptr[i + 1] === 'number') {
      i += 2;
      continue;
    }
    if (s === 'properties' && typeof ptr[i + 1] === 'string') {
      segs.push(ptr[i + 1] as string);
      i += 2;
      continue;
    }
    if (s === 'items' && segs.length > 0 && !segs[segs.length - 1].endsWith('[]')) {
      segs[segs.length - 1] += '[]';
      i += 1;
      continue;
    }
    break; // deepest mappable prefix reached
  }
  if (prefix) return segs.length ? `${prefix}.${segs.join('.')}` : prefix;
  return segs.length ? segs.join('.') : ROOT_ID;
}
