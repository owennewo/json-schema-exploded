import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  ControlButton,
  Controls,
  MiniMap,
  applyNodeChanges,
  type Edge,
  type NodeChange,
  type NodeMouseHandler,
  type OnNodeDrag,
  type ReactFlowInstance,
} from '@xyflow/react';
import { DEF_PREFIX, walkSchema, type JsonSchema, type WalkResult } from './walker';
import { computeTwins } from './twins';
import { indexUseSites, type UseSite } from './defUses';
import { computeLevels, depthHiddenIds, edgeViews, rowViews, type RowView } from './depth';
import { layoutPositions, type Point } from './layout';
import { EntityNode, type EntityFlowNode } from './EntityNode';
import { DetailPanel } from './DetailPanel';
import { JsonPanel } from './JsonPanel';
import { ValidationPanel } from './ValidationPanel';
import { Header } from './Header';
import { useExplodedStore, DEFAULT_DEPTH } from './store';
import { useValidation } from './useValidation';
import { depthToJson, loadLayout, saveLayout, type LayoutFile } from './layoutFile';
import {
  patchSchemaSession,
  patchSession,
  readSchemaSession,
  readSession,
  rememberRemoteUrl,
} from './session';
import { applyResolved, onSystemThemeChange } from './theme';
import {
  adhocSources,
  fetchSchemaText,
  loadSources,
  normalizeUrl,
  REMOTE_PARAM,
  type SchemaSource,
} from './sources';
import { clearViewParams, readViewLink, type ViewLink } from './deepLink';

/**
 * The link this page was opened with, read at import time. Effects rewrite the
 * address bar, so by the time one runs the parameters may already be gone —
 * reading them here is the only point at which they are certainly still there.
 */
const OPENED_WITH: ViewLink = readViewLink();

const nodeTypes = { entity: EntityNode };
const DEFAULT_SCHEMA = 'ifa-factscribe.schema.json';
/** the canvas background dots are on this pitch, so snapping lands on them */
const SNAP_GRID: [number, number] = [20, 20];

/** how much of each card's subtree the current depth leaves undrawn */
interface Residue {
  ents: number;
  rows: number;
}

function residueOf(walk: WalkResult, hidden: ReadonlySet<string>): Map<string, Residue> {
  const children = new Map<string, string[]>();
  for (const e of walk.edges) {
    if (e.kind !== 'containment') continue;
    const arr = children.get(e.source);
    if (arr) arr.push(e.target);
    else children.set(e.source, [e.target]);
  }
  // link rows are the child cards themselves, counted by `ents`, not as props
  const rowsOf = new Map(walk.entities.map((e) => [e.id, e.rows.filter((r) => !r.link).length]));
  const memo = new Map<string, Residue>();
  const compute = (id: string): Residue => {
    const cached = memo.get(id);
    if (cached) return cached;
    // set before recursing: a containment cycle would otherwise not terminate
    const acc: Residue = { ents: 0, rows: 0 };
    memo.set(id, acc);
    for (const kid of children.get(id) ?? []) {
      const s = compute(kid);
      acc.ents += s.ents + (hidden.has(kid) ? 1 : 0);
      acc.rows += s.rows + (hidden.has(kid) ? (rowsOf.get(kid) ?? 0) : 0);
    }
    return acc;
  };
  for (const e of walk.entities) compute(e.id);
  return memo;
}

function serializeLayout(l: LayoutFile): string {
  return JSON.stringify({ positions: l.positions, depth: depthToJson(l.depth) });
}

/** the subgraph handed to the layout algorithm: what depth and focus leave drawn */
function visibleGraph(
  result: WalkResult,
  hidden: ReadonlySet<string>,
): Pick<WalkResult, 'entities' | 'edges'> {
  return {
    entities: result.entities.filter((e) => !hidden.has(e.id)),
    edges: result.edges.filter((e) => !hidden.has(e.source) && !hidden.has(e.target)),
  };
}

/**
 * The entity a selection grades depth from: an entity anchors itself, a row
 * anchors its owner, an edge its source. Returns undefined for an id that is
 * not in this walk at all — which is also how a restored selection is checked
 * against a schema that may have been edited since.
 */
function anchorOf(walk: WalkResult, selectedId: string | undefined): string | undefined {
  if (!selectedId) return undefined;
  if (walk.entities.some((e) => e.id === selectedId)) return selectedId;
  const owner = walk.entities.find((e) => e.rows.some((r) => r.id === selectedId));
  if (owner) return owner.id;
  return walk.edges.find((e) => e.id === selectedId)?.source;
}

export default function App() {
  // undefined until the local listing and the remote URL map have both
  // answered — which schema `schemaName` names, and where it is fetched from,
  // is not known before then
  const [sources, setSources] = useState<SchemaSource[]>();
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);
  const [schemaName, setSchemaName] = useState(() => readSession().schemaName ?? DEFAULT_SCHEMA);
  const [result, setResult] = useState<WalkResult>();
  const [nodes, setNodes] = useState<EntityFlowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [driftWarnings, setDriftWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [snap, setSnap] = useState(() => readSession().snap);

  const setSchemaDoc = useExplodedStore((s) => s.setSchemaDoc);
  const setSchemaRaw = useExplodedStore((s) => s.setSchemaRaw);
  const select = useExplodedStore((s) => s.select);
  const focus = useExplodedStore((s) => s.focus);
  const toggleFocus = useExplodedStore((s) => s.toggleFocus);
  const setFocus = useExplodedStore((s) => s.setFocus);
  const setVScope = useExplodedStore((s) => s.setVScope);
  const selectedId = useExplodedStore((s) => s.selectedId);
  const resolvedTheme = useExplodedStore((s) => s.resolvedTheme);
  const syncSystemTheme = useExplodedStore((s) => s.syncSystemTheme);
  const depth = useExplodedStore((s) => s.depth);
  const setDepth = useExplodedStore((s) => s.setDepth);

  const rfRef = useRef<ReactFlowInstance<EntityFlowNode, Edge> | null>(null);
  const positionsRef = useRef<Record<string, Point>>({});
  const entityIdsRef = useRef<Set<string>>(new Set());
  const readyRef = useRef(false);
  const lastSavedRef = useRef('');
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // consumed by the first schema load, then dropped — see there
  const linkRef = useRef<ViewLink | undefined>(OPENED_WITH);

  const scheduleSave = useCallback(() => {
    if (!readyRef.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      // guard against ids leaking across schema switches (e.g. a stale tab
      // mid-HMR): only ever persist ids that exist in the current schema
      const ids = entityIdsRef.current;
      const payload: LayoutFile = {
        positions: Object.fromEntries(
          Object.entries(positionsRef.current).filter(([id]) => ids.has(id)),
        ),
        depth: useExplodedStore.getState().depth,
      };
      const serialized = serializeLayout(payload);
      if (serialized === lastSavedRef.current) return;
      lastSavedRef.current = serialized;
      // the layout file is the on-disk record; the session copy is the fallback
      // for when it cannot be written (no dev-server PUT behind a static build)
      patchSchemaSession(schemaName, { depth: payload.depth });
      saveLayout(schemaName, payload).catch(() => {});
    }, 500);
  }, [schemaName]);

  useEffect(() => {
    loadSources().then(({ sources: listed, warnings }) => {
      // `?remote=` is a link to a particular schema, so it opens that schema.
      // If the URL is one the map already lists, that entry opens rather than a
      // second copy of it under a filename nobody chose.
      const opened = OPENED_WITH.remote ? normalizeUrl(OPENED_WITH.remote) : undefined;
      const alreadyListed = opened ? listed.find((s) => s.url === opened) : undefined;
      const remembered =
        opened && !alreadyListed ? rememberRemoteUrl(opened) : readSession().remoteUrls;
      const adhoc = adhocSources(remembered, listed);
      const sources = [...listed, ...adhoc];

      setSources(sources);
      setSourceWarnings(warnings);
      if (!sources.length) return;
      const names = sources.map((s) => s.name);
      // `?schema=` names a local file, for the one case a URL cannot travel
      const wanted =
        alreadyListed?.name ??
        (opened ? adhoc.find((s) => s.url === opened)?.name : undefined) ??
        (OPENED_WITH.schema && names.includes(OPENED_WITH.schema) ? OPENED_WITH.schema : undefined);
      // the restored schema may have been renamed, deleted, or dropped from
      // the URL map since — fall back to the default, then to whatever exists
      setSchemaName((cur) =>
        wanted ??
        (names.includes(cur) ? cur : names.includes(DEFAULT_SCHEMA) ? DEFAULT_SCHEMA : names[0]),
      );
    });
  }, []);

  /**
   * Open a URL nobody listed. Remembered for next time, selected now, and —
   * via the effect below — written onto the address bar, so the schema you are
   * looking at is the thing a copied link opens.
   */
  const openRemoteUrl = useCallback((raw: string) => {
    const url = normalizeUrl(raw.trim());
    if (!url) return;
    setSources((cur) => {
      const listed = (cur ?? []).filter((s) => !s.adhoc);
      const next = [...listed, ...adhocSources(rememberRemoteUrl(url), listed)];
      const opened = next.find((s) => s.url === url);
      if (opened) setSchemaName(opened.name);
      return next;
    });
  }, []);

  // Keep `?remote=` in step with the selection: present while an ad-hoc schema
  // is showing, gone once a listed one is.
  //
  // Not before the sources are known. This effect runs on the first render
  // too, when `sources` is still undefined and nothing can match — which
  // deleted the incoming `?remote=` from the address bar before the loader
  // above had a chance to read it, and a deep link opened the default schema.
  useEffect(() => {
    if (!sources) return;
    const source = sources.find((s) => s.name === schemaName);
    const url = new URL(window.location.href);
    if (source?.adhoc && source.url) url.searchParams.set(REMOTE_PARAM, source.url);
    else url.searchParams.delete(REMOTE_PARAM);
    const next = `${url.pathname}${url.search}${url.hash}`;
    const now = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== now) window.history.replaceState(null, '', next);
  }, [sources, schemaName]);

  // load schema + layout file
  useEffect(() => {
    if (!sources) return;
    let cancelled = false;
    readyRef.current = false;
    clearTimeout(saveTimer.current);
    (async () => {
      try {
        // a name with no source left is still fetched as a local file, so the
        // error says "404 loading x.json" rather than something about lists
        const source = sources.find((s) => s.name === schemaName) ?? { name: schemaName };
        const text = await fetchSchemaText(source);
        if (!cancelled) setSchemaRaw(text);
        let schema: JsonSchema;
        try {
          schema = JSON.parse(text);
        } catch (err) {
          // keep the raw text around — the validation panel locates the error in it
          if (!cancelled) setSchemaDoc(undefined);
          throw new Error(`invalid JSON in ${schemaName}: ${err instanceof Error ? err.message : err}`);
        }
        const walk = walkSchema(schema);
        const twins = computeTwins(walk);
        if (import.meta.env.DEV)
          (window as { __twinInfo?: unknown }).__twinInfo = {
            twinOf: Object.fromEntries(twins.twinOf),
            warnings: twins.warnings,
          };
        const saved = await loadLayout(schemaName);
        const session = readSchemaSession(schemaName);

        const entityIds = new Set(walk.entities.map((e) => e.id));
        const savedPositions: Record<string, Point> = {};
        for (const [id, p] of Object.entries(saved?.positions ?? {}))
          if (entityIds.has(id)) savedPositions[id] = p;
        // A link describes a view, and it wins over the remembered one — but
        // only on the load it arrived with, so switching schemas afterwards is
        // not haunted by the link that opened the app.
        const link = linkRef.current;
        linkRef.current = undefined;
        const linkedId = link?.selectedId && anchorOf(walk, link.selectedId) ? link.selectedId : undefined;
        const depthInit = link?.depth ?? saved?.depth ?? session.depth ?? DEFAULT_DEPTH;
        // The last session's selection comes back — it is the anchor depth is
        // graded from, so without it the same depth draws a different graph. A
        // stored id that no longer resolves (the schema was edited) is dropped.
        const wantedId = linkedId ?? session.selectedId;
        const restoredAnchor = anchorOf(walk, wantedId);
        const restoredId = restoredAnchor ? wantedId : undefined;
        // the first layout is graded from that anchor, falling back to the
        // entry entity — same fallback the live view uses
        const entry = walk.entities.find((e) => e.isEntry) ?? walk.entities[0];
        const levelsInit = computeLevels(walk, restoredAnchor ?? entry?.id);
        const viewsInit = rowViews(walk, levelsInit, depthInit);
        const hidden = depthHiddenIds(walk, levelsInit, depthInit);
        const auto = await layoutPositions(
          {
            entities: walk.entities.filter((e) => !hidden.has(e.id)),
            edges: walk.edges.filter((e) => !hidden.has(e.source) && !hidden.has(e.target)),
          },
          new Map([...viewsInit].map(([id, v]) => [id, v.rows])),
        );
        if (cancelled) return;

        positionsRef.current = savedPositions;
        entityIdsRef.current = entityIds;
        lastSavedRef.current = serializeLayout({ positions: savedPositions, depth: depthInit });
        setNodes(
          walk.entities.map((e) => ({
            id: e.id,
            type: 'entity' as const,
            position: savedPositions[e.id] ?? auto.get(e.id) ?? { x: 0, y: 0 },
            data: { entity: e, twinOf: twins.twinOf.get(e.id) },
          })),
        );
        // a variant edge leaves from its own row on the choice card, and the
        // row already names it — the same reason containment edges carry no label
        const choices = new Set(
          walk.entities.filter((e) => e.kind === 'junction').map((e) => e.id),
        );
        setEdges(
          walk.edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            type: 'smoothstep',
            label: e.kind === 'ref' && !choices.has(e.source) ? e.label : undefined,
            className: e.kind === 'ref' ? `edge-ref${e.union ? ' edge-union' : ''}` : undefined,
          })),
        );
        setDepth(depthInit);
        setResult(walk);
        setSchemaDoc(schema);
        setDriftWarnings(twins.warnings);
        select(restoredId);
        if (link?.focus !== undefined) setFocus(link.focus);
        // the view is on screen now, so the parameters that described it have
        // done their job; leaving them up would only let them go stale
        if (link) clearViewParams();
        // a stored "per section" scope means nothing to a document with no
        // sections, so that one drops back to the document default. "selected
        // section" survives either way — a $defs entry is a section too.
        const hasSections =
          schema.properties !== undefined && Object.keys(schema.properties).length > 0;
        const storedScope = readSession().vScope;
        setVScope(storedScope === 'sections' && !hasSections ? undefined : storedScope);
        setError(undefined);
        patchSession({ schemaName });
        // a stored id that did not resolve is gone for good — drop it now
        // rather than re-testing it against every future load of this schema
        if (session.selectedId && !restoredId)
          patchSchemaSession(schemaName, { selectedId: undefined });
        readyRef.current = true;
        // the stored viewport is where this schema was left; fitView is for a
        // schema being opened for the first time
        requestAnimationFrame(() => {
          if (session.viewport) rfRef.current?.setViewport(session.viewport);
          else rfRef.current?.fitView({ padding: 0.08 });
        });
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schemaName, sources, setSchemaDoc, setSchemaRaw, select, setDepth, setFocus, setVScope]);

  // persist depth changes (no-op saves are skipped via lastSavedRef)
  useEffect(() => {
    scheduleSave();
  }, [depth, scheduleSave]);

  // Remember the selection per schema. Guarded by `readyRef`, which the load
  // effect clears synchronously when `schemaName` changes: without that, this
  // would file the outgoing schema's selection under the incoming schema.
  useEffect(() => {
    if (!readyRef.current) return;
    patchSchemaSession(schemaName, { selectedId });
  }, [schemaName, selectedId]);

  // theme: stamp <html data-theme>, and follow the OS while the pref is "system"
  useEffect(() => {
    applyResolved(resolvedTheme);
  }, [resolvedTheme]);
  useEffect(() => onSystemThemeChange(syncSystemTheme), [syncSystemTheme]);

  // Escape clears the selection, F toggles focus (the shortcut the header
  // control advertises). An open popover handles Escape itself and marks the
  // event, so closing one does not also clear the selection.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const el = ev.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (ev.key === 'Escape') select(undefined);
      else if (ev.key === 'f' || ev.key === 'F') toggleFocus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [select, toggleFocus]);

  // resolve the selection to its anchor entity (row -> owner, edge -> source)
  const anchorId = useMemo(
    () => (result ? anchorOf(result, selectedId) : undefined),
    [result, selectedId],
  );

  // The selection is a chain, not three unrelated highlights: the containment
  // path from the root down to the anchor (plus the edges a selected link row
  // emits) is stroked in the accent while every other edge dims, so the route
  // to the anchor is legible in one glance across a 25-card graph.
  const chainEdgeIds = useMemo(() => {
    const ids = new Set<string>();
    if (!result || !anchorId) return ids;
    const parentEdge = new Map<string, string>();
    for (const e of result.edges) if (e.kind === 'containment') parentEdge.set(e.target, e.id);
    const bySource = new Map(result.edges.map((e) => [e.id, e.source]));
    const seen = new Set<string>();
    for (let cur: string | undefined = anchorId; cur && !seen.has(cur); ) {
      seen.add(cur);
      const edgeId = parentEdge.get(cur);
      if (edgeId === undefined) break;
      ids.add(edgeId);
      cur = bySource.get(edgeId);
    }
    if (selectedId) {
      if (result.edges.some((e) => e.id === selectedId)) ids.add(selectedId);
      for (const entity of result.entities) {
        const row = entity.rows.find((r) => r.id === selectedId);
        if (row?.link) for (const id of row.link.edgeIds) ids.add(id);
      }
    }
    return ids;
  }, [result, anchorId, selectedId]);

  // depth is graded downstream from the selection, falling back to the entry
  // entity so the canvas is always graded from somewhere stable
  const levels = useMemo(() => {
    if (!result) return new Map<string, number>();
    const entry = result.entities.find((e) => e.isEntry) ?? result.entities[0];
    return computeLevels(result, anchorId ?? entry?.id);
  }, [result, anchorId]);
  const views = useMemo(
    () => (result ? rowViews(result, levels, depth) : new Map<string, RowView>()),
    [result, levels, depth],
  );
  const rowCounts = useMemo(() => new Map([...views].map(([id, v]) => [id, v.rows])), [views]);
  const depthHidden = useMemo(
    () => (result ? depthHiddenIds(result, levels, depth) : new Set<string>()),
    [result, levels, depth],
  );

  // Focus mode: show the anchor plus every direct neighbor over any edge kind
  // (parent, children, ref targets, ref sources). Edge depth is the other axis
  // — downstream only — and composes by union: an entity is hidden if either
  // rule hides it.
  //
  // With one exception, which is the whole point of focus having an inbound
  // half. Depth grades the *downstream* cone, so an entity that only reaches
  // the anchor (a containment parent, a def that refs it) has no level at all
  // and is hidden by any finite edge depth. Unioned naively, focus's inbound
  // neighbors would exist only at edges `all` — the setting that draws
  // everything anyway. So the inbound half is exempt from the edge gate, and
  // focus + edges N reads as "who points at this, and its cone N hops out".
  const focusAnchor = focus && result && anchorId ? anchorId : undefined;
  const effectiveHidden = useMemo(() => {
    if (!focusAnchor || !result) return depthHidden;
    const visible = new Set([focusAnchor]);
    const inbound = new Set<string>();
    for (const e of result.edges) {
      if (e.source === focusAnchor) visible.add(e.target);
      if (e.target === focusAnchor) {
        visible.add(e.source);
        inbound.add(e.source);
      }
    }
    const hidden = new Set<string>();
    for (const e of result.entities)
      if (!visible.has(e.id) || (depthHidden.has(e.id) && !inbound.has(e.id))) hidden.add(e.id);
    return hidden;
  }, [focusAnchor, result, depthHidden]);

  const residue = useMemo(
    () => (result ? residueOf(result, effectiveHidden) : new Map<string, Residue>()),
    [result, effectiveHidden],
  );

  // Focus positions live in their own overlay, never in `nodes`. The focus
  // layout packs a handful of neighbors into a tight cluster, so writing it
  // into the base graph would strand those entities in the full view (and, if
  // one is dragged, persist the packed coordinate to the layout file). Base
  // positions stay untouched while focused, so leaving focus puts every node
  // back exactly where it was.
  const [focusPositions, setFocusPositions] = useState<Map<string, Point>>();
  const focusPosRef = useRef<Map<string, Point> | undefined>(undefined);

  // base layout: re-layout the visible graph when depth changes what is drawn;
  // moved nodes stay put. Suspended while focused — the overlay is in charge.
  useEffect(() => {
    if (!result || !readyRef.current || focusAnchor) return;
    let cancelled = false;
    layoutPositions(visibleGraph(result, effectiveHidden), rowCounts).then((pos) => {
      if (cancelled) return;
      setNodes((ns) =>
        ns.map((n) => {
          const p = positionsRef.current[n.id] ?? pos.get(n.id);
          return p && (p.x !== n.position.x || p.y !== n.position.y) ? { ...n, position: p } : n;
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [result, effectiveHidden, focusAnchor, rowCounts]);

  // focus layout: lay the neighborhood out fresh — saved positions are
  // deliberately ignored, they describe the full graph — then translate it so
  // the anchor stays exactly where it already sits on screen. The anchor is
  // the one thing that never moves across a focus/refocus, which is what makes
  // the transition readable; refitting the viewport does the rest.
  useEffect(() => {
    if (!result || !readyRef.current || !focusAnchor) {
      focusPosRef.current = undefined;
      setFocusPositions(undefined);
      return;
    }
    let cancelled = false;
    layoutPositions(visibleGraph(result, effectiveHidden), rowCounts).then((pos) => {
      if (cancelled) return;
      const laid = pos.get(focusAnchor);
      const here = rfRef.current?.getNode(focusAnchor)?.position;
      const dx = laid && here ? here.x - laid.x : 0;
      const dy = laid && here ? here.y - laid.y : 0;
      const shifted = new Map<string, Point>();
      for (const [id, p] of pos) shifted.set(id, { x: p.x + dx, y: p.y + dy });
      focusPosRef.current = shifted;
      setFocusPositions(shifted);
      requestAnimationFrame(() => rfRef.current?.fitView({ padding: 0.2, duration: 250 }));
    });
    return () => {
      cancelled = true;
    };
  }, [result, focusAnchor, effectiveHidden, rowCounts]);

  // Reset layout: discard every hand-placed position and re-run the layout
  // algorithm over the visible graph. Nothing is left to restore afterwards —
  // the layout file keeps only depth — but auto-layout is deterministic, so a
  // reset arrangement is the same one a fresh open would produce.
  const resetLayout = useCallback(() => {
    if (!result || !readyRef.current || focusAnchor) return;
    positionsRef.current = {};
    scheduleSave();
    layoutPositions(visibleGraph(result, effectiveHidden), rowCounts).then((pos) => {
      // cards depth currently hides get no coordinate here; they are re-laid
      // by the base effect when depth next draws them, against empty positions
      setNodes((ns) =>
        ns.map((n) => {
          const p = pos.get(n.id);
          return p ? { ...n, position: p } : n;
        }),
      );
      requestAnimationFrame(() => rfRef.current?.fitView({ padding: 0.08, duration: 250 }));
    });
  }, [result, focusAnchor, effectiveHidden, rowCounts, scheduleSave]);

  // Ladder slots for incoming edges are ordered by the source card's vertical
  // band. Banding (rather than raw y) keeps a drag from re-assigning every
  // slot on every frame: the key only changes when a card crosses a band.
  const bands = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of nodes) m.set(n.id, Math.round((focusPositions?.get(n.id) ?? n.position).y / 40));
    return m;
  }, [nodes, focusPositions]);
  const bandKey = useMemo(() => [...bands].map(([id, b]) => `${id}:${b}`).join('|'), [bands]);
  const bandsRef = useRef(bands);
  bandsRef.current = bands;
  const wiring = useMemo<ReturnType<typeof edgeViews>>(
    () =>
      result
        ? edgeViews(result, effectiveHidden, views, bandsRef.current)
        : { edges: new Map(), slots: new Map() },
    // bandKey stands in for `bands` on purpose — see above
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result, effectiveHidden, views, bandKey],
  );

  // How many properties reference each def — the walker's document-wide count,
  // not one derived from the visible edges: "shared by 6" is a fact about the
  // document, a count that shrank with depth would be reporting the view, and
  // allOf branches are uses that never become edges at all.
  const siteIndex = useMemo(
    () => (result ? indexUseSites(result) : new Map<string, UseSite[]>()),
    [result],
  );
  const uses = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of result?.defs ?? [])
      if (d.entityId) m.set(d.entityId, siteIndex.get(d.name)?.length ?? 0);
    return m;
  }, [result, siteIndex]);

  /**
   * Selection echo. A definition with no card of its own — a scalar def, an
   * elided wrapper — has nothing on the canvas to highlight, so selecting one
   * used to light up nothing at all. Light its *use sites* instead: the rows
   * typed by it, the variant edges routed through it, the cards that extend
   * it. The panel's "Referenced by" list and the canvas then say the same
   * thing at the same time.
   */
  const rowOwner = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of result?.entities ?? []) for (const r of e.rows) m.set(r.id, e.id);
    return m;
  }, [result]);
  const echo = useMemo(() => {
    const rows = new Map<string, string[]>();
    const edgeIds = new Set<string>();
    const cards = new Set<string>();
    if (!selectedId?.startsWith(DEF_PREFIX)) return { rows, edgeIds, cards };
    for (const site of siteIndex.get(selectedId.slice(DEF_PREFIX.length)) ?? []) {
      if (site.how === 'property') {
        const owner = rowOwner.get(site.id);
        if (owner === undefined) continue;
        const at = rows.get(owner);
        if (at) at.push(site.id);
        else rows.set(owner, [site.id]);
      } else if (site.how === 'variant') edgeIds.add(site.id);
      else cards.add(site.id);
    }
    return { rows, edgeIds, cards };
  }, [selectedId, siteIndex, rowOwner]);

  // A card's ladder handles must exist before an edge asks for one, so the
  // pool is sized by the schema (every edge that could ever attach), not by
  // what is visible now — only the assignment below varies with depth.
  const caps = useMemo(() => {
    const m = new Map<string, { source: number; target: number }>();
    const bump = (id: string, side: 'source' | 'target') => {
      const c = m.get(id) ?? { source: 0, target: 0 };
      c[side] += 1;
      m.set(id, c);
    };
    for (const e of result?.edges ?? []) {
      bump(e.source, 'source');
      bump(e.target, 'target');
    }
    return m;
  }, [result]);

  const displayNodes = useMemo<EntityFlowNode[]>(
    () =>
      nodes.map((n) => {
        if (effectiveHidden.has(n.id)) return { ...n, hidden: true };
        const p = focusPositions?.get(n.id);
        const slots = wiring.slots.get(n.id);
        const cap = caps.get(n.id);
        const data = {
          ...n.data,
          view: views.get(n.id),
          residue: residue.get(n.id),
          uses: uses.get(n.id),
          sourceSlots: slots?.source ?? 0,
          targetSlots: slots?.target ?? 0,
          sourceMax: cap?.source ?? 0,
          targetMax: cap?.target ?? 0,
          echoRows: echo.rows.get(n.id),
          echoCard: echo.cards.has(n.id) || undefined,
        };
        return p ? { ...n, data, position: p } : { ...n, data };
      }),
    [nodes, effectiveHidden, focusPositions, views, wiring, caps, residue, uses, echo],
  );
  const displayEdges = useMemo<Edge[]>(
    () =>
      edges.map((e) => {
        if (effectiveHidden.has(e.source) || effectiveHidden.has(e.target))
          return { ...e, hidden: true };
        const w = wiring.edges.get(e.id);
        return {
          ...e,
          className: `${e.className ?? ''}${chainEdgeIds.has(e.id) ? ' edge-chain' : ''}${
            echo.edgeIds.has(e.id) ? ' edge-echo' : ''
          }`,
          sourceHandle: w?.sourceHandle,
          targetHandle: w?.targetHandle,
          // React Flow wraps a string markerEnd as url('#<id>') — pass the id
          markerEnd: w?.many ? 'rel-many' : 'rel-one',
        };
      }),
    [edges, effectiveHidden, wiring, chainEdgeIds, echo],
  );

  // what the depth popover reports: how much of the graph the current gates
  // actually draw, and how much of it is folded behind a residue chip
  const depthStats = useMemo(() => {
    let drawn = 0;
    let folded = 0;
    for (const n of nodes) {
      if (effectiveHidden.has(n.id)) continue;
      drawn += 1;
      const v = views.get(n.id);
      const r = residue.get(n.id);
      if ((v?.hiddenScalars ?? 0) + (v?.hiddenLinks ?? 0) + (r?.ents ?? 0) > 0) folded += 1;
    }
    return { drawn, folded };
  }, [nodes, effectiveHidden, views, residue]);

  // while focused, position changes land in the overlay: a drag there is
  // ephemeral and must not move the node in the full graph
  const onNodesChange = useCallback((changes: NodeChange<EntityFlowNode>[]) => {
    if (!focusPosRef.current) {
      setNodes((ns) => applyNodeChanges(changes, ns));
      return;
    }
    const moved = new Map(focusPosRef.current);
    let didMove = false;
    for (const c of changes) {
      if (c.type === 'position' && c.position) {
        moved.set(c.id, c.position);
        didMove = true;
      }
    }
    if (didMove) {
      focusPosRef.current = moved;
      setFocusPositions(moved);
    }
    const rest = changes.filter((c) => c.type !== 'position');
    if (rest.length) setNodes((ns) => applyNodeChanges(rest, ns));
  }, []);
  const onNodeDragStop = useCallback<OnNodeDrag<EntityFlowNode>>(
    (_ev, node) => {
      // a packed focus-neighborhood coordinate is not a position the full
      // graph should inherit, so focus drags are never persisted
      if (focusPosRef.current) return;
      if (!entityIdsRef.current.has(node.id)) return;
      positionsRef.current[node.id] = node.position;
      scheduleSave();
    },
    [scheduleSave],
  );
  const onNodeClick = useCallback<NodeMouseHandler<EntityFlowNode>>(
    (_ev, node) => select(node.id),
    [select],
  );
  const onEdgeClick = useCallback(
    (_ev: React.MouseEvent, edge: Edge) => select(edge.id),
    [select],
  );
  const onPaneClick = useCallback(() => select(undefined), [select]);

  const validation = useValidation(anchorId);

  return (
    <div className="app">
      <Header
        sources={sources ?? []}
        sourceWarnings={sourceWarnings}
        schemaName={schemaName}
        onSchemaChange={setSchemaName}
        onOpenUrl={openRemoteUrl}
        driftWarnings={driftWarnings}
        error={error}
        result={result}
        depthStats={depthStats}
        totals={validation.totals}
      />
      <div className="app-body">
        <JsonPanel result={result} />
        <div className={`canvas-wrap${anchorId ? ' has-anchor' : ''}`}>
          {/* relationship end markers: circle = one, triangle = many. Defined
              once here and referenced by url(#id) from every edge. */}
          <svg className="edge-markers" aria-hidden="true">
            <defs>
              <marker
                id="rel-one"
                viewBox="0 0 12 12"
                markerWidth="12"
                markerHeight="12"
                refX="10"
                refY="6"
                orient="auto"
                markerUnits="userSpaceOnUse"
              >
                <circle className="marker-one" cx="6.5" cy="6" r="3" />
              </marker>
              <marker
                id="rel-many"
                viewBox="0 0 12 12"
                markerWidth="12"
                markerHeight="12"
                refX="11"
                refY="6"
                orient="auto"
                markerUnits="userSpaceOnUse"
              >
                <path className="marker-many" d="M2,1.5 L11,6 L2,10.5 Z" />
              </marker>
            </defs>
          </svg>
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            onMoveEnd={(_ev, viewport) => {
              if (readyRef.current) patchSchemaSession(schemaName, { viewport });
            }}
            nodesConnectable={false}
            colorMode={resolvedTheme}
            minZoom={0.04}
            snapToGrid={snap}
            snapGrid={SNAP_GRID}
            onInit={(instance) => {
              rfRef.current = instance;
              if (import.meta.env.DEV) (window as { __rf?: unknown }).__rf = instance;
            }}
          >
            <Background />
            {/* the default lock is React Flow's, not this tool's; the slot is
                worth more as snap-to-grid for hand-placed cards */}
            <Controls showInteractive={false}>
              <ControlButton
                onClick={() => {
                  setSnap(!snap);
                  patchSession({ snap: !snap });
                }}
                title={snap ? 'snap to grid: on' : 'snap to grid: off'}
                style={snap ? { color: 'var(--accent)' } : undefined}
              >
                ⌗
              </ControlButton>
              <ControlButton
                onClick={resetLayout}
                disabled={!result || !!focusAnchor}
                title={
                  focusAnchor
                    ? 'reset layout — leave focus first, focus has no saved positions'
                    : 'reset layout: discard moved cards and lay the graph out again'
                }
              >
                ⟲
              </ControlButton>
            </Controls>
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
        <DetailPanel result={result} />
      </div>
      <ValidationPanel
        result={result}
        groups={validation.groups}
        scope={validation.scope}
        sectionsAvailable={validation.sectionsAvailable}
        selectedSection={validation.selectedSection}
      />
    </div>
  );
}
