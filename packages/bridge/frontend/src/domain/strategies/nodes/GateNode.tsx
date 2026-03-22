/** Gate node for the xyflow DAG — Narrative Flow styled */

import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { GateNodeData } from '../lib/types';
import { cn } from '@/lib/cn';

export function GateNode({ data }: NodeProps) {
  const d = data as unknown as GateNodeData;

  return (
    <div className={cn(
      'rounded-xl border-2 p-3 min-w-[180px] transition-all',
      d.status === 'passed' ? 'border-cyan bg-abyss' :
      d.status === 'failed' ? 'border-error bg-abyss' :
      'border-bdr bg-abyss',
    )}>
      <Handle type="target" position={Position.Left} className="!bg-bio !border-abyss" />
      <div className="flex items-center gap-2 mb-1">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={cn(
          'shrink-0',
          d.status === 'passed' ? 'text-cyan' : d.status === 'failed' ? 'text-error' : 'text-txt-muted',
        )}>
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5 8L7 10L11 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="font-mono text-xs text-txt font-medium">{d.gateId}</span>
      </div>
      <p className="text-[0.6rem] text-txt-muted font-mono truncate" title={d.check}>
        {d.check.length > 40 ? d.check.slice(0, 37) + '...' : d.check}
      </p>
      <div className="mt-1.5">
        <span className={cn(
          'text-[0.6rem] font-mono font-medium px-1.5 py-0.5 rounded',
          d.status === 'passed' ? 'bg-cyan/15 text-cyan' :
          d.status === 'failed' ? 'bg-error-dim text-error' :
          'bg-txt-muted/10 text-txt-dim',
        )}>
          {d.status}
        </span>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-bio !border-abyss" />
    </div>
  );
}
