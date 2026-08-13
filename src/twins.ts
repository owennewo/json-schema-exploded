// Structural twin detection and client/partner drift lint.
//
// A signature covers an entity's whole subtree — property names, type chips,
// nullability, enum values, patterns, formats, and child shapes — but ignores
// annotations (description, title). Signature-identical entities are twins.
//
// The drift lint is deliberately narrower than "any near-identical shapes":
// generic similarity thresholds false-positive on this schema's *intentional*
// variants (the six protection product shapes legitimately differ by a couple
// of fields). The convention the lint enforces is the one hand-maintained
// duplication actually relies on: any same-parent client/partner pair must be
// structurally identical, and a divergence names exactly what differs.
import type { EntityInfo, RowInfo, WalkResult } from './walker';

export interface TwinInfo {
  /** entity id -> id of the earlier entity with the identical shape (badges) */
  twinOf: Map<string, string>;
  /** client/partner drift warnings */
  warnings: string[];
}

type ChildRef = { label: string; id: string };

function rowSig(r: RowInfo): string {
  return JSON.stringify([
    r.name,
    r.chip,
    r.nullable,
    r.required,
    r.meta.enumValues ?? null,
    r.meta.pattern ?? null,
    r.meta.format ?? null,
    r.meta.uniqueItems ?? null,
  ]);
}

export function computeTwins(walk: WalkResult): TwinInfo {
  const children = new Map<string, ChildRef[]>();
  const refs = new Map<string, string[]>();
  for (const e of walk.edges) {
    if (e.kind === 'containment') {
      const arr = children.get(e.source);
      if (arr) arr.push({ label: e.label, id: e.target });
      else children.set(e.source, [{ label: e.label, id: e.target }]);
    } else {
      const arr = refs.get(e.source);
      const entry = `${e.label}->${e.target}`;
      if (arr) arr.push(entry);
      else refs.set(e.source, [entry]);
    }
  }
  const byId = new Map(walk.entities.map((e) => [e.id, e]));

  const sigMemo = new Map<string, string>();
  const signature = (id: string): string => {
    const cached = sigMemo.get(id);
    if (cached) return cached;
    const e = byId.get(id) as EntityInfo;
    const sig = JSON.stringify({
      kind: e.kind,
      nullable: e.nullable,
      inherits: e.inherits ?? null,
      rows: e.rows.map(rowSig),
      refs: [...(refs.get(id) ?? [])].sort(),
      children: (children.get(id) ?? []).map((c) => [c.label, signature(c.id)]),
    });
    sigMemo.set(id, sig);
    return sig;
  };

  // twins: first occurrence in document order wins, later ones get the badge.
  // Junction pills are view furniture, not shapes — every 2-variant choice
  // would badge every other one.
  const firstBySig = new Map<string, string>();
  const twinOf = new Map<string, string>();
  for (const e of walk.entities) {
    if (e.kind === 'junction') continue;
    const sig = signature(e.id);
    const first = firstBySig.get(sig);
    if (first !== undefined) twinOf.set(e.id, first);
    else firstBySig.set(sig, e.id);
  }

  // badge only maximal twin subtrees — a twin nested inside a twin is implied
  const parent = new Map<string, string>();
  for (const e of walk.edges) if (e.kind === 'containment') parent.set(e.target, e.source);
  for (const id of [...twinOf.keys()]) {
    let p = parent.get(id);
    while (p !== undefined) {
      if (twinOf.has(p)) {
        twinOf.delete(id);
        break;
      }
      p = parent.get(p);
    }
  }

  // drift lint
  const diffPair = (aId: string, bId: string): string[] => {
    const a = byId.get(aId) as EntityInfo;
    const b = byId.get(bId) as EntityInfo;
    const out: string[] = [];
    if (a.kind !== b.kind || a.nullable !== b.nullable) out.push(`${aId} vs ${bId}: kind/nullability differs`);
    const aRows = new Map(a.rows.map((r) => [r.name, rowSig(r)]));
    const bRows = new Map(b.rows.map((r) => [r.name, rowSig(r)]));
    for (const [name, sig] of aRows) {
      if (!bRows.has(name)) out.push(`'${name}' missing from ${bId}`);
      else if (bRows.get(name) !== sig) out.push(`'${name}' differs between ${aId} and ${bId}`);
    }
    for (const name of bRows.keys()) if (!aRows.has(name)) out.push(`'${name}' missing from ${aId}`);
    const aRefs = new Set(refs.get(aId) ?? []);
    const bRefs = new Set(refs.get(bId) ?? []);
    for (const r of aRefs) if (!bRefs.has(r)) out.push(`ref '${r.split('->')[0]}' missing from ${bId}`);
    for (const r of bRefs) if (!aRefs.has(r)) out.push(`ref '${r.split('->')[0]}' missing from ${aId}`);
    const aKids = new Map((children.get(aId) ?? []).map((c) => [c.label, c.id]));
    const bKids = new Map((children.get(bId) ?? []).map((c) => [c.label, c.id]));
    for (const [label, id] of aKids) {
      const other = bKids.get(label);
      if (other === undefined) out.push(`'${label}' missing from ${bId}`);
      else if (signature(id) !== signature(other)) out.push(...diffPair(id, other));
    }
    for (const label of bKids.keys()) if (!aKids.has(label)) out.push(`'${label}' missing from ${aId}`);
    return out;
  };

  const warnings: string[] = [];
  for (const [parentId, kids] of children) {
    const client = kids.find((k) => k.label === 'client');
    const partner = kids.find((k) => k.label === 'partner');
    if (!client || !partner) continue;
    if (signature(client.id) === signature(partner.id)) continue;
    warnings.push(`${parentId}: client/partner drift — ${diffPair(client.id, partner.id).join('; ')}`);
  }

  return { twinOf, warnings };
}
