// Validation model. A group is one validator family (basic checks, or one LLM
// provider's structured-output profile); each group runs a set of registry
// rules over the schema document and reports findings per rule. New checks are
// added by appending rules to a profile — the panel renders whatever comes back.

import type { Ptr } from '../jsonPointer';

export type Severity = 'error' | 'warn' | 'info';

export interface RuleMeta {
  id: string;
  severity: Severity;
  title: string;
  /** one-line explanation / remedy shown with the rule */
  hint?: string;
}

export interface Finding {
  /** JSON pointer segments into the raw schema document */
  path: Ptr;
  /** occurrence-specific detail (offending keyword, missing names, ...) */
  note?: string;
}

export interface RuleResult {
  meta: RuleMeta;
  findings: Finding[];
}

export interface GroupResult {
  id: string;
  label: string;
  /** provenance: which spec/doc these rules encode */
  note?: string;
  /** set when the group could not run (e.g. document is not valid JSON) */
  skipped?: string;
  /** only rules that produced findings */
  rules: RuleResult[];
}

/**
 * What counts as a schema root. The fact-find schema is never sent whole —
 * each top-level section is lifted out as a standalone extraction schema —
 * so 'sections' validates every entry of the root's `properties` as its own
 * root (root-type rules and size/depth limits apply per section).
 *
 * 'selection' is the same lift narrowed to one section: the top-level property
 * or `$defs` entry the canvas selection sits in, plus the defs it reaches. It
 * follows the selection, not the viewport — what depth and focus happen to be
 * drawing is a view of a section, never a schema anyone would send.
 */
export type Scope = 'document' | 'sections' | 'selection';

export interface ScopeRoot {
  label: string;
  node: Record<string, unknown>;
  ptr: Ptr;
}

export function countBySeverity(groups: GroupResult[]): Record<Severity, number> {
  const c: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const g of groups) for (const r of g.rules) c[r.meta.severity] += r.findings.length;
  return c;
}
