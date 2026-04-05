/**
 * EvidenceReport — Visual card for completed builds.
 *
 * Shows: verdict badge, 5-stat grid, criteria checklist,
 * per-phase cost breakdown, and refinements list.
 *
 * @see PRD 047 §Dashboard Architecture — Evidence Report View
 */

import { cn } from '@/shared/lib/cn';
import { CriteriaTracker } from './CriteriaTracker';
import { PHASE_LABELS, PHASES } from './types';
import type { BuildSummary, Verdict, Refinement } from './types';

// ── Verdict badge ──

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const config: Record<Verdict, { label: string; icon: string; classes: string }> = {
    FULLY_VALIDATED: {
      label: 'FULLY VALIDATED',
      icon: '\u2713',
      classes: 'bg-[#10b98122] text-[#10b981] border-[#10b98133]',
    },
    PARTIALLY_VALIDATED: {
      label: 'PARTIALLY VALIDATED',
      icon: '\u26A0',
      classes: 'bg-[#f59e0b22] text-[#f59e0b] border-[#f59e0b33]',
    },
    FAILED: {
      label: 'FAILED',
      icon: '\u2717',
      classes: 'bg-[#ef444422] text-[#ef4444] border-[#ef444433]',
    },
  };
  const c = config[verdict];

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 px-5 py-2 rounded-lg text-[13px] font-bold tracking-wider mb-5 border',
        c.classes,
      )}
    >
      <span className="text-base">{c.icon}</span>
      {c.label}
    </div>
  );
}

// ── Stat grid (5 stats) ──

interface Stat {
  value: string;
  label: string;
  good?: boolean;
}

function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid grid-cols-5 gap-3 mb-5">
      {stats.map((s, i) => (
        <div
          key={i}
          className="bg-void border border-bdr rounded-[5px] p-3 text-center"
        >
          <div
            className={cn(
              'font-mono text-xl font-bold',
              s.good ? 'text-[#10b981]' : 'text-txt',
            )}
          >
            {s.value}
          </div>
          <div className="text-[10px] text-txt-dim uppercase tracking-wider mt-1">
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Per-phase cost breakdown ──

function PhaseCostBreakdown({ costs }: { costs: Record<string, number> }) {
  const maxCost = Math.max(...Object.values(costs), 0.01);

  return (
    <div className="bg-abyss border border-bdr rounded-xl p-5 mb-4">
      <div className="text-[13px] font-semibold text-txt mb-4">Cost Breakdown by Phase</div>
      <div className="space-y-1">
        {PHASES.map((phase) => {
          const cost = costs[phase] ?? 0;
          const pct = (cost / maxCost) * 100;
          return (
            <div key={phase} className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-txt-dim w-[70px] text-right shrink-0">
                {PHASE_LABELS[phase]}
              </span>
              <div className="flex-1 h-2 bg-[#ffffff06] rounded-sm overflow-hidden">
                <div
                  className="h-full rounded-sm bg-gradient-to-r from-[#6d5aed] to-[#8b7cf7]"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="font-mono text-[10px] text-[#64748b] w-[50px] text-right shrink-0">
                ${cost.toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Refinements list ──

function RefinementsList({ refinements }: { refinements: Refinement[] }) {
  const tagColor: Record<Refinement['target'], string> = {
    strategy: 'bg-[#6d5aed33] text-[#6d5aed]',
    gate: 'bg-[#ef444422] text-[#ef4444]',
    orchestrator: 'bg-[#f59e0b22] text-[#f59e0b]',
    bridge: 'bg-[#3b82f622] text-[#3b82f6]',
  };

  if (refinements.length === 0) {
    return (
      <div className="bg-abyss border border-bdr rounded-xl p-5">
        <div className="text-[13px] font-semibold text-txt mb-4">Refinements</div>
        <p className="text-[13px] text-txt-dim italic">No refinements — clean build</p>
      </div>
    );
  }

  return (
    <div className="bg-abyss border border-bdr rounded-xl p-5">
      <div className="text-[13px] font-semibold text-txt mb-4">Refinements</div>
      <div className="space-y-2">
        {refinements.map((r, i) => (
          <div
            key={i}
            className="flex items-start gap-2.5 p-3 bg-void border border-bdr rounded-[5px]"
          >
            <span
              className={cn(
                'font-mono text-[10px] px-2 py-0.5 rounded-[3px] font-semibold uppercase shrink-0',
                tagColor[r.target],
              )}
            >
              {r.target}
            </span>
            <div className="flex-1">
              <div className="text-[13px] text-txt mb-1">{r.description}</div>
              <div className="font-mono text-[11px] text-txt-dim">{r.frequency}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main export ──

export interface EvidenceReportProps {
  build: BuildSummary;
}

export function EvidenceReport({ build }: EvidenceReportProps) {
  if (!build.verdict || !build.evidence) return null;

  const { evidence } = build;
  const stats: Stat[] = [
    { value: `$${evidence.totalCost.toFixed(2)}`, label: 'Total Cost' },
    { value: `${evidence.overheadPct}%`, label: 'Overhead', good: evidence.overheadPct < 20 },
    { value: String(evidence.interventions), label: 'Interventions' },
    { value: `${evidence.durationMin}m`, label: 'Duration' },
    {
      value: String(evidence.failureRecoveries),
      label: 'Failures',
      good: evidence.failureRecoveries === 0,
    },
  ];

  return (
    <div>
      <VerdictBadge verdict={build.verdict} />
      <StatGrid stats={stats} />

      {build.phaseCosts && <PhaseCostBreakdown costs={build.phaseCosts} />}

      <div className="grid grid-cols-2 gap-4">
        <CriteriaTracker criteria={build.criteria} />
        <RefinementsList refinements={build.refinements} />
      </div>
    </div>
  );
}
