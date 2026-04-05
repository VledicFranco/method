/**
 * RefinementList — Method improvement proposals with category filters.
 *
 * Each item shows a colored tag [strategy|gate|orchestrator|bridge],
 * description, and frequency. Filter buttons narrow the visible set.
 *
 * @see PRD 047 §Analytics — Refinements
 */

import { useState } from 'react';
import { cn } from '@/shared/lib/cn';
import type { Refinement } from './types';

type FilterTarget = 'all' | Refinement['target'];

const TAG_COLOR: Record<Refinement['target'], string> = {
  product: 'bg-[#10b98122] text-[#10b981]',
  strategy: 'bg-[#6d5aed33] text-[#6d5aed]',
  gate: 'bg-[#ef444422] text-[#ef4444]',
  orchestrator: 'bg-[#f59e0b22] text-[#f59e0b]',
  bridge: 'bg-[#3b82f622] text-[#3b82f6]',
  pacta: 'bg-[#8b5cf622] text-[#8b5cf6]',
};

const FILTERS: { id: FilterTarget; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'gate', label: 'Gate' },
  { id: 'orchestrator', label: 'Orchestrator' },
  { id: 'bridge', label: 'Bridge' },
];

const MOCK_REFINEMENTS: Refinement[] = [
  {
    target: 'gate',
    description: 'G-NO-ANY fires too late — move check before compilation to save retry cost',
    frequency: 'triggered 4/10 builds',
  },
  {
    target: 'strategy',
    description: 'Commission parallelism capped at 3 — consider raising to 5 for large PRDs',
    frequency: 'observed 3/10 builds',
  },
  {
    target: 'orchestrator',
    description: 'Retry budget exhaustion on complex middleware — add progressive type hints',
    frequency: 'triggered 2/10 builds',
  },
  {
    target: 'bridge',
    description: 'Session cleanup delay causes stale PTY handles on fast successive builds',
    frequency: 'observed 2/10 builds',
  },
  {
    target: 'strategy',
    description: 'Explore phase over-scans large repos — add file-count early-exit threshold',
    frequency: 'observed 1/10 builds',
  },
];

export function RefinementList() {
  const [filter, setFilter] = useState<FilterTarget>('all');

  const visible =
    filter === 'all'
      ? MOCK_REFINEMENTS
      : MOCK_REFINEMENTS.filter((r) => r.target === filter);

  return (
    <div className="bg-abyss border border-bdr rounded-xl p-5 mb-4">
      <div className="text-[13px] font-semibold text-txt mb-4">Refinements</div>

      {/* Filter buttons */}
      <div className="flex gap-1 mb-3">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              'font-mono text-[10px] px-2.5 py-[3px] rounded-full border cursor-pointer transition-all duration-150',
              filter === f.id
                ? 'bg-[#6d5aed33] text-txt border-[#6d5aed]'
                : 'bg-none text-[#64748b] border-bdr hover:text-txt hover:border-[#ffffff22]',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Refinement items */}
      <div className="space-y-2">
        {visible.map((r, i) => (
          <div
            key={i}
            className="flex items-start gap-2.5 p-3 bg-void border border-bdr rounded-[5px]"
          >
            <span
              className={cn(
                'font-mono text-[10px] px-2 py-0.5 rounded-[3px] font-semibold uppercase shrink-0',
                TAG_COLOR[r.target],
              )}
            >
              {r.target}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-txt mb-1">{r.description}</div>
              <div className="font-mono text-[11px] text-txt-dim">{r.frequency}</div>
            </div>
          </div>
        ))}
        {visible.length === 0 && (
          <div className="text-center text-[#64748b] py-4 text-xs">
            No refinements match this filter
          </div>
        )}
      </div>
    </div>
  );
}
