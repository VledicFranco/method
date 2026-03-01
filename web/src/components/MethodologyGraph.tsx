import { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { Methodology, Phase } from '../api/types.js';
import { PhaseNode, type PhaseNodeData } from './PhaseNode.js';
import { PhaseDetail } from './PhaseDetail.js';

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;
const V_GAP = 60;

interface Props {
  methodology: Methodology;
}

const nodeTypes = { phase: PhaseNode };

export function MethodologyGraph({ methodology }: Props) {
  const [selectedPhase, setSelectedPhase] = useState<Phase | null>(null);

  const initialNodes: Node<PhaseNodeData>[] = useMemo(
    () =>
      methodology.phases.map((phase, i) => ({
        id: String(phase.id),
        type: 'phase',
        position: { x: 0, y: i * (NODE_HEIGHT + V_GAP) },
        data: { phase, onClick: setSelectedPhase },
        style: { width: NODE_WIDTH },
      })),
    [methodology]
  );

  const initialEdges: Edge[] = useMemo(
    () =>
      methodology.phases.slice(0, -1).map((phase) => ({
        id: `e${phase.id}-${phase.id + 1}`,
        source: String(phase.id),
        target: String(phase.id + 1),
        animated: false,
      })),
    [methodology]
  );

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
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
          fitView
          fitViewOptions={{ padding: 0.3 }}
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
      <PhaseDetail phase={selectedPhase} onClose={() => setSelectedPhase(null)} />
    </div>
  );
}
