// Reference inliner: replace a `$ref` node with the def's contents, then apply
// the node's sibling keys on top (siblings win). This is the same rule the
// dedupe round-trip verifier uses, so inlining a deduped section reproduces the
// flat schema's section exactly. Unresolvable refs are left as-is (v2's
// ref-support renders those as unresolved-ref badges).
export function inlineRefs<T>(node: T, defs: Record<string, unknown>): T {
  if (Array.isArray(node)) return node.map((n) => inlineRefs(n, defs)) as T;
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (typeof obj.$ref === 'string') {
      const name = obj.$ref.replace('#/$defs/', '');
      const def = defs[name];
      if (def === undefined || typeof def !== 'object') return node;
      const target = inlineRefs(structuredClone(def), defs) as Record<string, unknown>;
      const siblings: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) if (k !== '$ref') siblings[k] = inlineRefs(v, defs);
      return { ...target, ...siblings } as T;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = inlineRefs(v, defs);
    return out as T;
  }
  return node;
}
