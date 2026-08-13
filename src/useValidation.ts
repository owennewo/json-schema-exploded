import { useMemo } from 'react';
import { useExplodedStore } from './store';
import { sectionOf } from './jsonPointer';
import {
  countBySeverity,
  runValidation,
  type GroupResult,
  type Scope,
  type Severity,
} from './validation';

export interface ValidationView {
  groups: GroupResult[];
  totals: Record<Severity, number>;
  scope: Scope;
  sectionsAvailable: boolean;
  /** the section 'selection' scope resolved to, for the picker to name */
  selectedSection: string | undefined;
}

/**
 * One validation run, shared. The header reports the verdict and the footer
 * locates it; running the profiles twice over a 4000-line schema to render two
 * views of the same answer would be the wrong kind of decoupling.
 *
 * The fact-find schema is consumed one section at a time, so the default scope
 * is per-section whenever the document has top-level properties.
 *
 * `anchorId` is the selection resolved to its entity (row -> owner, edge ->
 * source). The raw selection is tried first: a scalar row on the root card
 * names a section of its own, while its anchor is only the root.
 */
export function useValidation(anchorId: string | undefined): ValidationView {
  const schemaDoc = useExplodedStore((s) => s.schemaDoc);
  const schemaRaw = useExplodedStore((s) => s.schemaRaw);
  const choice = useExplodedStore((s) => s.vScope);
  const selectedId = useExplodedStore((s) => s.selectedId);

  const sectionsAvailable =
    schemaDoc?.properties !== undefined && Object.keys(schemaDoc.properties).length > 0;
  const scope: Scope = choice ?? (sectionsAvailable ? 'sections' : 'document');
  const selectedSection = sectionOf(selectedId) ?? sectionOf(anchorId);

  // the section is part of the memo key only where it is part of the answer —
  // otherwise every click on the canvas would re-run the profiles for nothing
  const section = scope === 'selection' ? selectedSection : undefined;
  const groups = useMemo(
    () => runValidation(schemaRaw, schemaDoc, scope, section),
    [schemaRaw, schemaDoc, scope, section],
  );
  const totals = useMemo(() => countBySeverity(groups), [groups]);

  return { groups, totals, scope, sectionsAvailable, selectedSection };
}
