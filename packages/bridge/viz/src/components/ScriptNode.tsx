import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { ScriptNodeData } from '../lib/types';
import { StatusBadge } from './StatusBadge';

function SquareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect
        x="1.5"
        y="1.5"
        width="13"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
    </svg>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function ScriptNode({ data }: NodeProps) {
  const d = data as unknown as ScriptNodeData;
  const statusClass = `viz-node viz-node--script viz-node--${d.status}`;

  return (
    <div className={statusClass}>
      <Handle type="target" position={Position.Left} />
      <div className="viz-node__header">
        <div className="viz-node__icon">
          <SquareIcon />
        </div>
        <div className="viz-node__title">{d.label}</div>
      </div>
      <div className="viz-node__subtitle">Script</div>
      <div className="viz-node__footer">
        <StatusBadge status={d.status} />
        {d.status === 'completed' && d.duration_ms != null && (
          <div className="viz-node__meta">{formatDuration(d.duration_ms)}</div>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
