import ELK from 'elkjs/lib/elk.bundled.js';
import type { WalkResult } from './walker';

const elk = new ELK();

export const NODE_WIDTH = 280;

const HEADER_H = 34;
const ROW_H = 22;
const PAD = 10;

export function nodeHeight(rowCount: number): number {
  return HEADER_H + rowCount * ROW_H + PAD;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Positions via ELK layered layout, left to right, for the visible subgraph.
 * Saved/manually-moved positions always win — callers merge them on top.
 * `visibleRows` is the depth-gated row count per entity; without it every row
 * counts, which is what an ungated card draws anyway.
 */
export async function layoutPositions(
  result: Pick<WalkResult, 'entities' | 'edges'>,
  visibleRows?: ReadonlyMap<string, number>,
): Promise<Map<string, Point>> {
  const graph = {
    id: 'elk-root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      'elk.spacing.nodeNode': '28',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: result.entities.map((e) =>
      ({
        id: e.id,
        width: NODE_WIDTH,
        // the "extends" line renders like a row
        height: nodeHeight(
          visibleRows?.get(e.id) ?? e.rows.length + (e.inherits?.length ? 1 : 0),
        ),
      }),
    ),
    edges: result.edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
  const laid = await elk.layout(graph);
  return new Map((laid.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
}
