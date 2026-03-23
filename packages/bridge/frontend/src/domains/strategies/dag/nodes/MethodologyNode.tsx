/** Methodology node for the xyflow DAG — Narrative Flow styled */

import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { MethodologyNodeData } from '../lib/types';
import { cn } from '@/lib/cn';
import { formatDuration, formatCost } from '@/lib/formatters';

const STATUS_STYLES: Record<string, string> = {
  pending: 'border-bdr bg-abyss',
  running: 'border-bio bg-abyss shadow-[0_0_12px_rgba(0,201,167,0.3)]',
  completed: 'border-cyan bg-abyss',
  failed: 'border-error bg-abyss',
  gate_failed: 'border-solar bg-abyss',
  suspended: 'border-nebular bg-abyss',
};

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-txt-muted/10 text-txt-dim',
  running: 'bg-bio-dim text-bio',
  completed: 'bg-cyan/15 text-cyan',
  failed: 'bg-error-dim text-error',
  gate_failed: 'bg-solar-dim text-solar',
  suspended: 'bg-nebular-dim text-nebular',
};

export function MethodologyNode({ data }: NodeProps) {
  const d = data as unknown as MethodologyNodeData;

  return (
    <div className={cn(
      'rounded-xl border-2 p-3 min-w-[240px] transition-all',
      STATUS_STYLES[d.status] ?? STATUS_STYLES.pending,
    )}>
      <Handle type="target" position={Position.Left} className="!bg-bio !border-abyss" />
      <div className="flex items-center gap-2 mb-1">
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" className="shrink-0 text-nebular">
          <path d="M9 1L16.5 9L9 17L1.5 9L9 1Z" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span className="font-mono text-xs text-txt font-medium truncate">{d.label}</span>
      </div>
      <p className="text-[0.65rem] text-txt-muted font-mono mb-2 truncate">
        {d.methodology}{d.method_hint ? ` / ${d.method_hint}` : ''}
      </p>
      <div className="flex items-center justify-between">
        <span className={cn(
          'text-[0.6rem] font-mono font-medium px-1.5 py-0.5 rounded',
          STATUS_BADGE[d.status] ?? STATUS_BADGE.pending,
        )}>
          {d.status}
        </span>
        <span className="text-[0.6rem] font-mono text-txt-muted">
          {d.status === 'completed' && d.cost_usd != null && formatCost(d.cost_usd)}
          {d.status === 'running' && d.duration_ms != null && formatDuration(d.duration_ms)}
          {(d.status === 'failed' || d.status === 'gate_failed') && d.retries != null && d.retries > 0 && `${d.retries} retries`}
        </span>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-bio !border-abyss" />
    </div>
  );
}
