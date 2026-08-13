import { useMemo, useState } from 'react';
import type { WalkResult } from './walker';
import { useExplodedStore, type DepthSettings } from './store';
import { THEME_ORDER, type Theme } from './theme';
import { Popover } from './Popover';
import { chipTone } from './chipTone';
import { hostOf, URL_MAP, type SchemaSource } from './sources';

const THEME_GLYPH: Record<Theme, string> = { system: '◐', light: '☀', dark: '☾' };

/** how many cards are drawn, and how many are showing a residue chip */
export interface DepthStats {
  drawn: number;
  folded: number;
}

function ThemeButton() {
  const theme = useExplodedStore((s) => s.theme);
  const resolved = useExplodedStore((s) => s.resolvedTheme);
  const setTheme = useExplodedStore((s) => s.setTheme);
  const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
  return (
    <button
      className="ctl ctl-sq"
      onClick={() => setTheme(next)}
      title={`theme: ${theme}${theme === 'system' ? ` (${resolved})` : ''} — click for ${next}`}
      aria-label={`theme: ${theme}, switch to ${next}`}
    >
      {THEME_GLYPH[theme]}
    </button>
  );
}

/**
 * The three depth axes. Three permanent <select>s spent ~230px of the most
 * valuable strip in the app without ever saying what they did — the whole
 * explanation lived in their tooltips. One readout opens this instead, where
 * each axis gets a name, a caption and its full range on screen.
 */
const AXES: { key: keyof DepthSettings; glyph: string; name: string; caption: string }[] = [
  { key: 'scalar', glyph: 'a', name: 'scalars', caption: 'levels that list value props' },
  { key: 'object', glyph: '{ }', name: 'objects', caption: 'levels that list object props' },
  { key: 'edges', glyph: '→', name: 'edges', caption: 'hops of cards drawn at all' },
];
const STEPS = [0, 1, 2, 3, Infinity];

const stepLabel = (n: number) => (Number.isFinite(n) ? String(n) : '∞');

function DepthControl({ anchorLabel, stats }: { anchorLabel?: string; stats: DepthStats }) {
  const depth = useExplodedStore((s) => s.depth);
  const setDepth = useExplodedStore((s) => s.setDepth);
  return (
    <Popover
      className="ctl ctl-filled ctl-depth"
      panelClass="pop-depth"
      align="right"
      title="how much of the graph is drawn, counted downstream from the anchor"
      label={
        <>
          <span className="label">detail</span>
          <span className="depth-readout">
            {AXES.map((a, i) => (
              <span key={a.key} className="depth-readout-axis">
                {i > 0 && <span className="dot-sep"> · </span>}
                <span className="axis-glyph">{a.glyph} </span>
                {stepLabel(depth[a.key])}
              </span>
            ))}
          </span>
          <span className="caret">▾</span>
        </>
      }
    >
      {() => (
        <>
          <div className="pop-head">
            <span className="label">detail from anchor</span>
            <span className="spacer" />
            <span className="pop-head-value">{anchorLabel ?? 'schema root'}</span>
          </div>
          {AXES.map((a) => (
            <div className="depth-axis" key={a.key}>
              <div>
                <span className="depth-axis-name">
                  <span className="axis-glyph">{a.glyph}</span>
                  {a.name}
                </span>
                <span className="depth-axis-caption">{a.caption}</span>
              </div>
              <div className="seg" role="group" aria-label={`${a.name} depth`}>
                {STEPS.map((n) => (
                  <button
                    key={stepLabel(n)}
                    className={depth[a.key] === n ? 'on' : ''}
                    aria-pressed={depth[a.key] === n}
                    onClick={() => setDepth({ [a.key]: n })}
                  >
                    {stepLabel(n)}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="pop-rule" />
          <p className="pop-note">
            Depth is counted downstream from the anchor. <strong>{stats.drawn} cards</strong> drawn,{' '}
            <strong>{stats.folded}</strong> folded to a residue chip.
          </p>
        </>
      )}
    </Popover>
  );
}

interface Crumb {
  id: string;
  label: string;
  /** type chip, filled in for the terminal (anchor) segment only */
  chip?: string;
  tone?: string;
}

// Containment path of the current selection: entity -> its ancestor chain;
// row -> owning entity's chain + the row; edge -> source chain + the label.
// Def cards have no containment parent, so their chain starts at the card.
function crumbsFor(result: WalkResult | undefined, selectedId: string | undefined): Crumb[] {
  if (!result || !selectedId) return [];
  const byId = new Map(result.entities.map((e) => [e.id, e]));
  const parent = new Map<string, string>();
  for (const e of result.edges) if (e.kind === 'containment') parent.set(e.target, e.source);

  const chainOf = (entityId: string): Crumb[] => {
    const chain: Crumb[] = [];
    let cur: string | undefined = entityId;
    while (cur !== undefined) {
      chain.unshift({ id: cur, label: byId.get(cur)?.label ?? cur });
      cur = parent.get(cur);
    }
    return chain;
  };
  const entityChip = (id: string) => {
    const e = byId.get(id);
    if (!e) return undefined;
    return e.kind === 'root' ? 'root' : e.kind === 'array' ? 'array' : e.defName ? 'def' : 'object';
  };

  if (byId.has(selectedId)) {
    const chain = chainOf(selectedId);
    chain[chain.length - 1].chip = entityChip(selectedId);
    return chain;
  }
  for (const entity of result.entities) {
    const row = entity.rows.find((r) => r.id === selectedId);
    if (row)
      return [
        ...chainOf(entity.id),
        {
          id: row.id,
          label: row.name,
          chip: `${row.chip}${row.nullable ? '?' : ''}`,
          tone: chipTone(row.chip, !!row.link),
        },
      ];
  }
  const edge = result.edges.find((e) => e.id === selectedId);
  if (edge)
    return [
      ...chainOf(edge.source),
      { id: edge.id, label: edge.label, chip: 'ref', tone: 'chip-link' },
    ];
  return [];
}

/**
 * The schema picker's contents, in three groups: files in `schemas/`, the URLs
 * listed in `remote-schema-urls.json`, and the ones typed into the box at the
 * bottom (or arrived on `?remote=`). A URL-backed entry names the host it
 * reads from, because "mnx" alone does not tell you that opening it goes to
 * the network and gets whatever upstream says today.
 */
function SchemaList({
  sources,
  warnings,
  schemaName,
  onPick,
  onOpenUrl,
}: {
  sources: SchemaSource[];
  warnings: string[];
  schemaName: string;
  onPick: (name: string) => void;
  onOpenUrl: (url: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const local = sources.filter((s) => s.url === undefined);
  const listed = sources.filter((s) => s.url !== undefined && !s.adhoc);
  const adhoc = sources.filter((s) => s.adhoc);
  const group = (label: string, hint?: string, title?: string) => (
    <span className="pop-group label" title={title}>
      {label} {hint && <span className="label-quiet">· {hint}</span>}
    </span>
  );
  const item = (s: SchemaSource) => (
    <button
      key={s.name}
      className={`pop-item${s.name === schemaName ? ' active' : ''}`}
      onClick={() => onPick(s.name)}
      title={s.url}
    >
      <span className="pop-tick">{s.name === schemaName ? '✓' : ''}</span>
      <span className="pop-item-text">
        {s.name}
        {s.url && <span className="pop-item-sub">{hostOf(s.url)}</span>}
      </span>
    </button>
  );
  return (
    <div className="pop-list">
      {local.length > 0 && sources.length > local.length && group('local')}
      {local.map(item)}
      {listed.length > 0 && group('remote', 'fetched live', `listed in ${URL_MAP}`)}
      {listed.map(item)}
      {adhoc.length > 0 && group('from url', 'this browser')}
      {adhoc.map(item)}
      {sources.length === 0 && <span className="pop-empty">no schema found</span>}
      {warnings.map((w) => (
        <span className="pop-warn" key={w}>
          ⚠ {w}
        </span>
      ))}
      <form
        className="pop-url"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!draft.trim()) return;
          onOpenUrl(draft);
          setDraft('');
        }}
      >
        <input
          className="pop-url-input"
          value={draft}
          onChange={(ev) => setDraft(ev.target.value)}
          placeholder="https://…/schema.json"
          aria-label="open a schema by URL"
          spellCheck={false}
        />
        <button className="pop-url-go" type="submit" disabled={!draft.trim()}>
          open
        </button>
      </form>
      <span className="pop-hint">
        Any URL the host lets this page read (CORS). A GitHub blob link is
        rewritten to its raw file.
      </span>
    </div>
  );
}

export function Header({
  sources,
  sourceWarnings,
  schemaName,
  onSchemaChange,
  onOpenUrl,
  driftWarnings,
  error,
  result,
  depthStats,
  totals,
}: {
  sources: SchemaSource[];
  sourceWarnings: string[];
  schemaName: string;
  onSchemaChange: (name: string) => void;
  onOpenUrl: (url: string) => void;
  driftWarnings: string[];
  error?: string;
  result?: WalkResult;
  depthStats: DepthStats;
  totals: { error: number; warn: number };
}) {
  const selectedId = useExplodedStore((s) => s.selectedId);
  const select = useExplodedStore((s) => s.select);
  const focus = useExplodedStore((s) => s.focus);
  const toggleFocus = useExplodedStore((s) => s.toggleFocus);
  const toggleBottom = useExplodedStore((s) => s.toggleBottom);
  const crumbs = useMemo(() => crumbsFor(result, selectedId), [result, selectedId]);
  const loaded = sources.find((s) => s.name === schemaName);
  const [copied, setCopied] = useState(false);
  const anchor = crumbs[crumbs.length - 1];

  return (
    <header className="app-header ruled-bottom">
      <div className="hz">
        <span className="brand-glyph">⬡</span>
        <span className="brand-name">json-schema-exploded</span>
      </div>

      <div className="rule-v" />

      <Popover
        className="ctl ctl-schema"
        title={loaded?.url ? `loaded schema — fetched from ${loaded.url}` : 'loaded schema'}
        label={
          <>
            <span className="ctl-glyph">{'{ }'}</span>
            <span className="ctl-name">{schemaName}</span>
            {loaded?.url && <span className="ctl-remote">⇗</span>}
            <span className="caret">▾</span>
          </>
        }
      >
        {(close) => (
          <SchemaList
            sources={sources}
            warnings={sourceWarnings}
            schemaName={schemaName}
            onPick={(name) => {
              onSchemaChange(name);
              close();
            }}
            onOpenUrl={(url) => {
              onOpenUrl(url);
              close();
            }}
          />
        )}
      </Popover>

      <div className="rule-v" />

      <div className="hz hz-anchor">
        <span className="label">anchor</span>
        {crumbs.length === 0 ? (
          <span className="crumb-hint">
            {focus ? 'select an entity to focus' : 'nothing selected — depth is graded from the root'}
          </span>
        ) : (
          <>
            <nav className="crumbs">
              {crumbs.map((c, i) =>
                i === crumbs.length - 1 ? (
                  <span className="crumb-anchor" key={c.id} title={c.id}>
                    <span className="anchor-glyph">⌖</span>
                    <span className="anchor-name">{c.label}</span>
                    {c.chip && <span className={`chip ${c.tone ?? ''}`}>{c.chip}</span>}
                  </span>
                ) : (
                  <span className="crumb-item" key={c.id}>
                    <button className="crumb" onClick={() => select(c.id)}>
                      {c.label}
                    </button>
                    <span className="crumb-sep">/</span>
                  </span>
                ),
              )}
            </nav>
            <button
              className="icon-btn"
              title="copy schema path"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(anchor.id);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                } catch {
                  /* clipboard unavailable */
                }
              }}
            >
              {copied ? '✓' : '⧉'}
            </button>
          </>
        )}
      </div>

      <div className="hz">
        {driftWarnings.length > 0 && (
          <span className="status-warn" title={driftWarnings.join('\n')}>
            ⚠ {driftWarnings.length} drift
          </span>
        )}
        {error && (
          <span className="status-error" title={error}>
            {error}
          </span>
        )}

        <DepthControl anchorLabel={anchor?.label} stats={depthStats} />

        <div className="rule-v" />

        <button
          className={`ctl focus-btn${focus ? ' active' : ''}`}
          onClick={toggleFocus}
          title="show only the selected schema and its direct relationships (F)"
        >
          <span>⌖</span>focus
          <span className="kbd">F</span>
        </button>

        <button
          className="ctl v-pill"
          onClick={toggleBottom}
          title={`validation: ${totals.error} errors, ${totals.warn} warnings`}
        >
          {totals.error === 0 && totals.warn === 0 ? (
            <span className="v-ok">✓ pass</span>
          ) : (
            <>
              <span className="v-err">✕ {totals.error}</span>
              <span className="dot-sep">·</span>
              <span className="v-wrn">⚠ {totals.warn}</span>
            </>
          )}
        </button>

        <div className="rule-v" />

        <ThemeButton />
      </div>
    </header>
  );
}
