import type { JsonSchema } from '../walker';
import { idToPointer, nodeAt } from '../jsonPointer';
import type { GroupResult, Scope, ScopeRoot } from './types';
import { runBasic } from './basic';
import { runAnthropic, runGemini, runOpenAI } from './profiles';
import { collectRefs } from './walk';

export type { Finding, GroupResult, RuleResult, Scope, Severity } from './types';
export { countBySeverity } from './types';

const DEFS_REF = '#/$defs/';

function scopeRoots(doc: JsonSchema, scope: Scope, section: string | undefined): ScopeRoot[] {
  // one section, named by the selection: no section resolved means no root at
  // all, which the caller reports as a skip rather than an empty pass
  if (scope === 'selection') {
    if (section === undefined) return [];
    const ptr = idToPointer(doc, section);
    const node = nodeAt(doc, section);
    return ptr && node ? [{ label: section, node, ptr }] : [];
  }
  if (scope === 'sections' && doc.properties && Object.keys(doc.properties).length > 0) {
    return Object.entries(doc.properties)
      .filter(([, node]) => typeof node === 'object' && node !== null)
      .map(([name, node]) => ({ label: name, node, ptr: ['properties', name] }));
  }
  return [{ label: 'schema', node: doc, ptr: [] }];
}

/**
 * The `$defs` entries a node reaches through the ref graph, transitively —
 * the defs that travel with a section when it is lifted out. `own` is the
 * section's own def name when the section *is* a def, so a self-referential
 * def is not also walked as a second node root.
 */
function reachableDefs(doc: JsonSchema, node: JsonSchema, own: string | undefined): ScopeRoot[] {
  const defs = doc.$defs;
  if (!defs) return [];
  const seen = new Set(own === undefined ? [] : [own]);
  const out: ScopeRoot[] = [];
  const queue: JsonSchema[] = [node];
  while (queue.length) {
    for (const { ref } of collectRefs(queue.pop()!)) {
      if (!ref.startsWith(DEFS_REF)) continue;
      const name = ref.slice(DEFS_REF.length).split('/')[0];
      const def = defs[name];
      if (seen.has(name) || typeof def !== 'object' || def === null) continue;
      seen.add(name);
      out.push({ label: `$defs/${name}`, node: def, ptr: ['$defs', name] });
      queue.push(def);
    }
  }
  return out;
}

// Per-node keyword rules run over what actually gets shipped: in sections
// scope that is each section subtree plus $defs (shared by every extraction),
// NOT the document-root wrapper — it is never sent to a model. In selection
// scope only the defs that section actually reaches ship with it, so those are
// the only ones it answers for.
function nodeRoots(doc: JsonSchema, roots: ScopeRoot[], scope: Scope): ScopeRoot[] {
  if (roots.length === 1 && roots[0].node === doc) return roots;
  if (scope === 'selection') {
    const root = roots[0];
    if (root === undefined) return roots;
    const own = root.ptr[0] === '$defs' ? String(root.ptr[1]) : undefined;
    return [root, ...reachableDefs(doc, root.node as JsonSchema, own)];
  }
  const out = [...roots];
  if (doc.$defs) {
    for (const [name, def] of Object.entries(doc.$defs)) {
      if (typeof def === 'object' && def !== null)
        out.push({ label: `$defs/${name}`, node: def, ptr: ['$defs', name] });
    }
  }
  return out;
}

function skippedProfiles(skipped: string): GroupResult[] {
  return [
    { id: 'openai', label: 'OpenAI strict', skipped, rules: [] },
    { id: 'anthropic', label: 'Anthropic', skipped, rules: [] },
    { id: 'gemini', label: 'Gemini', skipped, rules: [] },
  ];
}

/**
 * Run every validator group. `doc` is the already-parsed schema (undefined when
 * parsing failed or nothing is loaded); `raw` is the file text, used only to
 * produce a located JSON syntax error when `doc` is missing. `section` names
 * the root for 'selection' scope and is ignored by the others.
 */
export function runValidation(
  raw: string | undefined,
  doc: JsonSchema | undefined,
  scope: Scope,
  section?: string,
): GroupResult[] {
  const basic = runBasic(raw, doc);
  if (doc === undefined) {
    return [basic, ...skippedProfiles(
      raw === undefined ? 'no schema loaded' : 'document is not valid JSON',
    )];
  }
  const roots = scopeRoots(doc, scope, section);
  // 'selection' with nothing selected has no root to validate. Reporting that
  // as a pass would be a lie the collapsed strip has no room to qualify.
  if (roots.length === 0) return [basic, ...skippedProfiles('no section selected')];
  const nodes = nodeRoots(doc, roots, scope);
  // The recursion checks read the document-wide $defs graph; under 'selection'
  // only the defs this section ships are its problem.
  const defNames =
    scope === 'selection'
      ? new Set(nodes.filter((n) => n.ptr[0] === '$defs').map((n) => String(n.ptr[1])))
      : undefined;
  return [
    basic,
    runOpenAI(roots, nodes),
    runAnthropic(doc, nodes, defNames),
    runGemini(doc, nodes, defNames),
  ];
}
