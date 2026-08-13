// LLM structured-output profiles. Each profile encodes one provider's
// documented schema restrictions (provenance in the group note — re-verify
// against those docs when a provider ships changes; the rules are data, so
// updating means editing a list, not the panel).
//
// Conventions shared by all profiles:
// - keyword rules run over every subschema node of the document (a section
//   extraction ships the same nodes, so per-node violations are scope-free);
// - root-shape rules and size/depth limits run per scope root ('document', or
//   each top-level section — how the fact-find schema is actually used);
// - `x-*` extension keys are ignored everywhere (assumed stripped before send);
// - counts and depths do NOT follow $refs, so on the deduped variant the
//   aggregate limits are lower bounds.

import type { JsonSchema } from '../walker';
import type { Finding, GroupResult, RuleMeta, ScopeRoot } from './types';
import { collectRefs, defCycles, forEachNode, isObjectNode } from './walk';

class Collector {
  private map = new Map<RuleMeta, Finding[]>();
  add(meta: RuleMeta, f: Finding): void {
    const arr = this.map.get(meta);
    if (arr) arr.push(f);
    else this.map.set(meta, [f]);
  }
  rules(): GroupResult['rules'] {
    return [...this.map.entries()].map(([meta, findings]) => ({ meta, findings }));
  }
}

function relativeDepth(base: number, ptr: (string | number)[]): number {
  let d = 0;
  for (let i = base; i < ptr.length; i++) {
    const s = ptr[i];
    if (s === 'properties' || s === 'items' || s === 'prefixItems') d++;
  }
  return d;
}

// ---------------------------------------------------------------- OpenAI ----

const OPENAI_FORMATS = new Set([
  'date-time', 'time', 'date', 'duration', 'email', 'hostname', 'ipv4', 'ipv6', 'uuid',
]);
const OPENAI_UNSUPPORTED = [
  'allOf', 'not', 'if', 'then', 'else', 'dependentRequired', 'dependentSchemas',
  'patternProperties', 'propertyNames', 'unevaluatedProperties', 'contains',
] as const;

const OA = {
  rootObject: {
    id: 'openai/root-object',
    severity: 'error',
    title: 'root schema must be type "object"',
  },
  rootAnyOf: {
    id: 'openai/root-anyof',
    severity: 'error',
    title: 'root schema must not be an anyOf',
  },
  additionalProps: {
    id: 'openai/additional-properties',
    severity: 'error',
    title: 'every object must set additionalProperties: false',
  },
  allRequired: {
    id: 'openai/all-required',
    severity: 'error',
    title: 'every property must be listed in `required`',
    hint: 'emulate optional fields with a ["<type>", "null"] type union',
  },
  oneOf: {
    id: 'openai/one-of',
    severity: 'error',
    title: '`oneOf` is not supported — use `anyOf`',
  },
  unsupported: {
    id: 'openai/unsupported-keyword',
    severity: 'error',
    title: 'unsupported keyword',
  },
  constKw: {
    id: 'openai/const',
    severity: 'warn',
    title: '`const` is not in the documented supported set',
    hint: 'use a single-value enum instead',
  },
  defaultKw: {
    id: 'openai/default',
    severity: 'warn',
    title: '`default` values are not supported',
  },
  format: {
    id: 'openai/format',
    severity: 'warn',
    title: '`format` value outside the supported set',
    hint: 'supported: date-time, time, date, duration, email, hostname, ipv4, ipv6, uuid (note: no uri)',
  },
  limitDepth: {
    id: 'openai/limit-depth',
    severity: 'error',
    title: 'nesting deeper than 10 levels',
  },
  limitProps: {
    id: 'openai/limit-properties',
    severity: 'error',
    title: 'more than 5,000 object properties in total',
  },
  limitEnumCount: {
    id: 'openai/limit-enum-count',
    severity: 'error',
    title: 'more than 1,000 enum values in total',
  },
  limitEnumSize: {
    id: 'openai/limit-enum-size',
    severity: 'error',
    title: 'enum with >250 values exceeds 15,000 characters of string values',
  },
  limitStringSize: {
    id: 'openai/limit-string-size',
    severity: 'warn',
    title: 'property names + enum values exceed 120,000 characters',
  },
} satisfies Record<string, RuleMeta>;

export function runOpenAI(roots: ScopeRoot[], nodeRoots: ScopeRoot[]): GroupResult {
  const c = new Collector();

  const perNode = (node: JsonSchema, ptr: (string | number)[]) => {
    if (isObjectNode(node) && node.additionalProperties !== false) {
      c.add(OA.additionalProps, {
        path: ptr,
        note: node.additionalProperties === undefined ? 'missing' : 'not false',
      });
    }
    if (isObjectNode(node) && node.properties !== undefined) {
      const req = new Set(Array.isArray(node.required) ? node.required : []);
      const missing = Object.keys(node.properties).filter((k) => !req.has(k));
      if (missing.length) c.add(OA.allRequired, { path: ptr, note: `missing: ${missing.join(', ')}` });
    }
    if (node.oneOf !== undefined) c.add(OA.oneOf, { path: ptr });
    for (const k of OPENAI_UNSUPPORTED) {
      if (node[k] !== undefined) c.add(OA.unsupported, { path: ptr, note: k });
    }
    if (node.const !== undefined) c.add(OA.constKw, { path: ptr });
    if (node.default !== undefined) c.add(OA.defaultKw, { path: ptr });
    if (typeof node.format === 'string' && !OPENAI_FORMATS.has(node.format)) {
      c.add(OA.format, { path: ptr, note: node.format });
    }
  };
  for (const r of nodeRoots) forEachNode(r.node as JsonSchema, perNode, r.ptr);

  for (const root of roots) {
    if (!isObjectNode(root.node)) c.add(OA.rootObject, { path: root.ptr, note: root.label });
    if (root.node.anyOf !== undefined) c.add(OA.rootAnyOf, { path: root.ptr, note: root.label });

    let propCount = 0;
    let enumCount = 0;
    let strSize = 0;
    let deepest: { depth: number; ptr: (string | number)[] } = { depth: 0, ptr: root.ptr };
    forEachNode(root.node as JsonSchema, (node, ptr) => {
      const depth = relativeDepth(root.ptr.length, ptr);
      if (depth > deepest.depth) deepest = { depth, ptr };
      if (node.properties !== undefined && typeof node.properties === 'object') {
        for (const name of Object.keys(node.properties)) {
          propCount++;
          strSize += name.length;
        }
      }
      if (Array.isArray(node.enum)) {
        enumCount += node.enum.length;
        const strLen = node.enum.reduce<number>(
          (acc, v) => acc + (typeof v === 'string' ? v.length : 0), 0);
        strSize += strLen;
        if (node.enum.length > 250 && strLen > 15_000) {
          c.add(OA.limitEnumSize, { path: ptr, note: `${node.enum.length} values, ${strLen} chars` });
        }
      }
    }, root.ptr);
    if (deepest.depth > 10)
      c.add(OA.limitDepth, { path: deepest.ptr, note: `${root.label}: depth ${deepest.depth}` });
    if (propCount > 5_000)
      c.add(OA.limitProps, { path: root.ptr, note: `${root.label}: ${propCount} properties` });
    if (enumCount > 1_000)
      c.add(OA.limitEnumCount, { path: root.ptr, note: `${root.label}: ${enumCount} enum values` });
    if (strSize > 120_000)
      c.add(OA.limitStringSize, { path: root.ptr, note: `${root.label}: ~${strSize} chars` });
  }

  return {
    id: 'openai',
    label: 'OpenAI strict',
    note: 'Structured Outputs strict mode — platform.openai.com/docs/guides/structured-outputs',
    rules: c.rules(),
  };
}

// ------------------------------------------------------------- Anthropic ----

const ANTHROPIC_FORMATS = new Set([
  'date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid',
]);
const ANTHROPIC_NUMERIC = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'] as const;
const ANTHROPIC_STRING = ['minLength', 'maxLength', 'pattern'] as const;
const ANTHROPIC_ARRAY = ['minItems', 'maxItems', 'uniqueItems', 'contains'] as const;
const ANTHROPIC_UNDOCUMENTED = [
  'oneOf', 'not', 'if', 'then', 'else', 'dependentRequired', 'dependentSchemas',
  'patternProperties', 'propertyNames', 'unevaluatedProperties',
] as const;

const AN = {
  additionalProps: {
    id: 'anthropic/additional-properties',
    severity: 'error',
    title: 'every object must set additionalProperties: false',
  },
  recursion: {
    id: 'anthropic/recursion',
    severity: 'error',
    title: 'recursive schemas are not supported',
  },
  numeric: {
    id: 'anthropic/numeric-constraint',
    severity: 'warn',
    title: 'numerical constraints are not supported',
    hint: 'official SDKs strip these and validate client-side',
  },
  string: {
    id: 'anthropic/string-constraint',
    severity: 'warn',
    title: 'string constraints (minLength/maxLength/pattern) are not supported',
    hint: 'official SDKs strip these and validate client-side',
  },
  array: {
    id: 'anthropic/array-constraint',
    severity: 'warn',
    title: 'array constraints are not supported',
    hint: 'official SDKs strip these and validate client-side',
  },
  format: {
    id: 'anthropic/format',
    severity: 'warn',
    title: '`format` value outside the supported set',
    hint: 'supported: date-time, time, date, duration, email, hostname, uri, ipv4, ipv6, uuid',
  },
  undocumented: {
    id: 'anthropic/undocumented-keyword',
    severity: 'warn',
    title: 'keyword not in the documented supported set',
    hint: 'documented: types, enum, const, anyOf, allOf, $ref/$defs, formats, additionalProperties: false',
  },
} satisfies Record<string, RuleMeta>;

export function runAnthropic(
  doc: JsonSchema,
  nodeRoots: ScopeRoot[],
  defNames?: ReadonlySet<string>,
): GroupResult {
  const c = new Collector();

  const perNode = (node: JsonSchema, ptr: (string | number)[]) => {
    if (isObjectNode(node) && node.additionalProperties !== false) {
      c.add(AN.additionalProps, {
        path: ptr,
        note: node.additionalProperties === undefined ? 'missing' : 'not false',
      });
    }
    for (const k of ANTHROPIC_NUMERIC) if (node[k] !== undefined) c.add(AN.numeric, { path: ptr, note: k });
    for (const k of ANTHROPIC_STRING) if (node[k] !== undefined) c.add(AN.string, { path: ptr, note: k });
    for (const k of ANTHROPIC_ARRAY) if (node[k] !== undefined) c.add(AN.array, { path: ptr, note: k });
    for (const k of ANTHROPIC_UNDOCUMENTED) if (node[k] !== undefined) c.add(AN.undocumented, { path: ptr, note: k });
    if (typeof node.format === 'string' && !ANTHROPIC_FORMATS.has(node.format)) {
      c.add(AN.format, { path: ptr, note: node.format });
    }
  };
  for (const r of nodeRoots) forEachNode(r.node as JsonSchema, perNode, r.ptr);

  // the cycle graph is document-wide; `defNames` narrows the report to the defs
  // the current scope actually ships (undefined = the whole document)
  for (const name of defCycles(doc)) {
    if (defNames && !defNames.has(name)) continue;
    c.add(AN.recursion, { path: ['$defs', name], note: `$defs/${name} reaches itself` });
  }
  for (const r of nodeRoots) {
    for (const { ref, ptr } of collectRefs(r.node as JsonSchema, r.ptr)) {
      if (ref === '#') c.add(AN.recursion, { path: ptr, note: 'ref to document root' });
    }
  }

  return {
    id: 'anthropic',
    label: 'Anthropic',
    note: 'Claude structured outputs / strict tool use — platform.claude.com/docs/en/build-with-claude/structured-outputs',
    rules: c.rules(),
  };
}

// ---------------------------------------------------------------- Gemini ----

const GEMINI_ALLOWED = new Set([
  'type', 'format', 'title', 'description', 'enum', 'items', 'prefixItems',
  'minItems', 'maxItems', 'minimum', 'maximum', 'anyOf', 'oneOf',
  'properties', 'additionalProperties', 'required', 'propertyOrdering',
]);

const GE = {
  refSiblings: {
    id: 'gemini/ref-siblings',
    severity: 'error',
    title: '$ref node carries sibling keys',
    hint: 'when $ref is set, only $-prefixed sibling properties are allowed',
  },
  recursion: {
    id: 'gemini/recursion',
    severity: 'warn',
    title: 'cyclic $refs',
    hint: 'cycles are unrolled to a limited depth and allowed only within non-required properties',
  },
  unsupported: {
    id: 'gemini/unsupported-keyword',
    severity: 'warn',
    title: 'keyword outside the supported set (ignored by Gemini)',
    hint: 'supported: type, format, title, description, enum, items, prefixItems, min/maxItems, min/maximum, anyOf, oneOf, properties, additionalProperties, required, propertyOrdering, $id, $defs, $ref, $anchor',
  },
} satisfies Record<string, RuleMeta>;

export function runGemini(
  doc: JsonSchema,
  nodeRoots: ScopeRoot[],
  defNames?: ReadonlySet<string>,
): GroupResult {
  const c = new Collector();

  const perNode = (node: JsonSchema, ptr: (string | number)[]) => {
    const keys = Object.keys(node);
    if (typeof node.$ref === 'string') {
      const siblings = keys.filter((k) => !k.startsWith('$') && !k.startsWith('x-'));
      if (siblings.length) c.add(GE.refSiblings, { path: ptr, note: siblings.join(', ') });
    }
    for (const k of keys) {
      if (k.startsWith('$') || k.startsWith('x-')) continue;
      if (!GEMINI_ALLOWED.has(k)) c.add(GE.unsupported, { path: ptr, note: k });
    }
  };
  for (const r of nodeRoots) forEachNode(r.node as JsonSchema, perNode, r.ptr);

  // as in the Anthropic profile: report only the defs this scope ships
  for (const name of defCycles(doc)) {
    if (defNames && !defNames.has(name)) continue;
    c.add(GE.recursion, { path: ['$defs', name], note: `$defs/${name}` });
  }
  for (const r of nodeRoots) {
    for (const { ref, ptr } of collectRefs(r.node as JsonSchema, r.ptr)) {
      if (ref === '#') c.add(GE.recursion, { path: ptr, note: 'ref to document root' });
    }
  }

  return {
    id: 'gemini',
    label: 'Gemini',
    note: 'responseJsonSchema — ai.google.dev/gemini-api/docs/structured-output',
    rules: c.rules(),
  };
}
