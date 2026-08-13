import { useExplodedStore } from './store';
import { inlineRefs } from './inline';

/**
 * Put the flat JSON subtree for a top-level section on the clipboard — the
 * exact text pasted into an extraction prompt. On a schema with $defs, refs
 * are inlined first so the output matches the flat schema's section.
 */
export async function copySectionSchema(sectionId: string): Promise<boolean> {
  const doc = useExplodedStore.getState().schemaDoc;
  const section = sectionId.startsWith('$defs/')
    ? doc?.$defs?.[sectionId.slice('$defs/'.length)]
    : doc?.properties?.[sectionId];
  if (!section) return false;
  const flat = doc?.$defs ? inlineRefs(section, doc.$defs) : section;
  const text = JSON.stringify(flat, null, 2);
  if (import.meta.env.DEV) (window as { __lastCopiedSchema?: string }).__lastCopiedSchema = text;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // clipboard can be unavailable (headless, permissions) — dev hook above still works
    return import.meta.env.DEV;
  }
}
