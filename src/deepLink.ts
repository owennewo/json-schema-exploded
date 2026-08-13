/**
 * The view as a link.
 *
 * `?remote=` already says which schema (see sources.ts); these parameters say
 * what you were looking at inside it — the anchor, focus mode, and the three
 * depth axes. Without them a shared URL drops someone at the schema's front
 * door with 159 definitions and no clue which one you meant.
 *
 * Applied once, on the load they arrived with, and then wiped off the address
 * bar. The session store already remembers selection, depth and viewport per
 * schema, so a reload keeps the view; leaving the parameters up would only
 * mean the URL describes a view you have since clicked away from.
 */
import { useExplodedStore, type DepthSettings } from './store';
import { REMOTE_PARAM } from './sources';

/** a local or listed schema, by the name the picker shows */
export const SCHEMA_PARAM = 'schema';
/** the view inside it — cleared from the address bar once applied */
export const VIEW_PARAMS = ['sel', 'focus', 'd'] as const;

export interface ViewLink {
  /** schema URL, for anything fetched: portable in a way a name is not */
  remote?: string;
  /** schema name, for a file in `schemas/` that has no URL to give */
  schema?: string;
  /** entity, row or edge id — the anchor, and what the detail panel shows */
  selectedId?: string;
  focus?: boolean;
  depth?: DepthSettings;
}

/** `Infinity` has no URL spelling, so "all" is the wire form (as on disk) */
const stepOut = (n: number): string => (Number.isFinite(n) ? String(n) : 'all');

const stepIn = (raw: string): number | undefined => {
  if (raw === 'all') return Infinity;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
};

/** all three axes in one parameter, dot-separated: `d=1.2.all` */
function depthIn(raw: string | null): DepthSettings | undefined {
  const parts = raw?.split('.') ?? [];
  if (parts.length !== 3) return undefined;
  const [scalar, object, edges] = parts.map(stepIn);
  if (scalar === undefined || object === undefined || edges === undefined) return undefined;
  return { scalar, object, edges };
}

export function readViewLink(search: string = window.location.search): ViewLink {
  const p = new URLSearchParams(search);
  const text = (key: string): string | undefined => p.get(key)?.trim() || undefined;
  return {
    remote: text(REMOTE_PARAM),
    schema: text(SCHEMA_PARAM),
    selectedId: text('sel'),
    focus: p.get('focus') === '1' ? true : p.get('focus') === '0' ? false : undefined,
    depth: depthIn(p.get('d')),
  };
}

/** an absolute link to this view, for the clipboard */
export function shareLink(view: ViewLink): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  const p = url.searchParams;
  // a URL travels; a name only means something to someone with the same
  // schemas/ directory, so it is the fallback rather than the first choice
  if (view.remote) p.set(REMOTE_PARAM, view.remote);
  else if (view.schema) p.set(SCHEMA_PARAM, view.schema);
  if (view.selectedId) p.set('sel', view.selectedId);
  if (view.focus) p.set('focus', '1');
  if (view.depth) p.set('d', `${stepOut(view.depth.scalar)}.${stepOut(view.depth.object)}.${stepOut(view.depth.edges)}`);
  return url.toString();
}

/**
 * The view as it stands, right now, optionally anchored somewhere other than
 * the current selection — which is what a per-card button wants.
 *
 * Reads the store at call time rather than subscribing to it. A hook would put
 * every card that renders one of these buttons on the selection, focus and
 * depth subscriptions, so clicking a single card would re-render all eighty of
 * them. Nothing here is needed until the button is pressed.
 */
export function shareLinkNow(anchorId?: string): string {
  const s = useExplodedStore.getState();
  return shareLink({
    remote: s.schemaSource?.url,
    schema: s.schemaSource?.url ? undefined : s.schemaSource?.name,
    selectedId: anchorId ?? s.selectedId,
    focus: s.focus,
    depth: s.depth,
  });
}

/** drop the view parameters, keeping whatever else is on the address bar */
export function clearViewParams(): void {
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of VIEW_PARAMS)
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  if (url.searchParams.has(SCHEMA_PARAM)) {
    url.searchParams.delete(SCHEMA_PARAM);
    changed = true;
  }
  if (changed) window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}
