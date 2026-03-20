import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { GateNodeData } from '../lib/types';
import { StatusBadge } from './StatusBadge';

function GateIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle
        cx="8"
        cy="8"
        r="6.5"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M5 8L7 10L11 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function truncateCheck(check: string, maxLen = 40): string {
  if (check.length <= maxLen) return check;
  return check.slice(0, maxLen - 3) + '...';
}

export function GateNode({ data }: NodeProps) {
  const d = data as unknown as GateNodeData;
  const statusClass = `viz-node viz-node--gate viz-node--${d.status}`;

  return (
    <div className={statusClass}>
      <Handle type="target" position={Position.Left} />
      <div className="viz-node__header">
        <div className="viz-node__icon">
          <GateIcon />
        </div>
        <div className="viz-node__title">{d.gateId}</div>
      </div>
      <div className="viz-node__subtitle">{truncateCheck(d.check)}</div>
      <div className="viz-node__footer">
        <StatusBadge status={d.status} />
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
