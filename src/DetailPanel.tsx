import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DefInfo, DefKind, EdgeInfo, EntityInfo, JunctionInfo, PropMeta, RowInfo, WalkResult } from './walker';
import { indexUseSites, WHY_NO_CARD, type UseSite } from './defUses';
import { DEF_PREFIX, type JsonSchema } from './walker';
import { useExplodedStore } from './store';
import { nodeAt } from './jsonPointer';
import { chipTone } from './chipTone';

type Select = (id: string | undefined) => void;

/** literal display value for one schema keyword; big subtrees summarize */
function fmtValue(v: unknown): { text: string; cls: string } {
  if (typeof v === 'string') return { text: `"${v}"`, cls: 'kv-string' };
  if (typeof v === 'number') return { text: String(v), cls: 'kv-number' };
  if (typeof v === 'boolean' || v === null) return { text: String(v), cls: 'kv-bool' };
  const s = JSON.stringify(v);
  if (Array.isArray(v)) {
    if (s.length <= 100 || v.every((x) => x === null || typeof x !== 'object'))
      return { text: s, cls: 'kv-json' };
    return { text: `[${v.length} items]`, cls: 'kv-sum' };
  }
  if (s.length <= 100) return { text: s, cls: 'kv-json' };
  return { text: `{${Object.keys(v as object).length} keys}`, cls: 'kv-sum' };
}

/** the schema node's own keys, rendered literally as key: value rows */
function KeywordList({ node, omit }: { node: JsonSchema; omit?: string[] }) {
  const entries = Object.entries(node).filter(([k]) => !omit?.includes(k));
  if (!entries.length) return null;
  return (
    <div className="kv-list">
      {entries.map(([k, v]) => {
        const { text, cls } = fmtValue(v);
        return (
          <Fragment key={k}>
            <span className="kv-key">{k}</span>
            <span className={`kv-val ${cls}`}>{text}</span>
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * Literal keyword view of an entity/row, resolved from the raw document.
 * Derived-only facts (required lives on the parent; walker-injected
 * descriptions for array entities and $ref merges) fill the gaps.
 */
function LiteralDetails({
  id,
  meta,
  required,
  omit,
}: {
  id: string;
  meta: PropMeta;
  required?: boolean;
  /** keywords the caller has already rendered as prose */
  omit?: string[];
}) {
  const schemaDoc = useExplodedStore((s) => s.schemaDoc);
  const node = schemaDoc ? nodeAt(schemaDoc, id) : undefined;
  const defNode =
    meta.refName && !meta.refName.includes('/') ? schemaDoc?.$defs?.[meta.refName] : undefined;
  return (
    <>
      {(required || meta.refName) && (
        <div className="badges">
          {required && <span className="badge badge-req">required</span>}
          {meta.refName && <span className="badge badge-ref">def: {meta.refName}</span>}
        </div>
      )}
      {node ? (
        <KeywordList node={node} omit={omit} />
      ) : (
        meta.description === undefined && (
          <p className="desc detail-comment">not resolvable in the loaded document</p>
        )
      )}
      {defNode && (
        <div className="detail-section">
          <h3>$defs/{meta.refName}</h3>
          <KeywordList node={defNode} />
        </div>
      )}
    </>
  );
}

function CopyButton({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="icon-btn icon-btn-sq"
      title={title}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? '✓' : '⧉'}
    </button>
  );
}

function PathRow({ path }: { path: string }) {
  return (
    <div className="path-row">
      <code className="path-field" title={path}>
        {path}
      </code>
      <CopyButton text={path} title="copy path" />
    </div>
  );
}

function FocusButton() {
  const focus = useExplodedStore((s) => s.focus);
  const toggleFocus = useExplodedStore((s) => s.toggleFocus);
  return (
    <button
      className={`mini-btn mini-btn-accent${focus ? ' active' : ''}`}
      onClick={toggleFocus}
      title="show only this schema and its direct relationships (F)"
    >
      <span>⌖</span>focus
    </button>
  );
}

function EdgeSubject({ edge, select }: { edge: EdgeInfo; select: Select }) {
  // an edge is either a $ref or a property applied in place — it was calling
  // both "reference", which made every inline nesting look like a ref
  const isRef = edge.kind === 'ref';
  return (
    <div className="subject">
      <div className="subject-head">
        <span className="subject-glyph">→</span>
        <h2>{edge.label}</h2>
        <span className={`chip chip-link${isRef ? ' chip-ref' : ''}`}>
          {isRef ? '$ref' : 'property'}
        </span>
        {edge.marker && (
          <span className="chip">{edge.marker === '[]' ? 'array of' : 'map of'}</span>
        )}
      </div>
      <PathRow path={`${edge.source} → ${edge.target}`} />
      <div className="subject-actions">
        <button className="mini-btn mini-btn-link" onClick={() => select(edge.target)}>
          open {edge.target.replace(DEF_PREFIX, '$defs/')}
        </button>
        <span className="spacer" />
      </div>
    </div>
  );
}

function EdgeBody({ edge, junction }: { edge: EdgeInfo; junction?: JunctionInfo }) {
  const tag = edge.label.replace(/\[\]$/, '');
  const others = junction?.variants.map((v) => v.label).filter((l) => l !== tag) ?? [];
  return (
    <>
      {edge.description && <p className="desc">{edge.description}</p>}
      {(edge.union || edge.via) && (
        <div className="badges">
          {edge.union && (
            <span className="badge">
              {junction ? `${junction.keyword} variant` : 'union branch'}
            </span>
          )}
          {edge.via && <span className="badge badge-ref">via $defs/{edge.via}</span>}
        </div>
      )}
      {junction && (
        <p className="desc detail-comment">
          1 of {junction.variants.length + (junction.scalarChips?.length ?? 0)}
          {junction.tagProp && (
            <>
              {' '}
              — <code>{junction.tagProp}</code> = <code>{tag}</code>
            </>
          )}
          {others.length > 0 && <> · others: {others.join(', ')}</>}
        </p>
      )}
    </>
  );
}

/** the choice a junction stands for: its variants, tag-first */
function JunctionBody({ entity, select }: { entity: EntityInfo; select: Select }) {
  const schemaDoc = useExplodedStore((s) => s.schemaDoc);
  const node = schemaDoc ? nodeAt(schemaDoc, entity.id) : undefined;
  const description = node?.description ?? entity.meta.description;
  const j = entity.junction;
  if (!j) return null;
  return (
    <>
      {description && <p className="desc">{description}</p>}
      <p className="desc detail-comment">
        exactly one variant
        {j.tagProp && (
          <>
            {' '}
            — discriminated by <code>{j.tagProp}</code>
          </>
        )}
      </p>
      <div className="table-head">
        <span className="label">Variants</span>
        <span className="count">{j.variants.length}</span>
      </div>
      <div className="variant-list">
        {j.variants.map((v) => (
          <button
            className="variant-row"
            key={v.label}
            onClick={() => select(DEF_PREFIX + v.target)}
            title={`open $defs/${v.target}`}
          >
            <span className="variant-head">
              <span className="chip chip-const">{v.label}</span>
              <span className="chip chip-link">→ {v.target}</span>
              {v.via && <span className="variant-via">via {v.via}</span>}
            </span>
            {v.description && <span className="variant-desc">{v.description}</span>}
          </button>
        ))}
      </div>
      {j.scalarChips && (
        <p className="desc detail-comment">also allows: {j.scalarChips.join(', ')}</p>
      )}
      <details className="raw-kw">
        <summary>
          <span className="label">Raw keywords</span>
          <span className="spacer" />
          <span className="count">as written</span>
        </summary>
        <div className="raw-kw-body">
          <LiteralDetails id={entity.id} meta={entity.meta} />
        </div>
      </details>
    </>
  );
}

/**
 * Where a def is used, and how to get there. A def card has no containment
 * parent, and an elided def has no card at all, so without this there is no
 * way back out of a definition to the properties that depend on it.
 */
function UseSiteList({
  sites,
  kind,
  docRefs,
  select,
}: {
  sites: UseSite[];
  kind?: DefKind;
  /** literal `$ref`s in the document, for the shortfall note */
  docRefs?: number;
  select: Select;
}) {
  // an unused *entity* def is the normal shape of a defs-only catalogue — each
  // top-level entity is lifted out as its own extraction schema. An unused
  // scalar or alias cannot be lifted, so it really is leftovers.
  if (!sites.length)
    return (
      <>
        <div className="table-head">
          <span className="label">Referenced by</span>
          <span className="count">0</span>
        </div>
        <p className="desc detail-comment">
          {kind === undefined || kind === 'entity'
            ? 'nothing in this document references it — expected for a top-level entity used as its own extraction root'
            : 'nothing references it — dead unless something outside this document uses it'}
        </p>
      </>
    );
  return (
    <>
      <div className="table-head">
        <span className="label">Referenced by</span>
        <span className="count">{sites.length}</span>
      </div>
      <div className="prop-table">
        {sites.map((s) => (
          <button
            className="prop-row prop-link"
            key={`${s.how}:${s.id}`}
            onClick={() => select(s.id)}
            title={s.via ? `${s.id} — via $defs/${s.via}` : s.id}
          >
            <span className="prop-name use-site">
              {s.prop !== undefined && <span className="use-owner">{s.owner}.</span>}
              <span className="use-prop">{s.prop ?? s.owner}</span>
            </span>
            <span className="prop-flag" />
            <span className="chip chip-link chip-ref">
              {s.how === 'extends' ? 'allOf' : s.how === 'entry' ? 'root $ref' : '$ref'}
            </span>
          </button>
        ))}
      </div>
      {docRefs !== undefined && docRefs > sites.length && (
        <p className="desc detail-comment">
          {docRefs} $refs in the document; {sites.length} of them land somewhere the canvas draws
        </p>
      )}
    </>
  );
}

/** a $def the canvas draws as a chip or elides into an edge — no card to select */
function DefSubject({ def, uses }: { def: DefInfo; uses: number }) {
  return (
    <div className="subject">
      <div className="subject-head">
        <span className="subject-glyph">{'{ }'}</span>
        <h2>{def.name}</h2>
        <span className="chip">definition</span>
        {def.chip && <span className="chip chip-ref">{def.chip}</span>}
        <span className="chip chip-ref chip-uses" title="places on the canvas that use this def">
          {uses} use{uses === 1 ? '' : 's'}
        </span>
      </div>
      <PathRow path={DEF_PREFIX + def.name} />
    </div>
  );
}

function DefBody({
  def,
  sites,
  select,
}: {
  def: DefInfo;
  sites: UseSite[];
  select: Select;
}) {
  const schemaDoc = useExplodedStore((s) => s.schemaDoc);
  const node = schemaDoc?.$defs?.[def.name];
  return (
    <>
      {def.description && <p className="desc">{def.description}</p>}
      {/* not drawn is a fact about the canvas, not a failure — say which one */}
      <p className="desc detail-comment">{WHY_NO_CARD[def.kind]}</p>
      {def.targets?.length ? (
        <div className="detail-section">
          <h3>Routes to</h3>
          <ul className="enum-list">
            {def.targets.map((t) => (
              <li key={t}>
                <button className="link-btn" onClick={() => select(DEF_PREFIX + t)}>
                  $defs/{t}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <UseSiteList sites={sites} kind={def.kind} docRefs={def.uses} select={select} />
      <details className="raw-kw" open>
        <summary>
          <span className="label">Raw keywords</span>
          <span className="spacer" />
          <span className="count">{node ? Object.keys(node).length : 0} keys · as written</span>
        </summary>
        <div className="raw-kw-body">
          {node ? (
            <KeywordList node={node} />
          ) : (
            <p className="desc detail-comment">not resolvable in the loaded document</p>
          )}
        </div>
      </details>
    </>
  );
}

function EntitySubject({
  entity,
  result,
  siteIndex,
  select,
}: {
  entity: EntityInfo;
  result: WalkResult;
  siteIndex: Map<string, UseSite[]>;
  select: Select;
}) {
  // JSON Schema's own words: a card is a root schema, a definition, the
  // schema under `items`, a subschema, or the applicator a junction stands for
  const kind =
    entity.kind === 'root'
      ? 'root schema'
      : entity.kind === 'junction'
        ? (entity.junction?.keyword ?? 'anyOf')
        : entity.defName
          ? 'definition'
          : entity.kind === 'array'
            ? 'items schema'
            : 'subschema';
  const uses = entity.defName !== undefined ? (siteIndex.get(entity.defName)?.length ?? 0) : 0;
  const parentEdge = result.edges.find((e) => e.kind === 'containment' && e.target === entity.id);
  const parentLabel = parentEdge
    ? (result.entities.find((e) => e.id === parentEdge.source)?.label ?? parentEdge.source)
    : undefined;
  return (
    <div className="subject">
      <div className="subject-head">
        <span
          className={`subject-glyph${entity.kind === 'array' ? ' is-array' : ''}${
            entity.isEntry ? ' is-root' : ''
          }`}
        >
          {entity.kind === 'array' ? '[ ]' : entity.kind === 'junction' ? '( | )' : '{ }'}
        </span>
        <h2>{entity.label}</h2>
        <span className={`chip${entity.kind === 'array' ? ' chip-enum' : ''}`}>{kind}</span>
        {uses > 0 && (
          <span className="chip chip-ref chip-uses" title="properties that $ref this definition">
            {uses} use{uses === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <PathRow path={entity.id} />
      <div className="subject-actions">
        {parentEdge && (
          <button
            className="mini-btn mini-btn-link"
            onClick={() => select(parentEdge.source)}
            title={parentEdge.source}
          >
            <span>↑</span>
            {parentLabel}
          </button>
        )}
        {entity.nullable && <span className="chip chip-null">null ok</span>}
        <span className="spacer" />
        <FocusButton />
      </div>
    </div>
  );
}

function EntityBody({
  entity,
  result,
  sites,
  select,
  selectedRowId,
}: {
  entity: EntityInfo;
  result: WalkResult;
  /** use sites of this card's def, empty for a card that isn't one */
  sites: UseSite[];
  select: Select;
  selectedRowId?: string;
}) {
  const schemaDoc = useExplodedStore((s) => s.schemaDoc);
  const node = schemaDoc ? nodeAt(schemaDoc, entity.id) : undefined;
  const description = node?.description ?? entity.meta.description;
  const children = result.edges.filter((e) => e.kind === 'containment' && e.source === entity.id);
  const refs = result.edges.filter((e) => e.kind === 'ref' && e.source === entity.id);
  const entityById = new Map(result.entities.map((e) => [e.id, e]));

  // object props are listed once, as the relation they are — not twice
  const rows = entity.rows.filter((r) => !r.link);

  // Row order is the schema's (x-propertyOrder), and clicking a row must not
  // reorder the table under the cursor. A selection arriving from elsewhere —
  // the canvas, the JSON panel, a validation finding — may be below the fold,
  // so scroll to it instead; 'nearest' is a no-op when it is already in view.
  const activeRow = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedRowId]);
  const keywordCount = node ? Object.keys(node).length : 0;
  const ordered = node?.['x-propertyOrder'] !== undefined;

  return (
    <>
      {description && <p className="desc">{description}</p>}
      {entity.inherits && (
        <div className="detail-section">
          <h3>Extends</h3>
          <ul className="enum-list">
            {entity.inherits.map((n) => (
              <li key={n}>
                <button className="link-btn" onClick={() => select(DEF_PREFIX + n)}>
                  $defs/{n}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(rows.length > 0 || children.length > 0 || refs.length > 0) && (
        <>
          <div className="table-head">
            <span className="label">Properties</span>
            <span className="count">
              {rows.length} value · {children.length + refs.length} object
            </span>
            <span className="spacer" />
            {ordered && <span className="count">x-propertyOrder</span>}
          </div>
          <div className="prop-table">
            {rows.map((r) => (
              <button
                className={`prop-row${selectedRowId === r.id ? ' active' : ''}`}
                key={r.id}
                ref={selectedRowId === r.id ? activeRow : undefined}
                onClick={() => select(r.id)}
              >
                <span className="prop-name">{r.name}</span>
                <span
                  className={`prop-flag${r.required ? ' is-req' : r.nullable ? ' is-null' : ''}`}
                >
                  {r.required ? 'req' : r.nullable ? 'null' : ''}
                </span>
                <span className={`chip ${chipTone(r.chip)}${r.ref ? ' chip-ref' : ''}`}>
                  {r.chip}
                </span>
              </button>
            ))}
            {/* inline objects say nothing extra — the shape is right here */}
            {children.map((e) => {
              const target = entityById.get(e.target);
              const chip =
                target?.kind === 'array'
                  ? 'object[]'
                  : target?.kind === 'junction'
                    ? (target.label ?? 'choice')
                    : 'object';
              return (
                <button className="prop-row prop-link" key={e.id} onClick={() => select(e.target)}>
                  <span className="prop-name">{e.label}</span>
                  <span className="prop-flag" />
                  <span className="chip chip-link">{chip}</span>
                </button>
              );
            })}
            {refs.map((e) => (
              <button className="prop-row prop-link" key={e.id} onClick={() => select(e.target)}>
                <span className="prop-name">{e.label}</span>
                <span className="prop-flag" />
                <span className="chip chip-link chip-ref" title={`$ref → ${e.target}`}>
                  → {e.target.replace(DEF_PREFIX, '')}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {entity.defName !== undefined && (
        <UseSiteList
          sites={sites}
          kind="entity"
          docRefs={result.defs.find((d) => d.name === entity.defName)?.uses}
          select={select}
        />
      )}
      <details className="raw-kw">
        <summary>
          <span className="label">Raw keywords</span>
          <span className="spacer" />
          <span className="count">{keywordCount} keys · as written</span>
        </summary>
        <div className="raw-kw-body">
          <LiteralDetails id={entity.id} meta={entity.meta} />
        </div>
      </details>
    </>
  );
}

/** the selected property, pinned under the body on its own surface */
function FieldDrawer({
  entity,
  row,
  result,
  select,
}: {
  entity: EntityInfo;
  row: RowInfo;
  result: WalkResult;
  select: Select;
}) {
  const schemaDoc = useExplodedStore((s) => s.schemaDoc);
  const node = schemaDoc ? nodeAt(schemaDoc, row.id) : undefined;
  const description = node?.description ?? row.meta.description;
  // scalar-def rows have no edge to click, so the only route to the def they
  // borrow is from here — and every def is a subject now, card or not
  const openable = (row.ref ?? []).filter((n) => result.defs.some((d) => d.name === n));
  return (
    <div className="field-drawer">
      <div className="drawer-bar">
        <span className="label label-accent">Property</span>
        <span className="spacer" />
        <button
          className="icon-btn"
          onClick={() => select(entity.id)}
          title="close field details"
        >
          ×
        </button>
      </div>
      <div className="drawer-body">
        <div className="subject-head">
          <h2>{row.name}</h2>
          <span className={`chip ${chipTone(row.chip, !!row.link)}${row.ref ? ' chip-ref' : ''}`}>
            {row.chip}
          </span>
          {row.nullable && <span className="chip chip-null">null ok</span>}
        </div>
        <PathRow path={row.id} />
        {openable.length > 0 && (
          <div className="subject-actions">
            {openable.map((n) => (
              <button
                className="mini-btn mini-btn-link"
                key={n}
                onClick={() => select(DEF_PREFIX + n)}
              >
                open $defs/{n}
              </button>
            ))}
            <span className="spacer" />
          </div>
        )}
        {description && <p className="desc">{description}</p>}
        {/* the description is above as prose; repeating it as a literal
            keyword would be the whole drawer twice */}
        <LiteralDetails id={row.id} meta={row.meta} required={row.required} omit={['description']} />
      </div>
    </div>
  );
}

export function DetailPanel({ result }: { result?: WalkResult }) {
  const selectedId = useExplodedStore((s) => s.selectedId);
  const select = useExplodedStore((s) => s.select);
  const open = useExplodedStore((s) => s.rightOpen);
  const toggleRight = useExplodedStore((s) => s.toggleRight);
  const bodyRef = useRef<HTMLDivElement>(null);

  // one index for the whole panel: the subject chip, the card's list and the
  // def body must not each derive their own answer to "how many uses"
  const siteIndex = useMemo(
    () => (result ? indexUseSites(result) : new Map<string, UseSite[]>()),
    [result],
  );

  const found = useMemo(() => {
    if (!result || !selectedId) return undefined;
    // a junction shares its id with the owning row (same subject); the choice
    // view wins over the owner+drawer view
    for (const entity of result.entities)
      if (entity.id === selectedId && entity.kind === 'junction')
        return { entity, row: undefined };
    for (const entity of result.entities) {
      if (entity.id === selectedId) return { entity, row: undefined };
      const row = entity.rows.find((r) => r.id === selectedId);
      if (row) return { entity, row };
    }
    const edge = result.edges.find((e) => e.id === selectedId);
    if (edge) return { edge };
    // a def the canvas draws as a chip or elides into an edge: no card, but
    // still a thing the document declares and the tree can click
    if (selectedId.startsWith(DEF_PREFIX)) {
      const def = result.defs.find((d) => DEF_PREFIX + d.name === selectedId);
      if (def) return { def };
    }
    return undefined;
  }, [result, selectedId]);

  // the panel stops at the entity level: a selected row shows its OWNING
  // entity, with the row itself in the field drawer underneath
  let edge: EdgeInfo | undefined;
  let entity: EntityInfo | undefined;
  let row: RowInfo | undefined;
  let def: DefInfo | undefined;
  if (found && 'edge' in found) {
    edge = found.edge;
  } else if (found && 'def' in found) {
    def = found.def;
  } else if (found) {
    entity = found.entity;
    row = found.row;
  }
  if (!edge && !entity && !def)
    entity = result?.entities.find((e) => e.isEntry) ?? result?.entities[0];

  // a new subject scrolls the body back to the top — but not when the
  // selection is a row, which scrolls itself into view instead
  const subjectId = edge?.id ?? entity?.id ?? def?.name;
  const hasRow = row !== undefined;
  useEffect(() => {
    if (!hasRow) bodyRef.current?.scrollTo({ top: 0 });
  }, [subjectId, hasRow]);

  if (!open)
    return (
      <aside className="side-panel side-right collapsed">
        <button className="panel-tab" onClick={toggleRight} title="show details">
          Details
        </button>
      </aside>
    );

  let subject: ReactNode;
  let body: ReactNode;
  if (edge) {
    const src = result?.entities.find((en) => en.id === edge.source);
    subject = <EdgeSubject edge={edge} select={select} />;
    body = <EdgeBody edge={edge} junction={src?.kind === 'junction' ? src.junction : undefined} />;
  } else if (def && result) {
    const sites = siteIndex.get(def.name) ?? [];
    subject = <DefSubject def={def} uses={sites.length} />;
    body = <DefBody def={def} sites={sites} select={select} />;
  } else if (entity && result) {
    subject = <EntitySubject entity={entity} result={result} siteIndex={siteIndex} select={select} />;
    body =
      entity.kind === 'junction' ? (
        <JunctionBody entity={entity} select={select} />
      ) : (
        <EntityBody
          entity={entity}
          result={result}
          sites={(entity.defName && siteIndex.get(entity.defName)) || []}
          select={select}
          selectedRowId={row?.id}
        />
      );
  } else {
    body = <span className="panel-empty">no schema loaded</span>;
  }

  return (
    <aside className="side-panel side-right">
      <div className="panel-bar ruled-bottom">
        <span className="panel-title">Details</span>
        {selectedId && (
          <button
            className="mini-btn"
            onClick={() => select(undefined)}
            title="clear the selection"
          >
            clear<span className="kbd">esc</span>
          </button>
        )}
        <button className="icon-btn" onClick={toggleRight} title="hide panel">
          »
        </button>
      </div>
      {subject}
      {subject && <div className="rule-h" />}
      <div className="detail-body" ref={bodyRef}>
        {body}
      </div>
      {entity && row && result && (
        <FieldDrawer entity={entity} row={row} result={result} select={select} />
      )}
    </aside>
  );
}
