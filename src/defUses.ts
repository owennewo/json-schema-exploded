// Where a $def is used, resolved back to things you can select.
//
// A use site is a place on the canvas whose shape comes from this def. It
// reaches the graph four ways, and each needs a different selection target:
//
// - a ROW on the using card (direct ref, array-of-ref, map, scalar def, alias)
//   — the row is the use site,
// - a junction VARIANT edge, which has no row: a union's branches leave the
//   junction, not the owning card,
// - an allOf branch, which the card draws as its "extends" line,
// - the document's own root `$ref`, which designates the entry def and draws
//   nothing at all.
//
// Rows and edges cannot double-count each other: every edge `handleProp`
// emits carries `fromRow`, so an edge without one is a junction's, and the row
// that stands for the same `$ref` does not exist.
//
// Uses are counted THROUGH aliases. `beams: beam-list[]` is a use site of
// `beam` — the alias is plumbing the canvas elides, not something the author
// reached for — which is why this count can exceed the number of literal
// `$ref`s in the document: one `$ref` inside a twice-used alias is two places
// that change if you edit the target. The def panel says so when the two
// disagree in the other direction.

import { DEF_PREFIX, type WalkResult } from './walker';
import type { DefKind } from './walker';

export interface UseSite {
  /** what to select to land on it */
  id: string;
  /** the card the use sits on */
  owner: string;
  /**
   * The property, kept apart from the owner so the row can ellipsise the
   * owner and never the property: six uses of `Country` on one long-named
   * card are six identical rows if `TerritorialProfileValue.` gets the space.
   */
  prop?: string;
  how: 'property' | 'variant' | 'extends' | 'entry';
  /** the elided alias/wrapper the use routes through */
  via?: string;
}

/**
 * Every def's use sites, in one pass. Built once per walk and shared: the
 * canvas chip, the Defs tab and the panel must not each derive their own
 * answer to "how many places use this", or they will disagree.
 */
export function indexUseSites(result: WalkResult): Map<string, UseSite[]> {
  const out = new Map<string, UseSite[]>();
  const add = (name: string, site: UseSite) => {
    const at = out.get(name);
    if (at) at.push(site);
    else out.set(name, [site]);
  };

  const aliasTargets = new Map<string, string[]>();
  for (const d of result.defs)
    if (d.kind !== 'entity' && d.targets?.length) aliasTargets.set(d.name, d.targets);

  // a junction's label is "1 of N"; its id is the property that owns the choice
  const labelOf = new Map(
    result.entities.map((e) => [e.id, e.kind === 'junction' ? (e.id.split('.').pop() ?? e.id) : e.label]),
  );

  for (const entity of result.entities) {
    for (const row of entity.rows)
      for (const name of row.ref ?? []) {
        const site = { id: row.id, owner: entity.label, prop: row.name, how: 'property' as const };
        add(name, site);
        for (const t of aliasTargets.get(name) ?? []) add(t, { ...site, via: name });
      }
    for (const name of entity.inherits ?? [])
      add(name, { id: entity.id, owner: entity.label, how: 'extends' });
    if (entity.isEntry && entity.defName)
      add(entity.defName, { id: entity.id, owner: 'document root', how: 'entry' });
  }

  for (const edge of result.edges) {
    if (edge.fromRow !== undefined) continue; // the row already stands for it
    const site = {
      id: edge.id,
      owner: labelOf.get(edge.source) ?? edge.source,
      prop: edge.label,
      how: 'variant' as const,
    };
    if (edge.via !== undefined) add(edge.via, site);
    if (edge.target.startsWith(DEF_PREFIX))
      add(edge.target.slice(DEF_PREFIX.length), { ...site, via: edge.via });
  }

  return out;
}

/** why a def has no card, in the vocabulary the canvas itself uses */
export const WHY_NO_CARD: Record<DefKind, string> = {
  entity: '',
  scalar: 'scalar def — drawn as the type chip on each using row',
  'array-alias': 'array alias — edges route straight to the item def',
  'map-alias': 'map alias — edges route straight to the value def',
  'variant-alias': 'variant wrapper — elided into the union edge, tag and all',
};

/** the Defs tab's badge: what the canvas did with this def */
export const DEF_BADGE: Record<DefKind, string> = {
  entity: 'card',
  scalar: 'chip',
  'array-alias': 'elided',
  'map-alias': 'elided',
  'variant-alias': 'elided',
};
