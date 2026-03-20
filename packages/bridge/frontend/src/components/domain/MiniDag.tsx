/**
 * PRD 019.3: Mini-DAG thumbnail for strategy cards.
 *
 * CSS-only rendering using inline SVG. No xyflow dependency.
 * Nodes are small circles (color by type), edges are lines,
 * gates are rotated squares. Layout uses a simple topological level approach.
 */

import type { StrategyNodeDef, StrategyGateDef } from '@/lib/types';

interface MiniDagProps {
  nodes: StrategyNodeDef[];
  gates: StrategyGateDef[];
  lastStatus?: string | null;
  className?: string;
}

interface LayoutNode {
  id: string;
  type: 'methodology' | 'script' | 'gate';
  x: number;
  y: number;
}

function computeLayout(
  nodes: StrategyNodeDef[],
  gates: StrategyGateDef[],
): { layoutNodes: LayoutNode[]; edges: Array<[string, string]> } {
  // Build adjacency and compute topological levels
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  const allIds = new Set<string>();

  for (const n of nodes) {
    allIds.add(n.id);
    if (!inDegree.has(n.id)) inDegree.set(n.id, 0);
    if (!dependents.has(n.id)) dependents.set(n.id, []);
  }
  for (const g of gates) {
    allIds.add(g.id);
    if (!inDegree.has(g.id)) inDegree.set(g.id, 0);
    if (!dependents.has(g.id)) dependents.set(g.id, []);
  }

  const edges: Array<[string, string]> = [];

  for (const n of nodes) {
    for (const dep of n.depends_on) {
      if (allIds.has(dep)) {
        edges.push([dep, n.id]);
        inDegree.set(n.id, (inDegree.get(n.id) ?? 0) + 1);
        const deps = dependents.get(dep);
        if (deps) deps.push(n.id);
      }
    }
  }
  for (const g of gates) {
    for (const dep of g.depends_on) {
      if (allIds.has(dep)) {
        edges.push([dep, g.id]);
        inDegree.set(g.id, (inDegree.get(g.id) ?? 0) + 1);
        const deps = dependents.get(dep);
        if (deps) deps.push(g.id);
      }
    }
  }

  // Kahn's algorithm for levels
  const levels: string[][] = [];
  let queue: string[] = [];

  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  while (queue.length > 0) {
    levels.push([...queue]);
    const next: string[] = [];
    for (const id of queue) {
      for (const dep of dependents.get(id) ?? []) {
        const newDeg = (inDegree.get(dep) ?? 1) - 1;
        inDegree.set(dep, newDeg);
        if (newDeg === 0) next.push(dep);
      }
    }
    queue = next;
  }

  // Build node type lookup
  const nodeTypeMap = new Map<string, 'methodology' | 'script' | 'gate'>();
  for (const n of nodes) nodeTypeMap.set(n.id, n.type);
  for (const g of gates) nodeTypeMap.set(g.id, 'gate');

  // Position nodes: horizontal levels, vertically centered per level
  const levelCount = levels.length || 1;
  const padding = 14;
  const hSpacing = 28;
  const vSpacing = 20;

  const layoutNodes: LayoutNode[] = [];
  for (let li = 0; li < levels.length; li++) {
    const level = levels[li];
    const x = padding + li * hSpacing;
    const totalHeight = (level.length - 1) * vSpacing;
    const startY = (60 - totalHeight) / 2;

    for (let ni = 0; ni < level.length; ni++) {
      const id = level[ni];
      layoutNodes.push({
        id,
        type: nodeTypeMap.get(id) ?? 'script',
        x,
        y: Math.max(padding, startY + ni * vSpacing),
      });
    }
  }

  const width = padding * 2 + Math.max(0, levelCount - 1) * hSpacing;

  // Clamp to reasonable bounds
  for (const ln of layoutNodes) {
    ln.x = Math.min(ln.x, width - padding);
  }

  return { layoutNodes, edges };
}

// Node color by type
function nodeColor(type: 'methodology' | 'script' | 'gate'): string {
  switch (type) {
    case 'methodology': return 'var(--nebular)';
    case 'script': return 'var(--bio)';
    case 'gate': return 'var(--cyan)';
  }
}

// Status border color
function statusBorderColor(status?: string | null): string {
  switch (status) {
    case 'running': return 'var(--bio)';
    case 'completed': return 'var(--cyan)';
    case 'failed': return 'var(--error)';
    default: return 'var(--border)';
  }
}

export function MiniDag({ nodes, gates, lastStatus, className }: MiniDagProps) {
  const { layoutNodes, edges } = computeLayout(nodes, gates);

  // Build a position lookup
  const posMap = new Map<string, { x: number; y: number }>();
  for (const ln of layoutNodes) {
    posMap.set(ln.id, { x: ln.x, y: ln.y });
  }

  const levelCount = Math.max(1, new Set(layoutNodes.map((n) => n.x)).size);
  const svgWidth = Math.max(60, 28 + levelCount * 28);
  const svgHeight = 60;

  return (
    <svg
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      width={svgWidth}
      height={svgHeight}
      className={className}
      aria-hidden="true"
      style={{
        border: `1px solid ${statusBorderColor(lastStatus)}`,
        borderRadius: '8px',
        background: 'rgba(13, 31, 45, 0.5)',
      }}
    >
      {/* Edges */}
      {edges.map(([from, to], i) => {
        const fromPos = posMap.get(from);
        const toPos = posMap.get(to);
        if (!fromPos || !toPos) return null;
        return (
          <line
            key={`e-${i}`}
            x1={fromPos.x}
            y1={fromPos.y}
            x2={toPos.x}
            y2={toPos.y}
            stroke="var(--border-hover)"
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        );
      })}

      {/* Nodes */}
      {layoutNodes.map((ln) => {
        if (ln.type === 'gate') {
          // Gate: rotated square (diamond)
          return (
            <rect
              key={ln.id}
              x={ln.x - 4}
              y={ln.y - 4}
              width={8}
              height={8}
              rx={1}
              fill={nodeColor(ln.type)}
              transform={`rotate(45 ${ln.x} ${ln.y})`}
            />
          );
        }
        return (
          <circle
            key={ln.id}
            cx={ln.x}
            cy={ln.y}
            r={5}
            fill={nodeColor(ln.type)}
          />
        );
      })}
    </svg>
  );
}
