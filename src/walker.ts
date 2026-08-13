// Pure JSON Schema -> { entities, edges } walker, $ref-aware.
//
// An entity is the root, any object, any array-of-objects, or any $def that
// resolves to an object shape. Every other property becomes a row of its
// owning entity. Ids are schema paths ("tax_status.client.tax_residencies[]")
// or canonical def pointers ("$defs/person_details") — layout persistence
// keys on them.
//
// Every object prop is emitted BOTH ways: as a row on the owning entity
// (`RowInfo.link`) and as the edge(s) it points down (`EdgeInfo.fromRow`).
// Which of the two a card actually draws is a view decision (depth gating in
// App.tsx), not a walker one.
//
// Ref rendering decisions (the DB-visualizer model):
// - A def renders ONCE; a property referencing an entity def becomes a
//   labelled reference edge, not an inlined copy. "[]" marks array-of-ref,
//   "{}" marks patternProperties maps, union = an anyOf/oneOf branch.
// - Scalar defs (enums, constrained strings/ints — MNX's "orientation", "id")
//   do NOT get boxes: the using row's type chip is the def name, and the
//   detail panel shows the resolved definition. Type aliases stay types.
// - Every row written as a $ref carries `ref` (the def names it borrows its
//   shape from), so the view can mark referenced and leave inline unmarked —
//   a scalar-def row has no edge, so the row is the only place to say it.
// - Array/map alias defs ("beam-list" = beam[], "kit" = map of kit-component)
//   are skipped as nodes; edges route straight to the item def, recorded via
//   the edge's `via`.
// - allOf composition renders as an "extends" line on the card (inherited
//   properties are not repeated as rows) instead of an edge — every MNX def
//   extends global-attrs, and 100+ edges into one node is a hairball, not a
//   picture. Cycle-safe throughout: defs are walked once each by iteration,
//   classification and allOf resolution carry visited sets.

export type JsonSchema = Record<string, unknown> & {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  patternProperties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  $defs?: Record<string, JsonSchema>;
  $ref?: string;
  allOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  enum?: (string | number | null)[];
  const?: unknown;
  required?: string[];
  description?: string;
  title?: string;
  format?: string;
  pattern?: string;
  uniqueItems?: boolean;
  contentMediaType?: string;
  $comment?: string;
};

export interface PropMeta {
  description?: string;
  title?: string;
  enumValues?: (string | number | null)[];
  format?: string;
  pattern?: string;
  uniqueItems?: boolean;
  contentMediaType?: string;
  /** validation constraints worth badging (maxLength, minimum, closed, ...) */
  constraints?: Record<string, string | number | boolean>;
  /** name of the scalar def this row's type resolves to */
  refName?: string;
  /** $comment and structural notes (oneOf requirements) */
  comment?: string;
  /** x-* keywords except x-propertyOrder */
  extensions: Record<string, unknown>;
}

export interface RowInfo {
  id: string;
  name: string;
  chip: string;
  nullable: boolean;
  required: boolean;
  meta: PropMeta;
  /**
   * The def names this row borrows its shape from — present exactly when the
   * row is written as a `$ref` (empty when the ref does not resolve here).
   * The view's one test for "referenced, not inline": `meta.refName` cannot
   * serve, since it doubles as a `$defs` lookup key and so holds a single
   * name and is absent on rows whose ref sits on `items`/`patternProperties`.
   */
  ref?: string[];
  /**
   * Object prop: this row is the row rendering of a relationship, and the
   * edges it emits leave from it. Emitted for every object prop whether or
   * not the view draws it — depth gating is a view concern, and the panel,
   * the breadcrumb and the edge anchoring all key off the row.
   */
  link?: { targets: string[]; edgeIds: string[] };
}

/** one branch of a union, as the junction renders it */
export interface VariantInfo {
  /** edge label: the variant's tag value, or the target def name untagged */
  label: string;
  /** entity def the variant resolves to */
  target: string;
  /** elided tag+body wrapper def the edge routes through */
  via?: string;
  description?: string;
}

export interface JunctionInfo {
  /** the applicator this choice is written with — named, never guessed */
  keyword: 'anyOf' | 'oneOf';
  /** the shared tag property when the union is tagged (partyType) */
  tagProp?: string;
  variants: VariantInfo[];
  /** non-entity branches, as chips (a mixed union's scalar arms) */
  scalarChips?: string[];
}

export interface EntityInfo {
  id: string;
  label: string;
  kind: 'root' | 'object' | 'array' | 'junction';
  nullable: boolean;
  depth: number;
  section?: string;
  /** def name when this entity is a $def */
  defName?: string;
  /** the document's designated entry (root schema, or the def the root $refs) */
  isEntry?: boolean;
  /** def names composed in via allOf */
  inherits?: string[];
  rows: RowInfo[];
  meta: PropMeta;
  /** the choice this junction stands for (kind === 'junction' only) */
  junction?: JunctionInfo;
}

export interface EdgeInfo {
  id: string;
  source: string;
  target: string;
  label: string;
  kind: 'containment' | 'ref';
  /** "[]" = array-of-ref, "{}" = patternProperties map */
  marker?: '[]' | '{}';
  /** one branch of an anyOf/oneOf union */
  union?: boolean;
  /** alias def the edge routes through (beam-list, kit) */
  via?: string;
  /** use-site sibling description */
  description?: string;
  /** id of the row on the source card this edge leaves from */
  fromRow?: string;
}

export type DefKind = 'entity' | 'scalar' | 'array-alias' | 'map-alias' | 'variant-alias';

/**
 * One `$defs` member, as the document declares it and as the canvas resolved
 * it. Only entity defs become cards; the rest are drawn as chips or elided
 * into an edge, and this is what the views navigate them by.
 */
export interface DefInfo {
  name: string;
  kind: DefKind;
  /** the card's id, for the kinds that get one */
  entityId?: string;
  /** def names an alias/wrapper routes to */
  targets?: string[];
  /** `$ref`s to this def anywhere in the document, allOf branches included */
  uses: number;
  /** the type chip a using row shows for a scalar def */
  chip?: string;
  description?: string;
}

export interface WalkResult {
  entities: EntityInfo[];
  edges: EdgeInfo[];
  defs: DefInfo[];
}

export const ROOT_ID = '$root';
export const DEF_PREFIX = '$defs/';

function typeSet(schema: JsonSchema): Set<string> {
  const t = schema.type;
  if (typeof t === 'string') return new Set([t]);
  if (Array.isArray(t)) return new Set(t);
  return new Set();
}

function isNullable(schema: JsonSchema): boolean {
  if (typeSet(schema).has('null')) return true;
  if (Array.isArray(schema.enum) && schema.enum.includes(null)) return true;
  return false;
}

function refName(ref: string): string | undefined {
  return ref.startsWith('#/$defs/') ? ref.slice('#/$defs/'.length) : undefined;
}

const CONSTRAINT_KEYS = [
  'maxLength',
  'minLength',
  'maximum',
  'minimum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'maxItems',
  'minItems',
] as const;

function constraintsOf(schema: JsonSchema): Record<string, string | number | boolean> | undefined {
  const out: Record<string, string | number | boolean> = {};
  for (const k of CONSTRAINT_KEYS) {
    const v = schema[k];
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') out[k] = v;
  }
  if (schema.const !== undefined) out.const = JSON.stringify(schema.const);
  if (schema.additionalProperties === false || schema.unevaluatedProperties === false)
    out.closed = true;
  return Object.keys(out).length ? out : undefined;
}

function metaOf(schema: JsonSchema): PropMeta {
  const extensions: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k.startsWith('x-') && k !== 'x-propertyOrder') extensions[k] = v;
  }
  let comment = schema.$comment;
  const oneOf = schema.oneOf;
  if (Array.isArray(oneOf) && oneOf.every((b) => Array.isArray(b.required) && !b.properties)) {
    const note = `oneOf: requires ${oneOf.map((b) => (b.required as string[]).join(' + ')).join(' | ')}`;
    comment = comment ? `${comment}\n${note}` : note;
  }
  return {
    description: schema.description,
    title: schema.title,
    enumValues: Array.isArray(schema.enum) ? schema.enum : undefined,
    format: schema.format,
    pattern: schema.pattern,
    uniqueItems: schema.uniqueItems,
    contentMediaType: schema.contentMediaType,
    constraints: constraintsOf(schema),
    comment,
    extensions,
  };
}

/** overlay: defined fields of `over` win; extensions/constraints merge */
function mergeMeta(base: PropMeta, over: PropMeta): PropMeta {
  return {
    description: over.description ?? base.description,
    title: over.title ?? base.title,
    enumValues: over.enumValues ?? base.enumValues,
    format: over.format ?? base.format,
    pattern: over.pattern ?? base.pattern,
    uniqueItems: over.uniqueItems ?? base.uniqueItems,
    contentMediaType: over.contentMediaType ?? base.contentMediaType,
    constraints:
      base.constraints || over.constraints
        ? { ...base.constraints, ...over.constraints }
        : undefined,
    refName: over.refName ?? base.refName,
    comment: over.comment ?? base.comment,
    extensions: { ...base.extensions, ...over.extensions },
  };
}

function chipFor(schema: JsonSchema): string {
  if (schema.const !== undefined) return `=${JSON.stringify(schema.const)}`;
  if (typeof schema.$ref === 'string') return 'ref';
  if (Array.isArray(schema.enum)) return `enum(${schema.enum.filter((v) => v !== null).length})`;
  const ts = [...typeSet(schema)].filter((t) => t !== 'null');
  const t = ts[0];
  switch (t) {
    case 'string':
      return schema.format === 'date' ? 'date' : 'string';
    case 'integer':
      return 'int';
    case 'number':
      return 'number';
    case 'boolean':
      return 'bool';
    case 'array':
      return `${chipFor(schema.items ?? {})}[]`;
    case undefined:
      return 'any';
    default:
      return t;
  }
}

interface DefClass {
  kind: 'entity' | 'scalar' | 'array-alias' | 'map-alias' | 'variant-alias';
  targets?: string[];
  union?: boolean;
  /** variant-alias: the tag property and its fixed value */
  tagProp?: string;
  tagValue?: string;
}

/**
 * Every `$ref` in the document, counted by target def name. Counted from the
 * document rather than from the graph on purpose: an allOf branch and a
 * wrapper's inner ref are real use sites that produce no edge, and a def's
 * "N uses" has to mean "N places change if I edit this".
 */
function countRefs(node: unknown, out: Map<string, number>): void {
  if (Array.isArray(node)) {
    for (const v of node) countRefs(v, out);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const rec = node as Record<string, unknown>;
  if (typeof rec.$ref === 'string') {
    const n = refName(rec.$ref);
    if (n !== undefined) out.set(n, (out.get(n) ?? 0) + 1);
  }
  for (const v of Object.values(rec)) countRefs(v, out);
}

/** the fixed value a tag property pins: a const, or a one-value enum */
function tagLabelOf(schema: JsonSchema | undefined): string | undefined {
  if (!schema || typeof schema !== 'object') return undefined;
  if (schema.const !== undefined)
    return typeof schema.const === 'string' ? schema.const : JSON.stringify(schema.const);
  if (Array.isArray(schema.enum) && schema.enum.length === 1 && schema.enum[0] !== null) {
    const v = schema.enum[0];
    return typeof v === 'string' ? v : JSON.stringify(v);
  }
  return undefined;
}

export function walkSchema(root: JsonSchema): WalkResult {
  const defs = root.$defs ?? {};
  const entities: EntityInfo[] = [];
  const edges: EdgeInfo[] = [];
  const edgeIds = new Set<string>();

  /** own + inline-allOf properties and required; $ref allOf branches recorded as inherits */
  function effective(
    schema: JsonSchema,
    seen: Set<string> = new Set(),
  ): { properties: Record<string, JsonSchema>; required: Set<string>; inherits: string[] } {
    const properties: Record<string, JsonSchema> = {};
    const required = new Set<string>(Array.isArray(schema.required) ? schema.required : []);
    const inherits: string[] = [];
    for (const branch of schema.allOf ?? []) {
      const name = typeof branch.$ref === 'string' ? refName(branch.$ref) : undefined;
      if (name !== undefined) {
        if (defs[name] && !seen.has(name)) inherits.push(name);
        continue;
      }
      if (branch && typeof branch === 'object') {
        seen.add('(inline)');
        const sub = effective(branch, seen);
        Object.assign(properties, sub.properties);
        sub.required.forEach((r) => required.add(r));
        inherits.push(...sub.inherits);
      }
    }
    Object.assign(properties, schema.properties ?? {});
    return { properties, required, inherits };
  }

  const classMemo = new Map<string, DefClass>();
  function classify(name: string, stack: Set<string> = new Set()): DefClass {
    const memo = classMemo.get(name);
    if (memo) return memo;
    if (stack.has(name)) return { kind: 'scalar' }; // alias cycle — bail safe
    stack.add(name);
    const def = defs[name];
    let result: DefClass;
    if (!def) {
      result = { kind: 'scalar' };
    } else {
      const ts = typeSet(def);
      const eff = effective(def);
      const patternValues = def.patternProperties ? Object.values(def.patternProperties) : [];
      if (ts.has('object') || Object.keys(eff.properties).length > 0 || def.allOf) {
        const pv = patternValues[0];
        const pvTarget = typeof pv?.$ref === 'string' ? refName(pv.$ref) : undefined;
        // tagged-union variant wrapper: exactly a tag (const / one-value enum)
        // plus a $ref body to an entity def. Elided like alias defs — the
        // union edge routes to the body and the tag rides it (via).
        const propNames = Object.keys(eff.properties);
        const tagName =
          propNames.length === 2
            ? propNames.find((n) => tagLabelOf(eff.properties[n]) !== undefined)
            : undefined;
        const bodyName =
          tagName !== undefined ? propNames.find((n) => n !== tagName) : undefined;
        const bodyRef =
          bodyName !== undefined && typeof eff.properties[bodyName].$ref === 'string'
            ? refName(eff.properties[bodyName].$ref as string)
            : undefined;
        if (
          Object.keys(eff.properties).length === 0 &&
          pvTarget !== undefined &&
          classify(pvTarget, stack).kind === 'entity'
        ) {
          result = { kind: 'map-alias', targets: [pvTarget] };
        } else if (
          tagName !== undefined &&
          bodyRef !== undefined &&
          defs[bodyRef] &&
          classify(bodyRef, stack).kind === 'entity'
        ) {
          result = {
            kind: 'variant-alias',
            targets: [bodyRef],
            tagProp: tagName,
            tagValue: tagLabelOf(eff.properties[tagName]),
          };
        } else {
          result = { kind: 'entity' };
        }
      } else if (ts.has('array')) {
        const items = def.items ?? {};
        const branches = items.anyOf ?? items.oneOf;
        const candidates = (branches ?? [items])
          .map((b) => (typeof b.$ref === 'string' ? refName(b.$ref) : undefined))
          .filter((t): t is string => t !== undefined && classify(t, stack).kind === 'entity');
        result = candidates.length
          ? { kind: 'array-alias', targets: candidates, union: (branches?.length ?? 0) > 1 }
          : { kind: 'scalar' };
      } else {
        result = { kind: 'scalar' };
      }
    }
    stack.delete(name);
    classMemo.set(name, result);
    return result;
  }

  /** the tag of a full (non-elided) variant entity def, if it has exactly one */
  function variantTagOf(def: JsonSchema): { prop: string; value: string } | undefined {
    const hits = Object.entries(effective(def).properties)
      .map(([n, s]) => ({ prop: n, value: tagLabelOf(s) }))
      .filter((h): h is { prop: string; value: string } => h.value !== undefined);
    return hits.length === 1 ? hits[0] : undefined;
  }

  /**
   * A union property is ONE choice, not N look-alike edges: the owning row
   * shows a `1 of N` chip, a stem leads to a junction pill, and each variant
   * leaves the junction as its own edge labelled by the variant's tag value
   * (falling back to the target def name when untagged). Tag+$ref wrapper
   * defs (PersonParty) are elided like alias defs — the edge routes to the
   * body def and the wrapper rides `via`. Returns false when no branch
   * resolves to an entity (a scalar union): the caller draws a plain row.
   */
  function handleUnion(
    entity: EntityInfo,
    name: string,
    childId: string,
    prop: JsonSchema,
    branches: JsonSchema[],
    keyword: 'anyOf' | 'oneOf',
    required: boolean,
    depth: number,
    section: string | undefined,
    marker?: '[]',
  ): boolean {
    const variants: (VariantInfo & { tagProp?: string })[] = [];
    const scalarChips: string[] = [];
    for (const b of branches) {
      const t = typeof b.$ref === 'string' ? refName(b.$ref) : undefined;
      if (t !== undefined && defs[t]) {
        const cls = classify(t);
        if (cls.kind === 'variant-alias') {
          variants.push({
            label: cls.tagValue ?? t,
            target: (cls.targets ?? [])[0],
            via: t,
            description: defs[t].description ?? b.description,
            tagProp: cls.tagProp,
          });
          continue;
        }
        if (cls.kind === 'entity') {
          const tag = variantTagOf(defs[t]);
          variants.push({
            label: tag?.value ?? t,
            target: t,
            description: defs[t].description ?? b.description,
            tagProp: tag?.prop,
          });
          continue;
        }
        scalarChips.push(t);
        continue;
      }
      scalarChips.push(chipFor(b));
    }
    if (!variants.length) return false;

    const junctionId = childId;
    const stemId = `e:${junctionId}`;
    edges.push({
      id: stemId,
      source: entity.id,
      target: junctionId,
      label: name,
      kind: 'containment',
      marker,
      fromRow: childId,
    });
    pushLinkRow(
      entity,
      childId,
      name,
      prop,
      required,
      `1 of ${branches.length}${marker ?? ''}`,
      [junctionId],
      [stemId],
    );
    const tagProp = variants.every((v) => v.tagProp !== undefined && v.tagProp === variants[0].tagProp)
      ? variants[0].tagProp
      : undefined;
    // The choice is a card titled by the property, one row per branch. A row
    // is named by its tag value and typed by the def the branch is *written*
    // as — the elided wrapper where there is one — while its edge runs on to
    // the body def. Rows and edges, like every other card: the tags stop being
    // 9px edge labels that collide when the fan is wide.
    const junction: EntityInfo = {
      id: junctionId,
      label: name,
      kind: 'junction',
      nullable: isNullable(prop),
      depth: depth + 1,
      section,
      rows: [],
      meta: metaOf(prop),
      junction: {
        keyword,
        tagProp,
        variants: variants.map(({ label, target, via, description }) => ({
          label,
          target,
          via,
          description,
        })),
        scalarChips: scalarChips.length ? scalarChips : undefined,
      },
    };
    entities.push(junction);
    for (const v of variants) {
      const rowId = `${junctionId}/${v.label}`;
      const eid = addRefEdge(junctionId, v.label, v.target, {
        marker,
        union: true,
        via: v.via,
        description: v.description,
        fromRow: rowId,
      });
      const written = v.via ?? v.target;
      junction.rows.push({
        id: rowId,
        name: v.label,
        chip: written + (marker ?? ''),
        nullable: false,
        required: false,
        meta: {
          ...metaOf(defs[written] ?? {}),
          description: v.description,
          refName: written,
          extensions: {},
        },
        ref: [written],
        link: { targets: [DEF_PREFIX + v.target], edgeIds: [eid] },
      });
    }
    // a mixed union's scalar arms are branches too — the card shows all of them
    for (const chip of scalarChips)
      junction.rows.push({
        id: `${junctionId}/${chip}`,
        name: chip,
        chip,
        nullable: false,
        required: false,
        meta: { extensions: {} },
      });
    return true;
  }

  function addRefEdge(
    sourceId: string,
    propName: string,
    targetDef: string,
    opts: {
      marker?: '[]' | '{}';
      union?: boolean;
      via?: string;
      description?: string;
      fromRow?: string;
    } = {},
  ): string {
    const target = DEF_PREFIX + targetDef;
    const label = propName + (opts.marker ?? '');
    const id = `e:${sourceId}->${target}:${label}`;
    if (!edgeIds.has(id)) {
      edgeIds.add(id);
      edges.push({ id, source: sourceId, target, label, kind: 'ref', ...opts });
    }
    return id;
  }

  function isObjectSchema(schema: JsonSchema): boolean {
    return typeSet(schema).has('object') || (schema.properties !== undefined && typeSet(schema).size === 0);
  }

  function orderedProps(schema: JsonSchema, props: Record<string, JsonSchema>): [string, JsonSchema][] {
    const order = Array.isArray(schema['x-propertyOrder']) ? (schema['x-propertyOrder'] as string[]) : [];
    const seen = new Set<string>();
    const names: string[] = [];
    for (const k of order) if (k in props && !seen.has(k)) (names.push(k), seen.add(k));
    for (const k of Object.keys(props)) if (!seen.has(k)) names.push(k);
    return names.map((k) => [k, props[k]]);
  }

  function rowMetaOf(schema: JsonSchema): PropMeta {
    const m = metaOf(schema);
    if (typeSet(schema).has('array') && schema.items) {
      const im = metaOf(schema.items);
      m.enumValues ??= im.enumValues;
      m.pattern ??= im.pattern;
      m.format ??= im.format;
      if (im.constraints) m.constraints = { ...im.constraints, ...m.constraints };
    }
    return m;
  }

  /**
   * The row rendering of an object prop, pushed alongside the edge(s) it
   * emits. `refDef` names the def the row is typed by, so the row carries the
   * def's own keywords the way a scalar-def row does.
   */
  function pushLinkRow(
    entity: EntityInfo,
    id: string,
    name: string,
    prop: JsonSchema,
    required: boolean,
    chip: string,
    targets: string[],
    edgeIds: string[],
    refDef?: string,
  ): void {
    const resolved = refDef ? defs[refDef] : undefined;
    const meta = resolved ? mergeMeta(metaOf(resolved), rowMetaOf(prop)) : rowMetaOf(prop);
    if (refDef) meta.refName = refDef;
    entity.rows.push({
      id,
      name,
      chip,
      nullable: isNullable(prop),
      required,
      meta,
      ref: refDef ? [refDef] : undefined,
      link: { targets, edgeIds },
    });
  }

  function handleProp(
    entity: EntityInfo,
    name: string,
    prop: JsonSchema,
    required: boolean,
    depth: number,
    section: string | undefined,
  ): void {
    const childId = entity.id === ROOT_ID ? name : `${entity.id}.${name}`;
    const childSection = section ?? name;

    // direct $ref
    const direct = typeof prop.$ref === 'string' ? refName(prop.$ref) : undefined;
    if (direct !== undefined && defs[direct]) {
      const cls = classify(direct);
      if (cls.kind === 'entity') {
        const eid = addRefEdge(entity.id, name, direct, {
          description: prop.description,
          fromRow: childId,
        });
        pushLinkRow(entity, childId, name, prop, required, direct, [DEF_PREFIX + direct], [eid], direct);
        return;
      }
      if (cls.kind === 'array-alias') {
        const targets = cls.targets ?? [];
        const ids = targets.map((t) =>
          addRefEdge(entity.id, name, t, {
            marker: '[]',
            union: cls.union,
            via: direct,
            description: prop.description,
            fromRow: childId,
          }),
        );
        pushLinkRow(
          entity,
          childId,
          name,
          prop,
          required,
          `${targets.join(' | ')}[]`,
          targets.map((t) => DEF_PREFIX + t),
          ids,
          direct,
        );
        return;
      }
      if (cls.kind === 'map-alias') {
        const target = (cls.targets ?? [])[0];
        const eid = addRefEdge(entity.id, name, target, {
          marker: '{}',
          via: direct,
          description: prop.description,
          fromRow: childId,
        });
        pushLinkRow(entity, childId, name, prop, required, `${target}{}`, [DEF_PREFIX + target], [eid], direct);
        return;
      }
      if (cls.kind === 'variant-alias') {
        // a lone tag+body wrapper used outside a union: route to the body,
        // wrapper on `via`, exactly as a union branch would
        const target = (cls.targets ?? [])[0];
        const eid = addRefEdge(entity.id, name, target, {
          via: direct,
          description: prop.description,
          fromRow: childId,
        });
        pushLinkRow(entity, childId, name, prop, required, target, [DEF_PREFIX + target], [eid], direct);
        return;
      }
      // scalar def -> row typed by the def
      const resolved = defs[direct];
      const meta = mergeMeta(metaOf(resolved), rowMetaOf(prop));
      meta.refName = direct;
      entity.rows.push({
        id: childId,
        name,
        chip: direct,
        nullable: isNullable(prop) || isNullable(resolved),
        required,
        meta,
        ref: [direct],
      });
      return;
    }
    if (typeof prop.$ref === 'string') {
      // unresolvable (external / $dynamicRef territory) — badge, don't guess
      entity.rows.push({
        id: childId,
        name,
        chip: 'ref?',
        nullable: false,
        required,
        meta: { ...rowMetaOf(prop), refName: prop.$ref, extensions: {} },
        ref: [],
      });
      return;
    }

    // object-level unions: one junction per choice (scalar unions fall through
    // to a plain row with the branch chips joined)
    if (!typeSet(prop).has('array')) {
      const anyOf = Array.isArray(prop.anyOf) && prop.anyOf.length > 1 ? prop.anyOf : undefined;
      const oneOf = Array.isArray(prop.oneOf) && prop.oneOf.length > 1 ? prop.oneOf : undefined;
      const branches = anyOf ?? oneOf;
      if (branches) {
        const keyword = anyOf ? 'anyOf' : 'oneOf';
        if (
          handleUnion(entity, name, childId, prop, branches, keyword, required, depth, childSection)
        )
          return;
        const chips = branches.map((b) => {
          const t = typeof b.$ref === 'string' ? refName(b.$ref) : undefined;
          return t ?? chipFor(b);
        });
        const joined = chips.join(' | ');
        entity.rows.push({
          id: childId,
          name,
          chip: joined.length <= 24 ? joined : `any of ${branches.length}`,
          nullable: isNullable(prop) || branches.some((b) => isNullable(b)),
          required,
          meta: rowMetaOf(prop),
        });
        return;
      }
    }

    // arrays: ref items, union items, inline objects, scalars
    if (typeSet(prop).has('array')) {
      const items = prop.items ?? {};
      const branches = items.anyOf ?? items.oneOf;
      if (
        branches &&
        branches.length > 1 &&
        handleUnion(
          entity,
          name,
          childId,
          prop,
          branches,
          items.anyOf ? 'anyOf' : 'oneOf',
          required,
          depth,
          childSection,
          '[]',
        )
      )
        return;
      // a one-branch union is no choice at all — unwrap it to its ref
      const effItems = branches?.length === 1 ? branches[0] : items;
      const itemsRef = typeof effItems.$ref === 'string' ? refName(effItems.$ref) : undefined;
      if (itemsRef !== undefined && defs[itemsRef]) {
        if (classify(itemsRef).kind === 'entity') {
          const eid = addRefEdge(entity.id, name, itemsRef, {
            marker: '[]',
            description: prop.description,
            fromRow: childId,
          });
          pushLinkRow(
            entity,
            childId,
            name,
            prop,
            required,
            `${itemsRef}[]`,
            [DEF_PREFIX + itemsRef],
            [eid],
            itemsRef,
          );
          return;
        }
        const meta = mergeMeta(metaOf(defs[itemsRef]), rowMetaOf(prop));
        meta.refName = itemsRef;
        entity.rows.push({
          id: childId,
          name,
          chip: `${itemsRef}[]`,
          nullable: isNullable(prop),
          required,
          meta,
          ref: [itemsRef],
        });
        return;
      }
      if (isObjectSchema(items)) {
        const itemsId = `${childId}[]`;
        edges.push({
          id: `e:${itemsId}`,
          source: entity.id,
          target: itemsId,
          label: name,
          kind: 'containment',
          marker: '[]',
          fromRow: childId,
        });
        pushLinkRow(
          entity,
          childId,
          name,
          prop,
          required,
          prop.title && prop.title !== name ? `${prop.title}[]` : 'object[]',
          [itemsId],
          [`e:${itemsId}`],
        );
        const at = entities.length;
        walkObject(
          { ...items, description: prop.description ?? items.description },
          itemsId,
          prop.title ?? name,
          'array',
          depth + 1,
          childSection,
        );
        entities[at].nullable = isNullable(prop);
        return;
      }
      // array of scalars — plain row
    }

    // inline object -> containment child. The row id IS the child card's id:
    // the row and the card are the same subject, so selecting either resolves
    // to one thing.
    if (isObjectSchema(prop)) {
      edges.push({
        id: `e:${childId}`,
        source: entity.id,
        target: childId,
        label: name,
        kind: 'containment',
        fromRow: childId,
      });
      pushLinkRow(
        entity,
        childId,
        name,
        prop,
        required,
        prop.title && prop.title !== name ? prop.title : 'object',
        [childId],
        [`e:${childId}`],
      );
      walkObject(prop, childId, prop.title ?? name, 'object', depth + 1, childSection);
      return;
    }

    // inline patternProperties map
    if (prop.patternProperties) {
      const v = Object.values(prop.patternProperties)[0];
      const t = typeof v?.$ref === 'string' ? refName(v.$ref) : undefined;
      if (t !== undefined && defs[t] && classify(t).kind === 'entity') {
        const eid = addRefEdge(entity.id, name, t, {
          marker: '{}',
          description: prop.description,
          fromRow: childId,
        });
        pushLinkRow(entity, childId, name, prop, required, `${t}{}`, [DEF_PREFIX + t], [eid], t);
        return;
      }
    }

    // scalar row
    entity.rows.push({
      id: childId,
      name,
      chip: chipFor(prop),
      nullable: isNullable(prop),
      required,
      meta: rowMetaOf(prop),
    });
  }

  function walkObject(
    schema: JsonSchema,
    id: string,
    label: string,
    kind: EntityInfo['kind'],
    depth: number,
    section: string | undefined,
    opts: { isEntry?: boolean; defName?: string } = {},
  ): void {
    const eff = effective(schema);
    const entity: EntityInfo = {
      id,
      label,
      kind,
      nullable: isNullable(schema),
      depth,
      section,
      defName: opts.defName,
      isEntry: opts.isEntry,
      inherits: eff.inherits.length ? eff.inherits : undefined,
      rows: [],
      meta: metaOf(schema),
    };
    entities.push(entity);
    for (const [name, prop] of orderedProps(schema, eff.properties)) {
      handleProp(entity, name, prop, eff.required.has(name), depth, depth === 0 ? undefined : section);
    }
  }

  // --- drive ---
  const entryDef = typeof root.$ref === 'string' ? refName(root.$ref) : undefined;
  if (root.properties) {
    walkObject(root, ROOT_ID, root.title ?? 'schema', 'root', 0, undefined, { isEntry: true });
  }
  for (const [name, def] of Object.entries(defs)) {
    if (classify(name).kind !== 'entity') continue;
    walkObject(def, DEF_PREFIX + name, name, 'object', 1, name, {
      defName: name,
      isEntry: name === entryDef,
    });
  }

  const refCounts = new Map<string, number>();
  countRefs(root, refCounts);
  const defInfos: DefInfo[] = Object.entries(defs).map(([name, def]) => {
    const cls = classify(name);
    return {
      name,
      kind: cls.kind,
      entityId: cls.kind === 'entity' ? DEF_PREFIX + name : undefined,
      targets: cls.targets,
      uses: refCounts.get(name) ?? 0,
      chip: cls.kind === 'scalar' ? chipFor(def) : undefined,
      description: def.description,
    };
  });
  return { entities, edges, defs: defInfos };
}
