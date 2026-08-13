import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEF_PREFIX, type WalkResult } from './walker';
import { DEF_BADGE, indexUseSites } from './defUses';
import { useExplodedStore } from './store';
import { patchSession, readSession } from './session';
import { idToPointer, pointerToId, ptrKey, type Ptr } from './jsonPointer';
import { prettyWithRanges, type Line } from './prettyJson';

/** "#/$defs/person_details" -> "person_details"; anything else, as written */
function refTail(ref: unknown): string | undefined {
  if (typeof ref !== 'string') return undefined;
  return ref.startsWith('#/$defs/') ? ref.slice('#/$defs/'.length) : ref;
}

/**
 * What a folded node borrows from elsewhere, if anything. Folded, a `$ref`
 * property and an inline object are both `{1}`/`{2}` — this is the tree's
 * version of the dashed chip: referenced says so, inline says nothing.
 */
function refSummary(value: Record<string, unknown>): string | undefined {
  const direct = refTail(value.$ref);
  if (direct !== undefined) return direct;
  const items = value.items as Record<string, unknown> | undefined;
  const inItems = items && typeof items === 'object' ? refTail(items.$ref) : undefined;
  if (inItems !== undefined) return `${inItems}[]`;
  const pattern = value.patternProperties as Record<string, unknown> | undefined;
  const first = pattern && typeof pattern === 'object' ? Object.values(pattern)[0] : undefined;
  const inMap =
    first && typeof first === 'object'
      ? refTail((first as Record<string, unknown>).$ref)
      : undefined;
  return inMap !== undefined ? `${inMap}{}` : undefined;
}

interface TreeCtx {
  expanded: ReadonlySet<string>;
  highlightKey: string | undefined;
  toggle: (key: string) => void;
  register: (key: string) => (el: HTMLDivElement | null) => void;
  onSelect: (ptr: Ptr) => void;
  /** for a `$defs` member: what the canvas did with it, when that isn't a card */
  defBadge: (name: string) => string | undefined;
}

function JsonNode({
  k,
  value,
  ptr,
  depth,
  ctx,
}: {
  k?: string;
  value: unknown;
  ptr: Ptr;
  depth: number;
  ctx: TreeCtx;
}) {
  const key = ptrKey(ptr);
  const hl = ctx.highlightKey === key ? ' jt-hl' : '';
  const indent = { paddingLeft: 6 + depth * 12 };

  if (value === null || typeof value !== 'object') {
    const cls =
      value === null ? 'jt-null' : typeof value === 'string' ? 'jt-string' : typeof value === 'number' ? 'jt-number' : 'jt-bool';
    const text = typeof value === 'string' ? `"${value}"` : String(value);
    return (
      <div
        className={`jt-row jt-leaf${hl}`}
        style={indent}
        ref={ctx.register(key)}
        onClick={() => ctx.onSelect(ptr)}
      >
        {k !== undefined && <span className="jt-key">{k}</span>}
        <span className={`jt-val ${cls}`} title={typeof value === 'string' ? value : undefined}>
          {text}
        </span>
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries: [string | number, unknown][] = isArray
    ? (value as unknown[]).map((v, i) => [i, v] as [number, unknown])
    : Object.entries(value as Record<string, unknown>);
  const open = ctx.expanded.has(key);
  const summary = isArray ? `[${entries.length}]` : `{${entries.length}}`;
  const ref = isArray ? undefined : refSummary(value as Record<string, unknown>);
  // a def that gets no card: worth knowing before you click it, and the same
  // rule as everywhere else — only the unusual case is marked
  const badge = ptr.length === 2 && ptr[0] === '$defs' ? ctx.defBadge(String(ptr[1])) : undefined;

  return (
    <div>
      <div
        className={`jt-row${hl}`}
        style={indent}
        ref={ctx.register(key)}
        onClick={() => {
          if (!open) ctx.toggle(key);
          ctx.onSelect(ptr);
        }}
      >
        <button
          className="jt-caret"
          title={open ? 'fold' : 'unfold'}
          onClick={(ev) => {
            ev.stopPropagation();
            ctx.toggle(key);
          }}
        >
          {open ? '▾' : '▸'}
        </button>
        {k !== undefined && <span className="jt-key">{k}</span>}
        <span className="jt-sum">{summary}</span>
        {badge && (
          <span className="jt-badge" title={`no card — ${badge}`}>
            {badge}
          </span>
        )}
        {ref !== undefined && (
          <span className="jt-ref" title={`$ref → ${ref}`}>
            → {ref}
          </span>
        )}
      </div>
      {open &&
        entries.map(([ck, cv]) => (
          <JsonNode key={String(ck)} k={String(ck)} value={cv} ptr={[...ptr, ck]} depth={depth + 1} ctx={ctx} />
        ))}
    </div>
  );
}

/**
 * One line of the raw view: gutter number, indent guides, syntax-colored
 * tokens. Memoized because a whole schema is a few thousand of these and a
 * selection change only touches the lines entering/leaving the highlight —
 * clicks are handled by delegation on the container so these props stay stable.
 */
const RawLine = memo(function RawLine({
  n,
  line,
  selected,
}: {
  n: number;
  line: Line;
  selected: boolean;
}) {
  return (
    <div className={`jr-line${selected ? ' jr-sel' : ''}`} data-ln={n}>
      <span className="jr-num">{n + 1}</span>
      {line.depth > 0 && <span className="jr-ind" style={{ width: `${line.depth * 2}ch` }} />}
      <span className="jr-code">
        {line.tokens.map((t, i) => (
          <span key={i} className={`jr-${t.k}`}>
            {t.t}
          </span>
        ))}
      </span>
    </div>
  );
});

/**
 * The definitions index. The tree is a *document* view — it lists a def
 * because the document contains it, not because it is navigable — so this is
 * the navigator: every def, what the canvas did with it, and how many places
 * reference it. `0 uses` is a finding, not a formatting case.
 */
function DefsList({
  result,
  selectedId,
  select,
}: {
  result?: WalkResult;
  selectedId?: string;
  select: (id: string | undefined) => void;
}) {
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const defs = result?.defs ?? [];
  // the same count the canvas chip and the panel show, from the same index
  const uses = useMemo(
    () => (result ? indexUseSites(result) : new Map<string, unknown[]>()),
    [result],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  // a filter is about the document you are reading, not the next one
  useEffect(() => setQ(''), [result]);

  const needle = q.trim().toLowerCase();
  const shown = needle ? defs.filter((d) => d.name.toLowerCase().includes(needle)) : defs;
  const useCount = (d: { name: string }) => uses.get(d.name)?.length ?? 0;

  if (!defs.length)
    return (
      <div className="defs-pane">
        <span className="panel-empty">
          {result ? 'no $defs — every shape in this schema is inlined' : 'no schema loaded'}
        </span>
      </div>
    );

  return (
    <div className="defs-pane">
      <div className="defs-bar">
        <input
          ref={inputRef}
          className="defs-filter"
          type="text"
          placeholder="filter definitions"
          value={q}
          spellCheck={false}
          onChange={(ev) => setQ(ev.target.value)}
          // Escape clears the filter first; only once it is empty does the
          // key fall through to the app's clear-the-selection binding
          onKeyDown={(ev) => {
            if (ev.key !== 'Escape') return;
            if (q) {
              setQ('');
              ev.stopPropagation();
            } else inputRef.current?.blur();
          }}
        />
        <span className="count">
          {needle ? `showing ${shown.length} of ${defs.length}` : `${defs.length} defs`}
        </span>
      </div>
      {shown.length === 0 ? (
        <span className="panel-empty">no def matches “{q.trim()}”</span>
      ) : (
        <div className="defs-list">
          {shown.map((d) => (
            <button
              className={`def-row${selectedId === DEF_PREFIX + d.name ? ' active' : ''}`}
              key={d.name}
              onClick={() => select(DEF_PREFIX + d.name)}
              title={d.description ?? `$defs/${d.name}`}
            >
              <span className="def-name">{d.name}</span>
              {d.chip && <span className="chip chip-ref">{d.chip}</span>}
              <span className={`def-badge def-${DEF_BADGE[d.kind]}`} title={d.kind}>
                {DEF_BADGE[d.kind]}
              </span>
              <span
                className={`def-uses${useCount(d) === 0 && d.kind !== 'entity' ? ' is-dead' : ''}`}
                title="places on the canvas that use this def"
              >
                {useCount(d)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const DEFAULT_EXPANDED = () => new Set([ptrKey([]), ptrKey(['properties']), ptrKey(['$defs'])]);

export function JsonPanel({ result }: { result?: WalkResult }) {
  const schemaDoc = useExplodedStore((s) => s.schemaDoc);
  const selectedId = useExplodedStore((s) => s.selectedId);
  const select = useExplodedStore((s) => s.select);
  const open = useExplodedStore((s) => s.leftOpen);
  const toggleLeft = useExplodedStore((s) => s.toggleLeft);

  const [mode, setMode] = useState<'tree' | 'raw' | 'defs'>(() => readSession().jsonMode);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(DEFAULT_EXPANDED);
  const nodeEls = useRef(new Map<string, HTMLDivElement>());
  const rawRef = useRef<HTMLDivElement>(null);

  const chooseMode = useCallback((next: 'tree' | 'raw' | 'defs') => {
    setMode(next);
    patchSession({ jsonMode: next });
  }, []);

  // fresh schema -> fresh fold state
  useEffect(() => {
    setExpanded(DEFAULT_EXPANDED());
  }, [schemaDoc]);

  /**
   * Ids that exist in the walk — clicks resolve to the nearest existing id.
   * Every `$defs` member counts, not just the ones that became cards: a
   * scalar def or an elided wrapper is still a subject the panel can show,
   * and before this a click on one resolved to nothing at all.
   */
  const knownIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of result?.entities ?? []) {
      ids.add(e.id);
      for (const r of e.rows) ids.add(r.id);
    }
    for (const d of result?.defs ?? []) ids.add(DEF_PREFIX + d.name);
    return ids;
  }, [result]);

  const defByName = useMemo(
    () => new Map((result?.defs ?? []).map((d) => [d.name, d])),
    [result],
  );

  const highlightKey = useMemo(() => {
    if (!schemaDoc || !selectedId) return undefined;
    const ptr = idToPointer(schemaDoc, selectedId);
    return ptr && ptrKey(ptr);
  }, [schemaDoc, selectedId]);

  const pretty = useMemo(
    () => (open && mode === 'raw' && schemaDoc ? prettyWithRanges(schemaDoc) : undefined),
    [open, mode, schemaDoc],
  );

  /** walk up until the pointer maps to an id the walker produced, then select it */
  const selectPtr = useCallback(
    (ptr: Ptr) => {
      // a $ref is a pointer at something: follow it, rather than walking up to
      // the property that holds it (which the row above already selects)
      if (ptr[ptr.length - 1] === '$ref') {
        let v: unknown = schemaDoc;
        for (const seg of ptr) v = (v as Record<string, unknown> | undefined)?.[seg];
        if (typeof v === 'string' && v.startsWith('#/$defs/')) {
          const id = DEF_PREFIX + v.slice('#/$defs/'.length);
          if (knownIds.has(id)) {
            select(id);
            return;
          }
        }
      }
      for (let p = ptr; ; p = p.slice(0, -1)) {
        const id = pointerToId(p);
        if (id !== undefined && knownIds.has(id)) {
          select(id);
          return;
        }
        // nothing above this click maps to the graph: clear, rather than
        // leaving the previous subject up as if it had answered
        if (p.length === 0) {
          select(undefined);
          return;
        }
      }
    },
    [knownIds, schemaDoc, select],
  );

  const hlRange = pretty && highlightKey ? pretty.ranges.get(highlightKey) : undefined;
  const hlFrom = hlRange?.[0];

  // bring the selection into view: unfold tree ancestors, or scroll the raw view
  useEffect(() => {
    if (!highlightKey || !open) return;
    if (mode === 'tree') {
      const ptr = JSON.parse(highlightKey) as Ptr;
      setExpanded((prev) => {
        const next = new Set(prev);
        for (let i = 0; i < ptr.length; i++) next.add(ptrKey(ptr.slice(0, i)));
        return next;
      });
      const t = setTimeout(
        () => nodeEls.current.get(highlightKey)?.scrollIntoView({ block: 'nearest' }),
        0,
      );
      return () => clearTimeout(t);
    }
    // a highlight can span a whole section (taller than the panel), so align its
    // first line near the top instead of scrollIntoView-centering the block
    const t = setTimeout(() => {
      const box = rawRef.current;
      const first = box?.querySelector(`[data-ln="${hlFrom}"]`);
      if (!box || !first) return;
      box.scrollTop += first.getBoundingClientRect().top - box.getBoundingClientRect().top - 60;
    }, 0);
    return () => clearTimeout(t);
  }, [highlightKey, open, mode, hlFrom]);

  const onRawClick = useCallback(
    (ev: React.MouseEvent<HTMLDivElement>) => {
      const row = (ev.target as HTMLElement).closest<HTMLElement>('.jr-line');
      const ptr = row && pretty?.lineOwner[Number(row.dataset.ln)];
      if (ptr) selectPtr(ptr);
    },
    [pretty, selectPtr],
  );

  const ctx = useMemo<TreeCtx>(
    () => ({
      expanded,
      highlightKey,
      toggle: (key) =>
        setExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        }),
      register: (key) => (el) => {
        if (el) nodeEls.current.set(key, el);
        else nodeEls.current.delete(key);
      },
      onSelect: selectPtr,
      defBadge: (name) => {
        const d = defByName.get(name);
        return d && d.kind !== 'entity' ? DEF_BADGE[d.kind] : undefined;
      },
    }),
    [expanded, highlightKey, selectPtr, defByName],
  );

  if (!open)
    return (
      <aside className="side-panel side-left collapsed">
        <button className="panel-tab" onClick={toggleLeft} title="show schema JSON">
          {'{ } JSON'}
        </button>
      </aside>
    );

  return (
    <aside className="side-panel side-left">
      <div className="panel-bar ruled-bottom">
        <span className="panel-title">Schema JSON</span>
        <div className="mode-toggle">
          <button className={mode === 'tree' ? 'active' : ''} onClick={() => chooseMode('tree')}>
            Tree
          </button>
          <button className={mode === 'raw' ? 'active' : ''} onClick={() => chooseMode('raw')}>
            Raw
          </button>
          <button className={mode === 'defs' ? 'active' : ''} onClick={() => chooseMode('defs')}>
            Defs
          </button>
        </div>
        {mode === 'raw' && schemaDoc && (
          <button
            className="icon-btn"
            title="copy JSON"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(pretty?.text ?? '');
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              } catch {
                /* clipboard unavailable */
              }
            }}
          >
            {copied ? '✓' : '⧉'}
          </button>
        )}
        <button className="icon-btn" onClick={toggleLeft} title="hide panel">
          «
        </button>
      </div>
      {mode === 'defs' ? (
        <DefsList result={result} selectedId={selectedId} select={select} />
      ) : mode === 'tree' ? (
        <div className="json-tree">
          {schemaDoc ? (
            <JsonNode value={schemaDoc} ptr={[]} depth={0} ctx={ctx} />
          ) : (
            <span className="panel-empty">no schema loaded</span>
          )}
        </div>
      ) : (
        <div className="json-raw" ref={rawRef} onClick={onRawClick}>
          {pretty ? (
            pretty.lines.map((line, i) => (
              <RawLine
                key={i}
                n={i}
                line={line}
                selected={hlRange !== undefined && i >= hlRange[0] && i <= hlRange[1]}
              />
            ))
          ) : (
            <span className="panel-empty">no schema loaded</span>
          )}
        </div>
      )}
    </aside>
  );
}
