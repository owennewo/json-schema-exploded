import { create } from 'zustand';
import type { JsonSchema } from './walker';
import type { SchemaSource } from './sources';
import { readStoredTheme, resolveTheme, storeTheme, type Resolved, type Theme } from './theme';
import { patchSession, readSession } from './session';
import type { Scope } from './validation';

/**
 * How deep, measured downstream from the anchor entity, each thing is drawn.
 * Level 1 is the anchor itself, its children are level 2, and "child" means
 * any outgoing edge — containment and ref alike. `Infinity` is "all".
 *
 * The row settings count cards: scalar 1 = only the anchor lists its scalar
 * props. The edge setting counts hops, so edges 1 = the anchor's own child
 * edges, revealing level 2 — and a card is only drawn if an edge reached it.
 */
export interface DepthSettings {
  scalar: number;
  object: number;
  edges: number;
}

// edges 1 draws the anchor and its direct children — for the fact-find schema
// that is the root plus its sections, which is where you want to start. Depth
// is the only visibility gate there is, so this is the whole first paint.
export const DEFAULT_DEPTH: DepthSettings = { scalar: 1, object: 1, edges: 1 };

interface ExplodedState {
  /** selected entity or row id (schema path) */
  selectedId: string | undefined;
  /** the raw loaded schema document (source of truth for copy-section) */
  schemaDoc: JsonSchema | undefined;
  /** where the loaded schema came from — a share link has to name it */
  schemaSource: SchemaSource | undefined;
  /** the schema file's text as fetched — validation reports syntax errors from it */
  schemaRaw: string | undefined;
  /** side-panel visibility (left = JSON view, right = detail view) */
  leftOpen: boolean;
  rightOpen: boolean;
  /** footer validation panel visibility */
  bottomOpen: boolean;
  /** global focus mode: show only the selected entity's neighborhood */
  focus: boolean;
  /** theme preference (persisted) and the light/dark it currently resolves to */
  theme: Theme;
  resolvedTheme: Resolved;
  /** row/edge depth gates, measured downstream from the anchor */
  depth: DepthSettings;
  /**
   * Validation scope. Lives here rather than in the footer because the header
   * pill reports the same run: undefined means "the default for this
   * document" (per-section when the document has sections).
   */
  vScope: Scope | undefined;
  select: (id: string | undefined) => void;
  setVScope: (scope: Scope | undefined) => void;
  setDepth: (patch: Partial<DepthSettings>) => void;
  setSchemaDoc: (doc: JsonSchema | undefined) => void;
  setSchemaSource: (source: SchemaSource | undefined) => void;
  setSchemaRaw: (raw: string | undefined) => void;
  toggleLeft: () => void;
  toggleRight: () => void;
  toggleBottom: () => void;
  toggleFocus: () => void;
  /** focus at a known value — a shared link says which, rather than flipping it */
  setFocus: (focus: boolean) => void;
  setTheme: (theme: Theme) => void;
  /** re-resolve "system" after an OS preference change */
  syncSystemTheme: () => void;
}

const initialTheme = readStoredTheme();
// panel/focus state opens where the last session left it (see session.ts).
// The schema-scoped state — selection, depth, viewport — is restored by App,
// which is the thing that knows which schema finished loading.
const session = readSession();

export const useExplodedStore = create<ExplodedState>((set) => ({
  selectedId: undefined,
  schemaDoc: undefined,
  schemaSource: undefined,
  schemaRaw: undefined,
  leftOpen: session.leftOpen,
  rightOpen: session.rightOpen,
  bottomOpen: session.bottomOpen,
  focus: session.focus,
  theme: initialTheme,
  resolvedTheme: resolveTheme(initialTheme),
  depth: DEFAULT_DEPTH,
  vScope: session.vScope,
  select: (id) => set({ selectedId: id }),
  setVScope: (vScope) => {
    patchSession({ vScope });
    set({ vScope });
  },
  setDepth: (patch) => set((s) => ({ depth: { ...s.depth, ...patch } })),
  setSchemaDoc: (doc) => set({ schemaDoc: doc }),
  setSchemaSource: (schemaSource) => set({ schemaSource }),
  setSchemaRaw: (raw) => set({ schemaRaw: raw }),
  toggleLeft: () =>
    set((s) => {
      const leftOpen = !s.leftOpen;
      patchSession({ leftOpen });
      return { leftOpen };
    }),
  toggleRight: () =>
    set((s) => {
      const rightOpen = !s.rightOpen;
      patchSession({ rightOpen });
      return { rightOpen };
    }),
  toggleBottom: () =>
    set((s) => {
      const bottomOpen = !s.bottomOpen;
      patchSession({ bottomOpen });
      return { bottomOpen };
    }),
  toggleFocus: () =>
    set((s) => {
      const focus = !s.focus;
      patchSession({ focus });
      return { focus };
    }),
  setFocus: (focus) => {
    patchSession({ focus });
    set({ focus });
  },
  setTheme: (theme) => {
    storeTheme(theme);
    set({ theme, resolvedTheme: resolveTheme(theme) });
  },
  syncSystemTheme: () => set((s) => ({ resolvedTheme: resolveTheme(s.theme) })),
}));
