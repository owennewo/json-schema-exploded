import type { Point } from './layout';
import { DEFAULT_DEPTH, type DepthSettings } from './store';

// <name>.schema.json -> <name>.layout.json, stored next to the schema.
// Keys are schema paths so the file survives schema edits.
export interface LayoutFile {
  positions: Record<string, Point>;
  /** view prefs: how deep rows and edges are drawn (see DepthSettings) */
  depth: DepthSettings;
}

/** what a file on disk actually held — one written before depth existed has none */
export interface LoadedLayout extends Omit<LayoutFile, 'depth'> {
  depth?: DepthSettings;
}

/** Infinity has no JSON spelling, so "all" is the on-disk form */
type DepthJson = number | 'all';

export function depthToJson(d: DepthSettings): Record<keyof DepthSettings, DepthJson> {
  const one = (v: number): DepthJson => (Number.isFinite(v) ? v : 'all');
  return { scalar: one(d.scalar), object: one(d.object), edges: one(d.edges) };
}

function depthFromJson(raw: unknown): DepthSettings {
  const src = (raw ?? {}) as Record<string, unknown>;
  const one = (v: unknown, fallback: number): number =>
    typeof v === 'number' && v >= 0 ? v : v === 'all' ? Infinity : fallback;
  return {
    scalar: one(src.scalar, DEFAULT_DEPTH.scalar),
    object: one(src.object, DEFAULT_DEPTH.object),
    edges: one(src.edges, DEFAULT_DEPTH.edges),
  };
}

export function layoutFileName(schemaName: string): string {
  return schemaName.replace(/\.schema\.json$/, '') + '.layout.json';
}

export async function loadLayout(schemaName: string): Promise<LoadedLayout | null> {
  try {
    const res = await fetch(`/schemas/${layoutFileName(schemaName)}`);
    if (!res.ok) return null;
    const data = await res.json();
    // no depth key at all is not "the defaults" — it is no answer, which lets
    // the caller fall back to whatever the browser session remembers
    const depth = data.depth === undefined ? undefined : depthFromJson(data.depth);
    // A file written before depth replaced collapse means "this much depth,
    // but with those cards folded" — its edge setting was never the whole
    // story. Translate the fold to the nearest thing the depth model has (the
    // anchor and its children) rather than opening the whole graph at once.
    // One-time: `collapsed` is dropped on the next save.
    if (depth && Array.isArray(data.collapsed) && data.collapsed.length > 0)
      depth.edges = Math.min(depth.edges, 1);
    return { positions: data.positions ?? {}, depth };
  } catch {
    return null;
  }
}

export async function saveLayout(schemaName: string, data: LayoutFile): Promise<void> {
  await fetch(`/schemas/${layoutFileName(schemaName)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positions: data.positions, depth: depthToJson(data.depth) }, null, 2),
  });
}
