'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  type Edge,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { Methodology, Phase } from '../lib/types';
import { PhaseNode, type PhaseNodeType } from './PhaseNode';
import { PhaseDetail } from './PhaseDetail';

const NODE_WIDTH = 220;
const H_GAP = 60;

interface Props {
  methodology: Methodology;
}

const nodeTypes = { phase: PhaseNode };

export function MethodologyGraph({ methodology }: Props) {
  const [selectedPhase, setSelectedPhase] = useState<Phase | null>(null);

  const initialNodes: PhaseNodeType[] = useMemo(
    () =>
      methodology.phases.map((phase, i) => ({
        id: String(phase.id),
        type: 'phase' as const,
        position: { x: i * (NODE_WIDTH + H_GAP), y: 0 },
        data: { phase, onClick: setSelectedPhase },
        style: { width: NODE_WIDTH },
      })),
    [methodology],
  );

  const initialEdges: Edge[] = useMemo(
    () =>
      methodology.phases.slice(0, -1).map((phase) => ({
        id: `e${phase.id}-${phase.id + 1}`,
        source: String(phase.id),
        target: String(phase.id + 1),
        animated: true,
        style: { stroke: 'rgba(129,140,248,0.5)', strokeWidth: 2 },
      })),
    [methodology],
  );

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  return (
    <div className="methodology-graph-wrapper">
      <div className="reactflow-container">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          colorMode="dark"
          fitView
          fitViewOptions={{ padding: 0.3 }}
        >
          <Background variant={BackgroundVariant.Dots} color="#1e1b4b" gap={24} size={1} />
          <Controls />
        </ReactFlow>
      </div>
      <PhaseDetail phase={selectedPhase} onClose={() => setSelectedPhase(null)} />
    </div>
  );
}
