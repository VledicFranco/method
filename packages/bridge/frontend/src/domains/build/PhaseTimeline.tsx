/**
 * PhaseTimeline — 8 horizontal phase pills + Gantt timeline.
 *
 * Each pill shows phase status via color + icon:
 *   completed (green + check), running (blue + spinner),
 *   waiting (amber + pause), recovered (green + retry badge),
 *   future (gray outline).
 *
 * Below the pills: Gantt-style bars showing durations.
 *
 * @see PRD 047 §Dashboard Architecture — Phase Timeline
 */

import { cn } from '@/shared/lib/cn';
import { PHASE_LABELS } from './types';
import type { PhaseInfo, GanttBar } from './types';

// ── Phase pill sub-component ──

function PhasePill({ info }: { info: PhaseInfo }) {
  const label = PHASE_LABELS[info.phase];
  const duration = info.durationMin != null ? `${info.durationMin}m` : undefined;

  const statusClasses: Record<string, string> = {
    completed: 'bg-[#10b98122] text-[#10b981] border-[#10b98133]',
    running: 'bg-[#3b82f622] text-[#60a5fa] border-[#3b82f6]',
    waiting: 'bg-[#f59e0b22] text-[#f59e0b] border-[#f59e0b33]',
    failed: 'bg-[#ef444422] text-[#ef4444] border-[#ef444433]',
    recovered: 'bg-[#10b98122] text-[#10b981] border-[#10b98133]',
    future: 'bg-transparent text-[#64748b] border-bdr opacity-50',
  };

  return (
    <div
      className={cn(
        'flex-1 text-center py-2.5 px-1 rounded-[5px] text-[11px] font-semibold relative border transition-all duration-300',
        statusClasses[info.status],
        info.status === 'running' && 'animate-[phase-glow_2s_infinite]',
      )}
    >
      <span className="inline-flex items-center gap-1">
        <PhaseIcon status={info.status} />
        {label}
      </span>
      {duration && (
        <span className="block mt-0.5 text-[9px] font-normal opacity-80">{duration}</span>
      )}
      {info.status === 'waiting' && (
        <span className="block mt-0.5 text-[8px] opacity-70">awaiting input</span>
      )}
      {info.status === 'recovered' && info.retryCount && (
        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-[#f59e0b] text-black rounded-full text-[8px] flex items-center justify-center font-bold">
          !
        </span>
      )}
    </div>
  );
}

function PhaseIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
    case 'recovered':
      return <span>&#10003;</span>;
    case 'running':
      return (
        <span className="inline-block w-2.5 h-2.5 border-2 border-[#60a5fa] border-t-transparent rounded-full animate-spin align-middle" />
      );
    case 'waiting':
      return <span className="text-[9px]">&#9208;</span>;
    case 'failed':
      return <span>&#10007;</span>;
    default:
      return <span>&#8226;</span>;
  }
}

// ── Gantt timeline sub-component ──

function GanttTimeline({ bars }: { bars: GanttBar[] }) {
  // Group bars by phase for row display
  const phases = ['explore', 'specify', 'design', 'plan', 'implement', 'review', 'validate', 'measure'] as const;

  // Build rows: each phase gets one row with potentially multiple bars
  const rows = phases.map((phase) => ({
    label: PHASE_LABELS[phase],
    bars: bars.filter((b) => b.phase === phase),
  }));

  const barColorClass = (status: GanttBar['status']) => {
    switch (status) {
      case 'completed':
        return 'bg-[#10b981] opacity-70';
      case 'running':
        return 'bg-[#3b82f6] opacity-80 animate-[bar-pulse_2s_infinite]';
      case 'waiting':
        return 'bg-[#f59e0b] opacity-50';
      case 'gate':
        return 'bg-[#f59e0b] opacity-35 border border-dashed border-[#f59e0b]';
      case 'future':
        return 'bg-bdr opacity-30';
      default:
        return 'bg-bdr';
    }
  };

  return (
    <div className="bg-abyss border border-bdr rounded-lg p-4 mb-4">
      <div className="text-[11px] font-semibold text-[#64748b] uppercase tracking-wider mb-3">
        Timeline
      </div>
      <div className="space-y-[3px]">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-txt-dim w-[70px] text-right shrink-0">
              {row.label}
            </span>
            <div className="flex-1 h-3.5 relative rounded-sm">
              {row.bars.map((bar, i) => {
                const isStacked = bar.stack != null;
                const topOffset = isStacked && bar.stack === 1 ? 'top-2 h-1.5' : isStacked ? 'top-0 h-1.5' : '';
                const heightClass = bar.status === 'gate' ? 'h-2.5 top-[1px]' : isStacked ? 'h-1.5' : 'h-full';

                return (
                  <div
                    key={`${bar.label}-${i}`}
                    className={cn(
                      'absolute rounded-sm min-w-[2px] transition-all duration-300',
                      barColorClass(bar.status),
                      heightClass,
                      topOffset,
                    )}
                    style={{ left: `${bar.leftPct}%`, width: `${bar.widthPct}%` }}
                    title={bar.tooltip ?? bar.label}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main export ──

export interface PhaseTimelineProps {
  phases: PhaseInfo[];
  gantt: GanttBar[];
}

export function PhaseTimeline({ phases, gantt }: PhaseTimelineProps) {
  return (
    <div>
      {/* Phase pills row */}
      <div className="flex gap-1 mb-4">
        {phases.map((info) => (
          <PhasePill key={info.phase} info={info} />
        ))}
      </div>

      {/* Gantt bars */}
      {gantt.length > 0 && <GanttTimeline bars={gantt} />}
    </div>
  );
}
