// Optional footer panel: validates the loaded schema file. Basic checks (JSON
// syntax, schema structure) plus per-provider LLM structured-output profiles.
// Collapsed by default — but the 32px strip carries the whole verdict, one
// entry per profile, so opening the panel is for finding *where*, not
// *whether*. Clicking a finding selects the nearest entity/row on the canvas.

import { Fragment, useEffect, useMemo, useState } from 'react';
import type { WalkResult } from './walker';
import { useExplodedStore } from './store';
import { pointerToId, type Ptr } from './jsonPointer';
import type { GroupResult, Scope, Severity } from './validation';
import { Popover } from './Popover';

const SEV_GLYPH: Record<Severity, string> = { error: '✕', warn: '⚠', info: 'ℹ' };
const MAX_SHOWN = 30;
const SCOPE_LABEL: Record<Scope, string> = {
  document: 'whole schema',
  sections: 'per extraction section',
  selection: 'selected section',
};

/**
 * What the control reads as when closed. 'selection' names the section it
 * resolved to: the collapsed strip is the whole verdict, and a verdict that
 * covers one section of twenty has to say which one.
 */
function scopeButtonLabel(scope: Scope, section: string | undefined): string {
  if (scope !== 'selection') return SCOPE_LABEL[scope];
  return section === undefined ? 'selected section — none' : `selected: ${section}`;
}

function fmtPtr(ptr: Ptr): string {
  return ptr.length ? ptr.map(String).join(' / ') : '(root)';
}

function countsOf(group: GroupResult): Record<Severity, number> {
  const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const r of group.rules) counts[r.meta.severity] += r.findings.length;
  return counts;
}

/** a group's verdict, as it reads in both the strip and the open panel */
function Verdict({ group }: { group: GroupResult }) {
  if (group.skipped) return <span className="v-skip">{group.skipped}</span>;
  if (group.rules.length === 0) return <span className="v-pass">✓ pass</span>;
  const counts = countsOf(group);
  return (
    <span className="v-counts">
      {counts.error > 0 && <span className="v-badge v-error">{counts.error}</span>}
      {counts.warn > 0 && <span className="v-badge v-warn">{counts.warn}</span>}
      {counts.info > 0 && <span className="v-badge v-info">{counts.info}</span>}
    </span>
  );
}

function ScopePicker({
  scope,
  sectionsAvailable,
  selectedSection,
  side,
}: {
  scope: Scope;
  sectionsAvailable: boolean;
  selectedSection: string | undefined;
  side: 'up' | 'down';
}) {
  const setVScope = useExplodedStore((s) => s.setVScope);
  return (
    <label className="v-scope">
      scope
      <Popover
        className="ctl"
        side={side}
        align="right"
        title="what counts as a schema root"
        label={
          <>
            <span className="v-scope-name">{scopeButtonLabel(scope, selectedSection)}</span>
            <span className="caret">▾</span>
          </>
        }
      >
        {(close) => (
          <div className="pop-list">
            {(['document', 'sections', 'selection'] as Scope[]).map((s) => (
              <button
                key={s}
                className={`pop-item${s === scope ? ' active' : ''}`}
                disabled={s === 'sections' && !sectionsAvailable}
                // 'selection' stays pickable with nothing selected: choosing it
                // first and then clicking a card is the way you would use it
                title={s === 'selection' ? 'the section the canvas selection sits in' : undefined}
                onClick={() => {
                  setVScope(s);
                  close();
                }}
              >
                <span className="pop-tick">{s === scope ? '✓' : ''}</span>
                {SCOPE_LABEL[s]}
              </button>
            ))}
          </div>
        )}
      </Popover>
    </label>
  );
}

function GroupBlock({
  group,
  expanded,
  toggleRule,
  onJump,
}: {
  group: GroupResult;
  expanded: ReadonlySet<string>;
  toggleRule: (id: string) => void;
  onJump: (ptr: Ptr) => void;
}) {
  return (
    <section className="v-group">
      <header className="v-group-head" title={group.note}>
        <span className="v-group-label">{group.label}</span>
        <Verdict group={group} />
      </header>
      {group.rules.map(({ meta, findings }) => {
        const open = expanded.has(meta.id);
        return (
          <div key={meta.id} className="v-rule">
            <button className="v-rule-head" onClick={() => toggleRule(meta.id)}>
              <span className={`v-sev v-${meta.severity}`}>{SEV_GLYPH[meta.severity]}</span>
              <span className="v-rule-title">{meta.title}</span>
              <span className="v-count">{findings.length}</span>
              <span className="v-caret">{open ? '▾' : '▸'}</span>
            </button>
            {open && (
              <div className="v-findings">
                {meta.hint && <div className="v-hint">{meta.hint}</div>}
                {findings.slice(0, MAX_SHOWN).map((f, i) => (
                  <button
                    key={i}
                    className="v-finding"
                    title={fmtPtr(f.path)}
                    onClick={() => onJump(f.path)}
                  >
                    <span className="v-path">{fmtPtr(f.path)}</span>
                    {f.note && <span className="v-note">{f.note}</span>}
                  </button>
                ))}
                {findings.length > MAX_SHOWN && (
                  <div className="v-more">… and {findings.length - MAX_SHOWN} more</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

export function ValidationPanel({
  result,
  groups,
  scope,
  sectionsAvailable,
  selectedSection,
}: {
  result?: WalkResult;
  groups: GroupResult[];
  scope: Scope;
  sectionsAvailable: boolean;
  selectedSection: string | undefined;
}) {
  const schemaDoc = useExplodedStore((s) => s.schemaDoc);
  const open = useExplodedStore((s) => s.bottomOpen);
  const toggleBottom = useExplodedStore((s) => s.toggleBottom);
  const select = useExplodedStore((s) => s.select);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    setExpanded(new Set());
  }, [schemaDoc]);

  const knownIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of result?.entities ?? []) {
      ids.add(e.id);
      for (const r of e.rows) ids.add(r.id);
    }
    return ids;
  }, [result]);

  const onJump = (ptr: Ptr) => {
    // walk up until the pointer maps to an id the walker produced
    for (let p = ptr; ; p = p.slice(0, -1)) {
      const id = pointerToId(p);
      if (id !== undefined && knownIds.has(id)) {
        select(id);
        return;
      }
      if (p.length === 0) return;
    }
  };

  if (!open)
    return (
      <footer className="footer-panel collapsed ruled-top">
        <button className="ctl" onClick={toggleBottom} title="show validation">
          <span className="caret">▴</span>
          <span className="label">Validation</span>
        </button>
        <div className="footer-strip">
          {groups.map((g, i) => (
            <Fragment key={g.id}>
              {i > 0 && <span className="v-divider" />}
              <span className="v-verdict">
                <span className="v-verdict-label">{g.label}</span>
                <Verdict group={g} />
              </span>
            </Fragment>
          ))}
        </div>
        <span className="spacer" />
        <ScopePicker
          scope={scope}
          sectionsAvailable={sectionsAvailable}
          selectedSection={selectedSection}
          side="up"
        />
      </footer>
    );

  return (
    <footer className="footer-panel ruled-top">
      <div className="panel-bar ruled-bottom">
        <span className="panel-title">Validation</span>
        <ScopePicker
          scope={scope}
          sectionsAvailable={sectionsAvailable}
          selectedSection={selectedSection}
          side="down"
        />
        <button className="icon-btn" onClick={toggleBottom} title="hide panel">
          ⌄
        </button>
      </div>
      <div className="v-body">
        {groups.map((g) => (
          <GroupBlock
            key={g.id}
            group={g}
            expanded={expanded}
            toggleRule={(id) =>
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onJump={onJump}
          />
        ))}
      </div>
    </footer>
  );
}
