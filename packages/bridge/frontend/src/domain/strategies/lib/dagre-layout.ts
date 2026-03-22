/** Dagre-based auto-layout for the strategy DAG — ported from viz/ */

import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';
import type { VizNodeData } from './types';

const NODE_WIDTH = 260;
const NODE_HEIGHT = 120;
const GATE_NODE_WIDTH = 200;
const GATE_NODE_HEIGHT = 80;

export function layoutDag(
  nodes: Node<VizNodeData>[],
  edges: Edge[],
): Node<VizNodeData>[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'LR',
    nodesep: 60,
    ranksep: 140,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    const isGate = node.data.nodeType === 'gate';
    g.setNode(node.id, {
      width: isGate ? GATE_NODE_WIDTH : NODE_WIDTH,
      height: isGate ? GATE_NODE_HEIGHT : NODE_HEIGHT,
    });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    const isGate = node.data.nodeType === 'gate';
    const w = isGate ? GATE_NODE_WIDTH : NODE_WIDTH;
    const h = isGate ? GATE_NODE_HEIGHT : NODE_HEIGHT;
    return {
      ...node,
      position: {
        x: pos.x - w / 2,
        y: pos.y - h / 2,
      },
    };
  });
}
