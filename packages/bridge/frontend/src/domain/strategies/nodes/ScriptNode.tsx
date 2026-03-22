/** Script node for the xyflow DAG — Narrative Flow styled */

import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { ScriptNodeData } from '../lib/types';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/formatters';

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

export function ScriptNode({ data }: NodeProps) {
  const d = data as unknown as ScriptNodeData;

  return (
    <div className={cn(
      'rounded-xl border-2 p-3 min-w-[200px] transition-all',
      STATUS_STYLES[d.status] ?? STATUS_STYLES.pending,
    )}>
      <Handle type="target" position={Position.Left} className="!bg-bio !border-abyss" />
      <div className="flex items-center gap-2 mb-1">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-bio">
          <rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span className="font-mono text-xs text-txt font-medium truncate">{d.label}</span>
      </div>
      <p className="text-[0.65rem] text-txt-muted mb-2">Script</p>
      <div className="flex items-center justify-between">
        <span className={cn(
          'text-[0.6rem] font-mono font-medium px-1.5 py-0.5 rounded',
          STATUS_BADGE[d.status] ?? STATUS_BADGE.pending,
        )}>
          {d.status}
        </span>
        {d.status === 'completed' && d.duration_ms != null && (
          <span className="text-[0.6rem] font-mono text-txt-muted">{formatDuration(d.duration_ms)}</span>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-bio !border-abyss" />
    </div>
  );
}
