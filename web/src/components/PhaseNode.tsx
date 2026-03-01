'use client';

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { Phase } from '../lib/types';

export type PhaseNodeType = Node<
  { phase: Phase; onClick: (phase: Phase) => void },
  'phase'
>;

export function PhaseNode({ data }: NodeProps<PhaseNodeType>) {
  const { phase, onClick } = data;
  // output_schema is Record<string, OutputField> — use Object.values()
  const fieldCount = Object.values(phase.output_schema).length;
  const hardCount = phase.invariants.filter((inv) => inv.hard).length;
  const softCount = phase.invariants.filter((inv) => !inv.hard).length;

  return (
    <div className="phase-node" onClick={() => onClick(phase)}>
      <Handle type="target" position={Position.Top} />
      <div className="phase-node-header">
        <span className="phase-id">
          <span
            style={{
              display: 'inline-block',
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: '#818cf8',
              boxShadow: '0 0 6px rgba(129,140,248,0.9), 0 0 12px rgba(129,140,248,0.4)',
              flexShrink: 0,
            }}
          />
          #{phase.id}
        </span>
        <span className="phase-name">{phase.name}</span>
      </div>
      <div className="phase-node-meta">
        {fieldCount > 0 && <span className="badge fields">{fieldCount} fields</span>}
        {hardCount > 0 && <span className="badge hard">{hardCount} required</span>}
        {softCount > 0 && <span className="badge soft">{softCount} soft</span>}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
