import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { MethodologyNodeData } from '../lib/types';
import { StatusBadge } from './StatusBadge';

function DiamondIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path
        d="M9 1L16.5 9L9 17L1.5 9L9 1Z"
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

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function MethodologyNode({ data }: NodeProps) {
  const d = data as unknown as MethodologyNodeData;
  const statusClass = `viz-node viz-node--methodology viz-node--${d.status}`;

  return (
    <div className={statusClass}>
      <Handle type="target" position={Position.Left} />
      <div className="viz-node__header">
        <div className="viz-node__icon">
          <DiamondIcon />
        </div>
        <div className="viz-node__title">{d.label}</div>
      </div>
      <div className="viz-node__subtitle">
        {d.methodology}
        {d.method_hint ? ` / ${d.method_hint}` : ''}
      </div>
      <div className="viz-node__footer">
        <StatusBadge status={d.status} />
        <div className="viz-node__meta">
          {d.status === 'running' && d.duration_ms != null && (
            <span>{formatDuration(d.duration_ms)}</span>
          )}
          {d.status === 'completed' && d.cost_usd != null && (
            <span>{formatCost(d.cost_usd)}</span>
          )}
          {(d.status === 'failed' || d.status === 'gate_failed') &&
            d.retries != null &&
            d.retries > 0 && (
              <span>
                {d.retries} {d.retries === 1 ? 'retry' : 'retries'}
              </span>
            )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
