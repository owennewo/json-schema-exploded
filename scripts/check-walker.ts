// Completeness check for the schema walker (feature-schema-walker's "done
// when"): every property declared anywhere in a fixture must surface in the
// walk output, and the structural facts the canvas is built on must hold.
//
// Two fixtures, because the walker has two jobs that share almost no code:
//
//   flat-catalogue.json     inline objects written out where they are used.
//                           Entity ids are property paths, arrays of objects
//                           get a card at `path[]`, and everything is reached
//                           by containment. This is the dialect the extraction
//                           schemas are in.
//   mnx-schema.v33.json     `$defs` + `$ref` (MNX v33, pinned). Entity ids are
//                           def names, everything is reached by reference, and
//                           one def is shared by many props.
//
// Both are checked in under fixtures/ rather than read out of schemas/, which
// is gitignored: the check has to run on a clone, and must not change meaning
// when someone edits a schema of their own.
//
//   npm run check:walker
import fs from 'node:fs';
import path from 'node:path';
import { walkSchema, DEF_PREFIX, ROOT_ID, type JsonSchema, type WalkResult } from '../src/walker';

const load = (name: string): JsonSchema =>
  JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, `../fixtures/${name}`), 'utf8'));

const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

const summarize = (label: string, r: WalkResult): void => {
  const rows = r.entities.reduce((n, e) => n + e.rows.length, 0);
  console.log(
    `${label}: ${r.entities.length} entities, ${r.edges.length} edges, ${rows} rows, ${r.defs.length} defs`,
  );
};

/** an edge may only land on entities that exist — true of either dialect */
const checkEdgeTargets = (label: string, r: WalkResult): void => {
  const ids = new Set(r.entities.map((e) => e.id));
  for (const e of r.edges)
    if (!ids.has(e.source) || !ids.has(e.target))
      fail(`${label}: edge ${e.id} references a missing entity`);
};

// ── flat dialect ───────────────────────────────────────────────────────────
// Inline objects, so a property either is a row or *becomes* a card, and the
// card's id is the path that got you there. Nothing else produces ids like
// `orders.lines[].discount`, which is why this fixture exists.
const flatSource = load('flat-catalogue.json');
const flat = walkSchema(flatSource);
summarize('flat', flat);

{
  const entityIds = new Set(flat.entities.map((e) => e.id));
  const rowIds = new Set(flat.entities.flatMap((e) => e.rows.map((r) => r.id)));
  const missing: string[] = [];
  let declared = 0;

  // Descend the source schema itself: a property is accounted for when it is
  // a scalar row, an object that became a card, or an array of objects whose
  // item type became one — and in the latter two cases its own properties
  // have to be accounted for too.
  //
  // Cards are tested for before rows, and that order is the whole check. An
  // object prop is a row *and* an edge (feature-prop-depth-and-edges), so
  // asking "is it a row" first matches every section at the top level and
  // returns before descending into any of them — which passes while checking
  // two properties out of twenty-five.
  const collect = (node: JsonSchema, base: string): void => {
    for (const [name, prop] of Object.entries(node.properties ?? {})) {
      const p = base === '' ? name : `${base}.${name}`;
      declared += 1;
      if (entityIds.has(p)) collect(prop, p);
      else if (entityIds.has(`${p}[]`)) collect((prop.items as JsonSchema) ?? {}, `${p}[]`);
      else if (!rowIds.has(p)) missing.push(p); // scalar row — nothing below it
    }
  };
  collect(flatSource, '');
  console.log(`flat: ${declared} declared properties, ${missing.length} missing from output`);
  if (missing.length > 0) fail(`MISSING: ${missing.slice(0, 20).join(', ')}`);
  // A recursion that stops at the top level reports zero missing because it
  // looked at almost nothing. The fixture declares 25 properties across seven
  // cards, so anything near two means the descent broke, not the walker.
  if (declared < 20) fail(`flat: only ${declared} properties visited — the descent stopped early`);

  const root = flat.entities.find((e) => e.id === ROOT_ID);
  if (!root || root.kind !== 'root' || !root.isEntry)
    fail('flat: the document root should be the entry card, kind "root"');

  // an array of objects is a card at `path[]`; an array of scalars is a row
  const lines = flat.entities.find((e) => e.id === 'orders.lines[]');
  if (!lines || lines.kind !== 'array') fail('flat: orders.lines[] should be an array card');
  if (!flat.edges.some((e) => e.target === 'orders.lines[]' && e.marker === '[]'))
    fail('flat: the edge into orders.lines[] should be marked many');
  if (entityIds.has('catalogue.tags'))
    fail('flat: an array of scalars should stay a row, not become a card');

  // nesting does not stop at two levels, and it carries on through array items
  for (const id of ['orders.customer.address', 'orders.lines[].discount'])
    if (!entityIds.has(id)) fail(`flat: expected a card at ${id}`);

  // no $defs means no refs: every edge here is containment
  if (flat.defs.length !== 0) fail(`flat: expected no defs, got ${flat.defs.length}`);
  if (flat.edges.some((e) => e.kind !== 'containment'))
    fail('flat: every edge in a schema without $ref should be containment');
  checkEdgeTargets('flat', flat);

  // `type: [X, "null"]` is a flag on the row, never a union
  const nullable = flat.entities.flatMap((e) => e.rows).filter((r) => r.nullable).length;
  if (nullable < 4) fail(`flat: expected nullable rows to be flagged, got ${nullable}`);

  // x-propertyOrder governs row order, declaration order is the fallback
  const order = flat.entities.find((e) => e.id === 'catalogue')?.rows.map((r) => r.name) ?? [];
  const want = ['name', 'currency', 'updated_at', 'tags', 'retired'];
  if (order.join(',') !== want.join(','))
    fail(`flat: rows should follow x-propertyOrder — wanted ${want.join(',')}, got ${order.join(',')}`);
}

// ── $defs dialect ──────────────────────────────────────────────────────────
// Nothing is inline, so every property is a row on its def's card and the
// graph is made of references — including three that come back to where they
// started. MNX earns the slot by carrying all four def kinds, `allOf`
// inheritance on 78 cards, `anyOf` unions and `patternProperties` maps.
const mnxSource = load('mnx-schema.v33.json');
const mnx = walkSchema(mnxSource);
summarize('mnx ', mnx);

{
  const defs = (mnxSource.$defs ?? {}) as Record<string, JsonSchema>;
  const rowIds = new Set(mnx.entities.flatMap((e) => e.rows.map((r) => r.id)));
  const missing: string[] = [];
  let declared = 0;
  // An object prop is a row *and* an edge (feature-prop-depth-and-edges), so
  // "is it a row" is the whole question. Inherited props are not declared
  // here — they belong to the def the `allOf` points at, and ride on its card.
  for (const [name, def] of Object.entries(defs))
    for (const prop of Object.keys(def.properties ?? {})) {
      declared += 1;
      if (!rowIds.has(`${DEF_PREFIX}${name}.${prop}`)) missing.push(`${DEF_PREFIX}${name}.${prop}`);
    }
  console.log(`mnx : ${declared} declared properties, ${missing.length} missing from output`);
  if (missing.length > 0) fail(`MISSING: ${missing.slice(0, 20).join(', ')}`);

  // A document whose root is a `$ref` has no root card of its own: the def it
  // points at is the entry instead, and depth grades from there.
  const entry = mnx.entities.filter((e) => e.isEntry);
  if (entry.length !== 1 || entry[0].id !== '$defs/root')
    fail(`mnx: expected exactly one entry, $defs/root (got: ${entry.map((e) => e.id).join(', ')})`);
  checkEdgeTargets('mnx', mnx);

  // Wide bounds: they catch a walker that stopped emitting, or started
  // emitting a card per scalar — not the drift a fixture refresh would bring.
  if (mnx.entities.length < 60 || mnx.entities.length > 120)
    fail(`mnx: entity count ${mnx.entities.length} outside expected 60-120 range`);

  // all four def kinds must be represented, or an alias is being walked as
  // something else; scalars and aliases are deliberately card-less
  const kinds = new Map<string, number>();
  for (const d of mnx.defs) kinds.set(d.kind, (kinds.get(d.kind) ?? 0) + 1);
  console.log('mnx : def kinds —', [...kinds].map(([k, n]) => `${k} ${n}`).join(', '));
  for (const kind of ['entity', 'scalar', 'array-alias', 'map-alias'])
    if (!kinds.get(kind)) fail(`mnx: no def walked as ${kind}`);
  if ((kinds.get('entity') ?? 0) !== mnx.entities.length)
    fail(`mnx: entity defs (${kinds.get('entity')}) and entities (${mnx.entities.length}) disagree`);

  const refsInto = (id: string) =>
    mnx.edges.filter((e) => e.kind === 'ref' && e.target === id).length;
  const refsFrom = (id: string) =>
    mnx.edges.filter((e) => e.kind === 'ref' && e.source === id).length;
  // a def used by many props is the case that made ref support worth having,
  // and a card with many outgoing refs is the other end of it
  if (refsInto('$defs/rhythmic-position') < 8)
    fail(
      `mnx: rhythmic-position should be widely referenced (got ${refsInto('$defs/rhythmic-position')})`,
    );
  if (refsFrom('$defs/part-measure') < 6)
    fail(`mnx: part-measure should reference many defs (got ${refsFrom('$defs/part-measure')})`);

  // `allOf: [{$ref}]` is inheritance, drawn as an "extends" line, not an edge
  const inheriting = mnx.entities.filter((e) => e.inherits?.length).length;
  if (inheriting < 60) fail(`mnx: expected most cards to inherit, got ${inheriting}`);

  const unionEdges = mnx.edges.filter((e) => e.union).length;
  if (unionEdges < 8) fail(`mnx: expected anyOf branches to emit union edges, got ${unionEdges}`);
  const mapEdges = mnx.edges.filter((e) => e.marker === '{}').length;
  if (mapEdges < 3) fail(`mnx: expected patternProperties to emit map edges, got ${mapEdges}`);

  // The three self-references, each reached through a different kind of alias.
  // A walker that does not visit a ref once per path hangs here rather than
  // failing, which is why all three are kept.
  const cycles: [string, string][] = [
    ['$defs/beam', 'beam-list'], // array alias
    ['$defs/tuplet', 'sequence-content'], // union alias
    ['$defs/staff-group', 'system-layout-content'], // union alias, nested groups
  ];
  for (const [id, via] of cycles)
    if (!mnx.edges.some((e) => e.source === id && e.target === id && e.via === via))
      fail(`mnx: expected ${id} self-edge via ${via}`);

  console.log(
    `mnx : ${inheriting} inheriting, ${unionEdges} union edges, ${mapEdges} map edges, ${cycles.length} cycles`,
  );
}

console.log('walker checks OK');
