/** Floating cost/status overlay for the execution view */

import { cn } from '@/lib/cn';
import { formatCost, formatDuration } from '@/lib/formatters';
import { StatusBadge, type Status } from '@/components/data/StatusBadge';

interface CostOverlayProps {
  status: string;
  costUsd: number;
  nodeCount: number;
  completedCount: number;
  failedCount: number;
  durationMs?: number;
  className?: string;
}

export function CostOverlay({
  status,
  costUsd,
  nodeCount,
  completedCount,
  failedCount,
  durationMs,
  className,
}: CostOverlayProps) {
  const costColor =
    costUsd > 5 ? 'text-error' : costUsd > 1 ? 'text-solar' : 'text-txt';

  return (
    <div className={cn(
      'absolute top-4 right-4 z-10 rounded-card border border-bdr bg-abyss/95 backdrop-blur-sm p-sp-3 min-w-[160px]',
      className,
    )}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[0.65rem] text-txt-muted uppercase tracking-wider">Execution</span>
        <StatusBadge status={(status === 'started' ? 'running' : status) as Status} size="sm" />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[0.65rem] text-txt-muted">Cost</span>
          <span className={cn('font-mono text-sm font-medium', costColor)}>
            {formatCost(costUsd)}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[0.65rem] text-txt-muted">Nodes</span>
          <span className="font-mono text-xs text-txt">
            {completedCount}/{nodeCount}
            {failedCount > 0 && (
              <span className="text-solar ml-1">({failedCount} failed)</span>
            )}
          </span>
        </div>

        {durationMs != null && (
          <div className="flex items-center justify-between">
            <span className="text-[0.65rem] text-txt-muted">Duration</span>
            <span className="font-mono text-xs text-txt">{formatDuration(durationMs)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
