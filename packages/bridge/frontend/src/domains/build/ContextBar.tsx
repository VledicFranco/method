/**
 * ContextBar — Persistent sticky bar at top of main area (Dify Variable Inspect pattern).
 *
 * Shows: requirement text, current phase pill, cost accumulator,
 * commission status, mini pipeline strip, autonomy dropdown,
 * [Pause] [Abort] controls.
 *
 * @see PRD 047 §Dashboard Architecture — Persistent Context Bar
 */

import { Link } from 'react-router-dom';
import { cn } from '@/shared/lib/cn';
import { PHASE_LABELS } from './types';
import type { BuildSummary, AutonomyLevel, PhaseInfo } from './types';

// ── Mini pipeline strip (8 tiny dots) ──

function MiniPipelineStrip({ phases }: { phases: PhaseInfo[] }) {
  const dotColor: Record<string, string> = {
    completed: 'bg-[#10b981]',
    running: 'bg-[#3b82f6]',
    waiting: 'bg-[#f59e0b]',
    recovered: 'bg-[#10b981] shadow-[0_0_0_1px_#f59e0b]',
    failed: 'bg-[#ef4444]',
    future: 'bg-[#ffffff15]',
  };

  return (
    <div className="flex items-center gap-[3px] shrink-0">
      {phases.map((p, i) => (
        <div
          key={i}
          className={cn('w-1.5 h-1.5 rounded-full', dotColor[p.status])}
        />
      ))}
    </div>
  );
}

// ── Phase pill ──

function PhasePill({ phase, status }: { phase: string; status: string }) {
  const pillClasses: Record<string, string> = {
    running: 'bg-[#3b82f622] text-[#3b82f6] border-[#3b82f633]',
    waiting: 'bg-[#f59e0b22] text-[#f59e0b] border-[#f59e0b33]',
    completed: 'bg-[#10b98122] text-[#10b981] border-[#10b98133]',
    failed: 'bg-[#ef444422] text-[#ef4444] border-[#ef444433]',
    paused: 'bg-[#64748b22] text-[#64748b] border-[#64748b33]',
  };

  return (
    <span
      className={cn(
        'text-[10px] font-semibold px-2.5 py-[3px] rounded-full whitespace-nowrap uppercase tracking-wider shrink-0 border',
        pillClasses[status] ?? pillClasses.running,
      )}
    >
      {phase}
    </span>
  );
}

// ── Main export ──

export interface ContextBarProps {
  build: BuildSummary;
  onPause?: () => void;
  onAbort?: () => void;
  onResume?: () => void;
  onAutonomyChange?: (level: AutonomyLevel) => void;
}

export function ContextBar({
  build,
  onPause,
  onAbort,
  onResume,
  onAutonomyChange,
}: ContextBarProps) {
  const phaseLabel = PHASE_LABELS[build.currentPhase];
  const costPct = build.budgetUsd > 0 ? (build.costUsd / build.budgetUsd) * 100 : 0;
  const completedComms = build.commissions.filter((c) => c.status === 'completed').length;
  const isCompleted = build.status === 'completed';
  const isPaused = build.status === 'paused';
  const isFailed = build.status === 'failed';
  const canResume = isPaused || isFailed;

  return (
    <div className="bg-[#0e0e16] border-b border-bdr px-6 py-2.5 flex items-center gap-4 shrink-0 min-h-[48px]">
      {/* Back arrow — navigates to dashboard */}
      <Link
        to="/"
        className="text-txt-dim hover:text-txt text-sm shrink-0 transition-colors"
        aria-label="Back to dashboard"
      >
        &#8592;
      </Link>

      {/* Project badge */}
      {build.projectId && (
        <span className="font-mono text-[10px] text-[#6d5aed] bg-[#6d5aed22] border border-[#6d5aed33] px-2 py-[3px] rounded shrink-0 whitespace-nowrap">
          {build.projectId}
        </span>
      )}

      {/* Requirement text */}
      <span className="font-mono text-xs text-txt-dim flex-1 min-w-0 truncate">
        <strong className="text-txt font-semibold">{build.name}</strong>
        {' \u2014 '}
        {build.requirement}
      </span>

      {/* Phase pill */}
      <PhasePill phase={phaseLabel} status={build.status} />

      {/* Activity indicator (currently running node/phase) */}
      {build.currentActivity && build.status === 'running' && (
        <span className="font-mono text-[10px] text-[#3b82f6] flex items-center gap-1.5 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-[#3b82f6] animate-[pulse-dot_1.5s_infinite]" />
          {build.currentActivity}
        </span>
      )}

      {/* Cost accumulator */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="font-mono text-[11px] text-txt-dim whitespace-nowrap">
          ${build.costUsd.toFixed(2)} / ${build.budgetUsd.toFixed(2)}
        </span>
        <div className="w-20 h-1 bg-[#ffffff0a] rounded-sm overflow-hidden">
          <div
            className="h-full rounded-sm bg-[#6d5aed] transition-[width] duration-500"
            style={{ width: `${Math.min(costPct, 100)}%` }}
          />
        </div>
      </div>

      {/* Commission count */}
      {build.commissions.length > 0 && (
        <span className="font-mono text-[11px] text-[#64748b] whitespace-nowrap shrink-0">
          {completedComms}/{build.commissions.length} done
        </span>
      )}

      {/* Mini pipeline strip */}
      <MiniPipelineStrip phases={build.phases} />

      {/* Autonomy dropdown */}
      {!isCompleted && (
        <select
          className="bg-void border border-bdr text-txt font-mono text-[11px] px-2 py-[3px] rounded-[5px] cursor-pointer outline-none focus:border-[#6d5aed]"
          value={build.autonomy}
          onChange={(e) => onAutonomyChange?.(e.target.value as AutonomyLevel)}
        >
          <option value="discuss-all">Discuss All</option>
          <option value="auto-routine">Auto-Routine</option>
          <option value="full-auto">Full Auto</option>
        </select>
      )}

      {/* Controls */}
      {!isCompleted && (
        <div className="flex gap-2 shrink-0">
          {canResume ? (
            <button
              onClick={onResume}
              className="text-[11px] font-semibold px-3.5 py-[5px] rounded-[5px] border cursor-pointer transition-colors bg-[#10b98122] text-[#10b981] border-[#10b98133] hover:bg-[#10b98133]"
            >
              Resume
            </button>
          ) : (
            <button
              onClick={onPause}
              className="text-[11px] font-semibold px-3.5 py-[5px] rounded-[5px] border cursor-pointer transition-colors bg-[#f59e0b22] text-[#f59e0b] border-[#f59e0b33] hover:bg-[#f59e0b33]"
            >
              Pause
            </button>
          )}
          {!isFailed && (
            <button
              onClick={onAbort}
              className="text-[11px] font-semibold px-3.5 py-[5px] rounded-[5px] border cursor-pointer transition-colors bg-[#ef444422] text-[#ef4444] border-[#ef444433] hover:bg-[#ef444433]"
            >
              Abort
            </button>
          )}
        </div>
      )}
    </div>
  );
}
