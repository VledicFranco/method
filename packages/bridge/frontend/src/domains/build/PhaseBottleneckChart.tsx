/**
 * PhaseBottleneckChart — Horizontal bar chart showing avg duration % per phase.
 *
 * Pure CSS/HTML bars: amber for the highest phase, purple for the rest.
 * No external chart library.
 *
 * @see PRD 047 §Analytics — Phase Bottlenecks
 */

import { cn } from '@/shared/lib/cn';

export interface PhaseBottleneck {
  readonly phase: string;
  readonly pct: number;
}

const BOTTLENECK_DATA: PhaseBottleneck[] = [
  { phase: 'Implement', pct: 45 },
  { phase: 'Review', pct: 20 },
  { phase: 'Explore', pct: 12 },
  { phase: 'Specify', pct: 8 },
  { phase: 'Design', pct: 5 },
  { phase: 'Plan', pct: 4 },
  { phase: 'Validate', pct: 4 },
  { phase: 'Measure', pct: 2 },
];

export function PhaseBottleneckChart() {
  const maxPct = Math.max(...BOTTLENECK_DATA.map((d) => d.pct));

  return (
    <div className="bg-abyss border border-bdr rounded-xl p-5 mb-4">
      <div className="text-[13px] font-semibold text-txt mb-4">Phase Bottlenecks</div>
      <div className="space-y-2">
        {BOTTLENECK_DATA.map((item) => {
          const isHighest = item.pct === maxPct;
          // Scale bar width so the largest phase fills ~90% of the container
          const barWidth = Math.max((item.pct / maxPct) * 90, 6);

          return (
            <div key={item.phase} className="flex items-center gap-3">
              <span className="font-mono text-xs text-txt-dim w-[80px] text-right shrink-0">
                {item.phase}
              </span>
              <div className="flex-1 h-5 bg-[#ffffff06] rounded-[4px] overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-[4px] flex items-center pl-2 font-mono text-[10px] font-semibold transition-[width] duration-500',
                    isHighest
                      ? 'bg-gradient-to-r from-[#f59e0b] to-[#fbbf24] text-[#1a1a2e]'
                      : 'bg-gradient-to-r from-[#6d5aed] to-[#8b7cf7] text-white',
                  )}
                  style={{ width: `${barWidth}%` }}
                >
                  {item.pct}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
