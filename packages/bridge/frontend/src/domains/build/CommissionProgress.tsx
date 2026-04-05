/**
 * CommissionProgress — Task cards for parallel commissions.
 *
 * Shows commission name, progress bar, and status indicator.
 * Failed/retrying commissions get a contextual [Retry] button.
 *
 * @see PRD 047 §Dashboard Architecture — Commission cards (Cursor pattern)
 */

import { cn } from '@/shared/lib/cn';
import type { Commission } from './types';

function CommissionRow({ commission }: { commission: Commission }) {
  const barColor: Record<Commission['status'], string> = {
    completed: 'bg-[#10b981]',
    running: 'bg-[#3b82f6]',
    retrying: 'bg-[#f59e0b] animate-[commission-pulse_1.5s_infinite]',
    failed: 'bg-[#ef4444]',
    pending: 'bg-bdr',
  };

  const statusLabel: Record<Commission['status'], string> = {
    completed: '\u2713 complete',
    running: 'running',
    retrying: `\u21BB retrying ${commission.progressPct}%`,
    failed: '\u2717 failed',
    pending: 'pending',
  };

  const statusColor: Record<Commission['status'], string> = {
    completed: 'text-[#10b981]',
    running: 'text-[#3b82f6]',
    retrying: 'text-[#f59e0b]',
    failed: 'text-[#ef4444]',
    pending: 'text-[#64748b]',
  };

  return (
    <div className="flex items-center gap-3 mb-3 last:mb-0">
      {/* Commission label */}
      <span className="font-mono text-xs text-txt-dim w-[200px] shrink-0 truncate">
        {commission.name}
      </span>

      {/* Progress bar */}
      <div className="flex-1 h-1.5 bg-[#ffffff08] rounded-[3px] overflow-hidden">
        <div
          className={cn('h-full rounded-[3px] transition-[width] duration-500 ease-out', barColor[commission.status])}
          style={{ width: `${commission.progressPct}%` }}
        />
      </div>

      {/* Status label */}
      <span
        className={cn(
          'font-mono text-[11px] w-[110px] text-right shrink-0',
          statusColor[commission.status],
        )}
      >
        {statusLabel[commission.status]}
      </span>

      {/* Retry button for failed commissions */}
      {commission.status === 'failed' && (
        <button className="text-[10px] font-semibold px-2 py-0.5 rounded bg-[#3b82f622] text-[#3b82f6] border border-[#3b82f633] hover:bg-[#3b82f633] transition-colors">
          Retry
        </button>
      )}
    </div>
  );
}

export interface CommissionProgressProps {
  commissions: Commission[];
  strategyTag?: string;
}

export function CommissionProgress({ commissions, strategyTag }: CommissionProgressProps) {
  if (commissions.length === 0) return null;

  // Derive current phase label from commissions presence
  const completed = commissions.filter((c) => c.status === 'completed').length;

  return (
    <div className="bg-abyss border border-bdr rounded-xl p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[13px] font-semibold text-txt flex items-center gap-2">
          Commissions
          {strategyTag && (
            <span className="font-mono text-[10px] text-txt-dim bg-[#ffffff08] px-2 py-0.5 rounded-[3px]">
              {strategyTag}
            </span>
          )}
        </div>
        <div className="font-mono text-[11px] text-txt-dim">
          {completed}/{commissions.length} done
        </div>
      </div>
      {commissions.map((c) => (
        <CommissionRow key={c.id} commission={c} />
      ))}
    </div>
  );
}
