import { useState } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { EntityInfo } from './walker';
import type { RowView } from './depth';
import { nodeHeight } from './layout';
import { useExplodedStore } from './store';
import { copySectionSchema } from './copySection';
import { chipTone } from './chipTone';

export type EntityFlowNode = Node<
  {
    entity: EntityInfo;
    twinOf?: string;
    /** which prop kinds this card draws at its depth (absent = draw all) */
    view?: RowView;
    /** how much of this card's subtree the current depth leaves undrawn */
    residue?: { ents: number; rows: number };
    /** properties referencing this def — a def card's whole point is sharing */
    uses?: number;
    /** rows of this card that use the selected definition */
    echoRows?: string[];
    /** this card itself uses the selected definition (allOf, or the entry ref) */
    echoCard?: boolean;
    /** ladder anchors in use for edges that have no row to leave from */
    sourceSlots?: number;
    targetSlots?: number;
    /** how many anchors exist — static per schema, so no edge outruns them */
    sourceMax?: number;
    targetMax?: number;
  },
  'entity'
>;

/** enough apart for an edge label to sit between two rungs */
const LADDER_PITCH = 14;
/** a short card may push its rungs this far past its own border */
const LADDER_BLEED = 20;

/**
 * Rungs down the card's border, so no two edges leave at the same height.
 * They spread to the card's height at the pitch above; a card too short for
 * that many edges bleeds a little past its border rather than stacking them.
 * Anchors past the ones in use are parked at the midpoint and carry no edge.
 */
function slotStyle(i: number, inUse: number, height: number): { top: string } {
  if (i >= inUse) return { top: '50%' };
  const pitch = Math.min(LADDER_PITCH, (height + LADDER_BLEED) / (inUse + 1));
  return { top: `${height / 2 + (i - (inUse - 1) / 2) * pitch}px` };
}

export function EntityNode({ data }: NodeProps<EntityFlowNode>) {
  const e = data.entity;
  const isSection = e.depth === 1;
  const selectedId = useExplodedStore((s) => s.selectedId);
  const select = useExplodedStore((s) => s.select);
  const [copied, setCopied] = useState(false);

  const showScalars = data.view?.scalars ?? true;
  const showLinks = data.view?.links ?? true;
  const rows = e.rows.filter((r) => (r.link ? showLinks : showScalars));
  const hiddenScalars = data.view?.hiddenScalars ?? 0;
  const hiddenLinks = data.view?.hiddenLinks ?? 0;
  // one residue chip for everything this card is standing in front of: cards
  // downstream that the edge depth stopped, and its own gated rows
  const gated = [
    data.residue?.ents ? `${data.residue.ents} ent` : '',
    hiddenScalars + (data.residue?.rows ?? 0)
      ? `${hiddenScalars + (data.residue?.rows ?? 0)} props`
      : '',
    hiddenLinks ? `${hiddenLinks} links` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const sourceSlots = data.sourceSlots ?? 0;
  const targetSlots = data.targetSlots ?? 0;
  const sourceMax = Math.max(data.sourceMax ?? 0, sourceSlots);
  const targetMax = Math.max(data.targetMax ?? 0, targetSlots);
  // same height ELK laid the card out with, so the rungs land where the edges expect
  const height = nodeHeight(rows.length + (e.inherits?.length && showLinks ? 1 : 0));

  return (
    <div
      className={`entity entity-${e.kind}${isSection ? ' entity-section' : ''}${
        e.isEntry ? ' entity-root' : ''
      }${selectedId === e.id ? ' selected' : ''}${data.echoCard ? ' entity-echo' : ''}`}
    >
      <Handle type="target" position={Position.Left} className="port" />
      {Array.from({ length: targetMax }, (_, i) => (
        <Handle
          key={`t${i}`}
          id={`t${i}`}
          type="target"
          position={Position.Left}
          className={`port port-slot${i < targetSlots ? '' : ' port-idle'}`}
          style={slotStyle(i, targetSlots, height)}
        />
      ))}
      <div className="entity-header">
        <span className="entity-kind">
          {e.kind === 'array' ? '[ ]' : e.kind === 'junction' ? '( | )' : '{ }'}
        </span>
        <span className="entity-title" title={e.id}>
          {e.label}
        </span>
        {/* rows here are branches, not properties: exactly one applies */}
        {e.junction && (
          <span
            className="chip chip-choice"
            title={
              e.junction.tagProp
                ? `${e.junction.keyword} — exactly one variant, discriminated by ${e.junction.tagProp}`
                : `${e.junction.keyword} — exactly one variant`
            }
          >
            1 of {e.rows.length}
          </span>
        )}
        {e.defName && !!data.uses && (
          <span
            className="chip chip-ref chip-uses"
            title={`referenced by ${data.uses} propert${data.uses === 1 ? 'y' : 'ies'}`}
          >
            {data.uses} use{data.uses === 1 ? '' : 's'}
          </span>
        )}
        {data.twinOf && (
          <span className="chip chip-twin" title={`same shape as ${data.twinOf}`}>
            ≡ {data.twinOf.split('.').pop()}
          </span>
        )}
        {gated && (
          <span className="chip chip-hidden" title="not drawn at this depth">
            {gated}
          </span>
        )}
        {e.nullable && <span className="chip chip-null">null ok</span>}
        {isSection && e.kind !== 'junction' && (
          <button
            className="copy-btn"
            title="copy section schema (refs inlined)"
            onClick={async (ev) => {
              ev.stopPropagation();
              const ok = await copySectionSchema(e.id);
              setCopied(ok);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? '✓' : '⧉'}
          </button>
        )}
      </div>
      {(rows.length > 0 || (e.inherits && showLinks)) && (
        <div className="entity-rows">
          {e.inherits && showLinks && (
            <div
              className="row row-extends"
              title={e.inherits.map((n) => `$defs/${n}`).join(', ')}
              onClick={(ev) => {
                ev.stopPropagation();
                select(`$defs/${e.inherits![0]}`);
              }}
            >
              ⊕ extends {e.inherits.join(', ')}
            </div>
          )}
          {rows.map((r) => (
            <div
              className={`row${r.link ? ' row-link' : ''}${
                selectedId === r.id ? ' selected-row' : ''
              }${data.echoRows?.includes(r.id) ? ' row-echo' : ''}`}
              key={r.id}
              onClick={(ev) => {
                ev.stopPropagation();
                select(r.id);
              }}
            >
              <span className="row-name">
                {r.name}
                {r.required && <span className="req">*</span>}
              </span>
              {/* dashed = the shape lives elsewhere; inline is assumed and
                  carries no mark. On a scalar-def row there is no edge, so
                  this chip is the only place the reference is visible. */}
              <span
                className={`row-chip ${chipTone(r.chip, !!r.link)}${r.ref ? ' chip-ref' : ''}`}
                title={r.ref?.length ? `$ref → $defs/${r.ref.join(', $defs/')}` : undefined}
              >
                {r.chip}
                {r.nullable ? '?' : ''}
              </span>
              {/* the relationship leaves from its own row */}
              {r.link && (
                <Handle
                  id={`row:${r.id}`}
                  type="source"
                  position={Position.Right}
                  className="port port-row"
                />
              )}
            </div>
          ))}
        </div>
      )}
      {/* A link row's anchor must exist even in the frame where the card is not
          drawing that row, or the edge asks for a handle that is one commit
          away from existing. Parked ones carry nothing. */}
      {e.rows
        .filter((r) => r.link && !rows.includes(r))
        .map((r) => (
          <Handle
            key={r.id}
            id={`row:${r.id}`}
            type="source"
            position={Position.Right}
            className="port port-idle"
            style={{ top: '50%' }}
          />
        ))}
      <Handle type="source" position={Position.Right} className="port" />
      {Array.from({ length: sourceMax }, (_, i) => (
        <Handle
          key={`s${i}`}
          id={`s${i}`}
          type="source"
          position={Position.Right}
          className={`port port-slot${i < sourceSlots ? '' : ' port-idle'}`}
          style={slotStyle(i, sourceSlots, height)}
        />
      ))}
    </div>
  );
}
