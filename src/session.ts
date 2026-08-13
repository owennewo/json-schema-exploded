// Browser-local view state: the handful of things that decide what the app
// looks like the moment it opens — which schema, which panels, where you were
// on the canvas. A reload is a page refresh, not a fresh start.
//
// This is deliberately *not* the layout file's job. `<schema>.layout.json` is
// the on-disk record of one schema's graph — positions, and the depth it opens
// at — and it only exists while a dev server is there to write it. This store
// is the browser's own, which is where the rest of the session belongs: what
// was selected, where the canvas was, which panels were up.
//
// Everything here is best-effort: storage can be unavailable (private mode) or
// hold a shape from an older build, and neither is worth an error on screen.
// Anything unreadable falls back to the defaults below.

import type { DepthSettings } from './store';
import type { Scope } from './validation';

const KEY = 'jse.session.v1';
const SCOPES = new Set<string>(['document', 'sections', 'selection']);

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** what you were looking at in one schema */
export interface SchemaSession {
  /** last selection (entity, row or edge id) — the anchor depth is graded from */
  selectedId?: string;
  /** mirror of the layout file's depth, for when that file cannot be written */
  depth?: DepthSettings;
  viewport?: Viewport;
}

export interface Session {
  /** last schema that loaded successfully */
  schemaName?: string;
  /**
   * Schema URLs typed into the picker or arrived on `?remote=`. Kept so they
   * survive a reload — an ad-hoc schema is otherwise gone the moment you look
   * away from it. Newest first, and capped: this is a recent list, not a
   * library.
   */
  remoteUrls: string[];
  leftOpen: boolean;
  rightOpen: boolean;
  bottomOpen: boolean;
  focus: boolean;
  snap: boolean;
  jsonMode: 'tree' | 'raw' | 'defs';
  /** undefined = the default scope for the document (see useValidation) */
  vScope?: Scope;
  schemas: Record<string, SchemaSession>;
}

const DEFAULTS: Session = {
  remoteUrls: [],
  leftOpen: true,
  rightOpen: true,
  bottomOpen: false,
  focus: false,
  snap: false,
  jsonMode: 'tree',
  schemas: {},
};

/** how many ad-hoc URLs the picker remembers */
export const REMOTE_URL_LIMIT = 10;

/** newest first, no duplicates, oldest dropped past the limit */
export function rememberRemoteUrl(url: string): string[] {
  const remoteUrls = [url, ...readSession().remoteUrls.filter((u) => u !== url)].slice(
    0,
    REMOTE_URL_LIMIT,
  );
  patchSession({ remoteUrls });
  return remoteUrls;
}

/** Infinity has no JSON spelling, so "all" is the stored form (as on disk) */
type DepthJson = number | 'all';

function encodeDepth(d: DepthSettings): Record<keyof DepthSettings, DepthJson> {
  const one = (v: number): DepthJson => (Number.isFinite(v) ? v : 'all');
  return { scalar: one(d.scalar), object: one(d.object), edges: one(d.edges) };
}

function decodeDepth(raw: unknown): DepthSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const src = raw as Record<string, unknown>;
  const one = (v: unknown): number | undefined =>
    typeof v === 'number' && v >= 0 ? v : v === 'all' ? Infinity : undefined;
  const scalar = one(src.scalar);
  const object = one(src.object);
  const edges = one(src.edges);
  if (scalar === undefined || object === undefined || edges === undefined) return undefined;
  return { scalar, object, edges };
}

function decodeViewport(raw: unknown): Viewport | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { x, y, zoom } = raw as Record<string, unknown>;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof zoom !== 'number') return undefined;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !(zoom > 0)) return undefined;
  return { x, y, zoom };
}

function decodeSchemas(raw: unknown): Record<string, SchemaSession> {
  const out: Record<string, SchemaSession> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const src = value as Record<string, unknown>;
    out[name] = {
      selectedId: typeof src.selectedId === 'string' ? src.selectedId : undefined,
      depth: decodeDepth(src.depth),
      viewport: decodeViewport(src.viewport),
    };
  }
  return out;
}

function decode(text: string): Session {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  return {
    schemaName: typeof raw.schemaName === 'string' ? raw.schemaName : undefined,
    remoteUrls: Array.isArray(raw.remoteUrls)
      ? raw.remoteUrls.filter((u): u is string => typeof u === 'string').slice(0, 10)
      : [],
    leftOpen: bool(raw.leftOpen, DEFAULTS.leftOpen),
    rightOpen: bool(raw.rightOpen, DEFAULTS.rightOpen),
    bottomOpen: bool(raw.bottomOpen, DEFAULTS.bottomOpen),
    focus: bool(raw.focus, DEFAULTS.focus),
    snap: bool(raw.snap, DEFAULTS.snap),
    jsonMode: raw.jsonMode === 'raw' || raw.jsonMode === 'defs' ? raw.jsonMode : 'tree',
    vScope: SCOPES.has(raw.vScope as string) ? (raw.vScope as Scope) : undefined,
    schemas: decodeSchemas(raw.schemas),
  };
}

// Read once at startup and keep the live copy here: every writer patches this
// object, so no caller ever has to re-read and re-merge what another wrote.
let current: Session = (() => {
  try {
    const text = localStorage.getItem(KEY);
    return text ? decode(text) : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
})();

function flush(): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        ...current,
        schemas: Object.fromEntries(
          Object.entries(current.schemas).map(([name, s]) => [
            name,
            { ...s, depth: s.depth && encodeDepth(s.depth) },
          ]),
        ),
      }),
    );
  } catch {
    /* storage full or unavailable — the session just won't survive a reload */
  }
}

export function readSession(): Session {
  return current;
}

/** what was last open in one schema; never undefined, so callers can destructure */
export function readSchemaSession(schemaName: string): SchemaSession {
  return current.schemas[schemaName] ?? {};
}

export function patchSession(patch: Partial<Session>): void {
  current = { ...current, ...patch };
  flush();
}

export function patchSchemaSession(schemaName: string, patch: Partial<SchemaSession>): void {
  const next = { ...readSchemaSession(schemaName), ...patch };
  current = { ...current, schemas: { ...current.schemas, [schemaName]: next } };
  flush();
}
