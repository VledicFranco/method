import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { Phase } from '../api/types.js';

export interface PhaseNodeData extends Record<string, unknown> {
  phase: Phase;
  onClick: (phase: Phase) => void;
}

export function PhaseNode({ data }: NodeProps<PhaseNodeData>) {
  const { phase, onClick } = data;
  const hardFields = phase.output_schema.filter((f) => !f.soft).length;
  const softFields = phase.output_schema.filter((f) => f.soft).length;

  return (
    <div className="phase-node" onClick={() => onClick(phase)}>
      <Handle type="target" position={Position.Top} />
      <div className="phase-node-header">
        <span className="phase-id">#{phase.id}</span>
        <span className="phase-name">{phase.name}</span>
      </div>
      <div className="phase-node-meta">
        {hardFields > 0 && <span className="badge hard">{hardFields} required</span>}
        {softFields > 0 && <span className="badge soft">{softFields} soft</span>}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
