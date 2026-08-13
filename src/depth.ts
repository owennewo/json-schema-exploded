// Depth gating: how much of each card, and how much of the graph, is drawn.
//
// Everything here is measured DOWNSTREAM from the anchor entity — level 1 is
// the anchor, its children are level 2, and "child" means any outgoing edge,
// containment and ref alike. That is deliberately not focus mode, which takes
// the anchor's neighborhood in both directions (parent, incoming refs); the
// two are separate axes and compose.
//
// The row settings count cards (scalar 1 = only the anchor lists its scalars).
// The edge setting counts hops, so edges N reveals cards down to level N+1 —
// and a card is only drawn if an edge reached it, so pruning an edge takes the
// child card with it.
import type { EdgeInfo, WalkResult } from './walker';
import type { DepthSettings } from './store';

/** level 1 = anchor, children level 2; unreachable entities get no entry */
export function computeLevels(
  result: WalkResult,
  anchor: string | undefined,
): Map<string, number> {
  const levels = new Map<string, number>();
  if (anchor === undefined) return levels;
  const out = new Map<string, string[]>();
  for (const e of result.edges) {
    const arr = out.get(e.source);
    if (arr) arr.push(e.target);
    else out.set(e.source, [e.target]);
  }
  levels.set(anchor, 1);
  let frontier = [anchor];
  let level = 1;
  // shortest downstream path wins; ref cycles are visited once
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const target of out.get(id) ?? []) {
        if (levels.has(target)) continue;
        levels.set(target, level + 1);
        next.push(target);
      }
    }
    frontier = next;
    level += 1;
  }
  return levels;
}

export interface RowView {
  /** card draws its scalar props */
  scalars: boolean;
  /** card draws its object props (and its "extends" line) */
  links: boolean;
  /** rows actually drawn, extends line included — the ELK node height */
  rows: number;
  hiddenScalars: number;
  hiddenLinks: number;
}

export function rowViews(
  result: WalkResult,
  levels: ReadonlyMap<string, number>,
  depth: DepthSettings,
): Map<string, RowView> {
  const views = new Map<string, RowView>();
  for (const e of result.entities) {
    const level = levels.get(e.id) ?? Infinity;
    // A choice card with its rows gated is a box that says nothing, and its
    // variant edges would have no row to leave from.
    const always = e.kind === 'junction';
    const scalars = always || level <= depth.scalar;
    // composition is a relationship, not a property, so it rides with links
    const links = always || level <= depth.object;
    const linkCount = e.rows.reduce((n, r) => n + (r.link ? 1 : 0), 0);
    const scalarCount = e.rows.length - linkCount;
    const extendsLine = e.inherits?.length ? 1 : 0;
    views.set(e.id, {
      scalars,
      links,
      rows: (scalars ? scalarCount : 0) + (links ? linkCount + extendsLine : 0),
      hiddenScalars: scalars ? 0 : scalarCount,
      hiddenLinks: links ? 0 : linkCount,
    });
  }
  return views;
}

/**
 * Entities past the edge depth — the edge that would have reached them is gone.
 * Entities the anchor cannot reach at all have no level, so they fall out here
 * too; focus mode exempts the ones that point *at* the anchor (see App).
 */
export function depthHiddenIds(
  result: WalkResult,
  levels: ReadonlyMap<string, number>,
  depth: DepthSettings,
): Set<string> {
  const hidden = new Set<string>();
  if (!Number.isFinite(depth.edges)) return hidden;
  const deepest = depth.edges + 1;
  for (const e of result.entities) if ((levels.get(e.id) ?? Infinity) > deepest) hidden.add(e.id);
  return hidden;
}

export interface EdgeView {
  sourceHandle?: string;
  targetHandle?: string;
  /** array / map relationship — draws the "many" end marker */
  many: boolean;
}

export interface SlotCounts {
  source: number;
  target: number;
}

/**
 * Where each visible edge attaches, and how many ladder slots each card needs.
 *
 * An edge whose row is drawn on the source card leaves from that row. The rest
 * ladder down the card's right border in property order, so no two labels sit
 * at the same height — and two props pointing at the same entity (client and
 * partner into person_details) draw as two readable lines instead of one path
 * with stacked labels. Incoming edges ladder down the left border ordered by
 * the source card's vertical band, which keeps the crossings down.
 */
export function edgeViews(
  result: WalkResult,
  hidden: ReadonlySet<string>,
  views: ReadonlyMap<string, RowView>,
  bandOf: ReadonlyMap<string, number>,
): { edges: Map<string, EdgeView>; slots: Map<string, SlotCounts> } {
  const rowIndex = new Map<string, Map<string, number>>();
  for (const entity of result.entities) {
    const index = new Map<string, number>();
    entity.rows.forEach((r, i) => index.set(r.id, i));
    rowIndex.set(entity.id, index);
  }
  // a card not drawing its link rows has no row for the edge to leave from
  const rowHandle = (edge: EdgeInfo): string | undefined => {
    if (!edge.fromRow) return undefined;
    if (!views.get(edge.source)?.links) return undefined;
    return rowIndex.get(edge.source)?.has(edge.fromRow) ? `row:${edge.fromRow}` : undefined;
  };

  const bySource = new Map<string, EdgeInfo[]>();
  const byTarget = new Map<string, EdgeInfo[]>();
  for (const e of result.edges) {
    if (hidden.has(e.source) || hidden.has(e.target)) continue;
    const s = bySource.get(e.source);
    if (s) s.push(e);
    else bySource.set(e.source, [e]);
    const t = byTarget.get(e.target);
    if (t) t.push(e);
    else byTarget.set(e.target, [e]);
  }

  const edges = new Map<string, EdgeView>();
  const slots = new Map<string, SlotCounts>();
  const slotsOf = (id: string): SlotCounts => {
    let s = slots.get(id);
    if (!s) slots.set(id, (s = { source: 0, target: 0 }));
    return s;
  };
  const viewOf = (id: string): EdgeView => {
    let v = edges.get(id);
    if (!v) edges.set(id, (v = { many: false }));
    return v;
  };

  for (const [sourceId, list] of bySource) {
    const index = rowIndex.get(sourceId) ?? new Map<string, number>();
    const ladder: EdgeInfo[] = [];
    for (const e of list) {
      const handle = rowHandle(e);
      if (handle) viewOf(e.id).sourceHandle = handle;
      else ladder.push(e);
    }
    // property order, so the ladder reads in the order the rows would have
    ladder.sort(
      (a, b) => (index.get(a.fromRow ?? '') ?? Infinity) - (index.get(b.fromRow ?? '') ?? Infinity),
    );
    ladder.forEach((e, i) => (viewOf(e.id).sourceHandle = `s${i}`));
    slotsOf(sourceId).source = ladder.length;
  }

  for (const [targetId, list] of byTarget) {
    list.sort((a, b) => (bandOf.get(a.source) ?? 0) - (bandOf.get(b.source) ?? 0));
    list.forEach((e, i) => (viewOf(e.id).targetHandle = `t${i}`));
    slotsOf(targetId).target = list.length;
  }

  for (const e of result.edges) {
    if (hidden.has(e.source) || hidden.has(e.target)) continue;
    viewOf(e.id).many = e.marker === '[]' || e.marker === '{}';
  }

  return { edges, slots };
}
