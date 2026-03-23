/** Main DAG visualization — assembles xyflow with custom nodes/edges */

import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type {
  StrategyDAG,
  ExecutionStatusResponse,
  VizNodeData,
  MethodologyNodeData,
  ScriptNodeData,
  GateNodeData,
  MethodologyNodeConfig,
  ScriptNodeConfig,
  NodeStatus,
} from './lib/types';
import { layoutDag } from './lib/dagre-layout';
import { MethodologyNode } from './nodes/MethodologyNode';
import { ScriptNode } from './nodes/ScriptNode';
import { GateNode } from './nodes/GateNode';
import { AnimatedEdge } from './edges/AnimatedEdge';

const nodeTypes: NodeTypes = {
  methodology: MethodologyNode,
  script: ScriptNode,
  gate: GateNode,
};

const edgeTypes: EdgeTypes = {
  animated: AnimatedEdge,
};

function getEdgeStatus(sourceStatus: string | undefined, targetStatus: string | undefined): string {
  if (sourceStatus === 'running' || targetStatus === 'running') return 'active';
  if (sourceStatus === 'completed' && targetStatus === 'completed') return 'completed';
  if (sourceStatus === 'failed' || targetStatus === 'failed') return 'failed';
  if (sourceStatus === 'completed') return 'active';
  return 'pending';
}

function buildGraph(
  dag: StrategyDAG,
  execution?: ExecutionStatusResponse | null,
): { nodes: Node<VizNodeData>[]; edges: Edge[] } {
  const nodes: Node<VizNodeData>[] = [];
  const edges: Edge[] = [];
  const nodeStatuses = execution?.node_statuses ?? {};
  const nodeResults = execution?.node_results ?? {};

  for (const node of dag.nodes) {
    const status = (nodeStatuses[node.id] as NodeStatus) ?? 'pending';
    const result = nodeResults[node.id];

    if (node.type === 'methodology') {
      const config = node.config as MethodologyNodeConfig;
      nodes.push({
        id: node.id,
        type: 'methodology',
        position: { x: 0, y: 0 },
        data: {
          label: node.id,
          nodeType: 'methodology',
          methodology: config.methodology,
          method_hint: config.method_hint,
          capabilities: config.capabilities,
          inputs: node.inputs,
          outputs: node.outputs,
          gates: node.gates,
          status,
          cost_usd: result?.cost_usd,
          duration_ms: result?.duration_ms,
          retries: result?.retries,
          error: result?.error,
        } as unknown as VizNodeData,
      });
    } else {
      const config = node.config as ScriptNodeConfig;
      nodes.push({
        id: node.id,
        type: 'script',
        position: { x: 0, y: 0 },
        data: {
          label: node.id,
          nodeType: 'script',
          script: config.script,
          inputs: node.inputs,
          outputs: node.outputs,
          status,
          duration_ms: result?.duration_ms,
          error: result?.error,
        } as unknown as VizNodeData,
      });
    }

    for (const dep of node.depends_on) {
      edges.push({
        id: `${dep}->${node.id}`,
        source: dep,
        target: node.id,
        type: 'animated',
        data: { status: getEdgeStatus(nodeStatuses[dep], nodeStatuses[node.id]) },
      });
    }
  }

  for (const sg of dag.strategy_gates) {
    let gateStatus: 'pending' | 'passed' | 'failed' = 'pending';
    if (execution?.gate_results) {
      const gateResult = execution.gate_results.find((gr) => gr.gate_id === `strategy:${sg.id}`);
      if (gateResult) gateStatus = gateResult.passed ? 'passed' : 'failed';
    }

    nodes.push({
      id: `gate:${sg.id}`,
      type: 'gate',
      position: { x: 0, y: 0 },
      data: {
        label: sg.id,
        nodeType: 'gate',
        gateId: sg.id,
        check: sg.gate.check,
        depends_on: sg.depends_on,
        status: gateStatus,
      } as unknown as VizNodeData,
    });

    for (const dep of sg.depends_on) {
      edges.push({
        id: `${dep}->gate:${sg.id}`,
        source: dep,
        target: `gate:${sg.id}`,
        type: 'animated',
        data: {
          status: getEdgeStatus(
            nodeStatuses[dep],
            gateStatus === 'pending' ? 'pending' : gateStatus === 'passed' ? 'completed' : 'failed',
          ),
        },
      });
    }
  }

  return { nodes: layoutDag(nodes, edges), edges };
}

interface StrategyDagProps {
  dag: StrategyDAG;
  execution?: ExecutionStatusResponse | null;
  onNodeClick?: (nodeId: string) => void;
  className?: string;
}

export function StrategyDag({ dag, execution, onNodeClick, className }: StrategyDagProps) {
  const { nodes, edges } = useMemo(() => buildGraph(dag, execution), [dag, execution]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onNodeClick?.(node.id);
    },
    [onNodeClick],
  );

  return (
    <div className={className} style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(0, 201, 167, 0.06)" />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            const d = node.data as unknown as VizNodeData;
            if (d.nodeType === 'gate') {
              const gd = d as GateNodeData;
              if (gd.status === 'passed') return '#00e5cc';
              if (gd.status === 'failed') return '#e05a5a';
              return 'rgba(26, 107, 90, 0.5)';
            }
            const nd = d as MethodologyNodeData | ScriptNodeData;
            switch (nd.status) {
              case 'running': return '#00c9a7';
              case 'completed': return '#00e5cc';
              case 'failed':
              case 'gate_failed': return '#e8a45a';
              case 'suspended': return '#7b5fb5';
              default: return 'rgba(26, 107, 90, 0.5)';
            }
          }}
          maskColor="rgba(8, 14, 20, 0.7)"
        />
      </ReactFlow>
    </div>
  );
}
