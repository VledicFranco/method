/**
 * ObservationHistory — aggregate view of recent cost observations
 * derived from the live event stream. Since the backend doesn't have
 * an "all-observations" endpoint, we aggregate from cost.observation_recorded
 * events flowing through the event bus.
 */

import { useMemo } from 'react';
import { Database } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { useEventStore } from '@/shared/stores/event-store';
import { formatRelativeTime, formatDuration } from '@/shared/lib/formatters';

interface ObservationRow {
  id: string;
  timestamp: string;
  methodologyId: string;
  model: string;
  inputSizeBucket: string;
  costUsd: number;
  durationMs: number;
}

export interface ObservationHistoryProps {
  className?: string;
}

export function ObservationHistory({ className }: ObservationHistoryProps) {
  const events = useEventStore((s) => s.events);

  const rows = useMemo<ObservationRow[]>(() => {
    return events
      .filter((e) => e.type === 'cost.observation_recorded')
      .slice(-30)
      .reverse()
      .map((e) => {
        const p = e.payload as Record<string, unknown>;
        const sig = p.signature as
          | { methodologyId: string; model: string; inputSizeBucket: string }
          | undefined;
        return {
          id: e.id,
          timestamp: e.timestamp,
          methodologyId: sig?.methodologyId ?? 'unknown',
          model: sig?.model ?? 'unknown',
          inputSizeBucket: sig?.inputSizeBucket ?? '?',
          costUsd: (p.costUsd as number) ?? 0,
          durationMs: (p.durationMs as number) ?? 0,
        };
      });
  }, [events]);

  return (
    <div className={cn('rounded-card border border-bdr bg-abyss p-sp-4', className)}>
      <div className="flex items-center justify-between mb-sp-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-bio" />
          <span className="text-xs text-txt-dim font-medium">Recent Observations</span>
        </div>
        <span className="text-[0.55rem] text-txt-muted font-mono">{rows.length} live</span>
      </div>

      {rows.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <p className="text-xs text-txt-muted">
            No observations yet — run a strategy to see cost data
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-bdr">
                <th className="text-left font-medium text-txt-dim py-2 pr-3">Methodology</th>
                <th className="text-left font-medium text-txt-dim py-2 pr-3">Model</th>
                <th className="text-left font-medium text-txt-dim py-2 pr-3">Size</th>
                <th className="text-right font-medium text-txt-dim py-2 pr-3">Cost</th>
                <th className="text-right font-medium text-txt-dim py-2 pr-3">Duration</th>
                <th className="text-right font-medium text-txt-dim py-2">Age</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-bdr/50 hover:bg-abyss-light/30 transition-colors"
                >
                  <td className="py-2 pr-3 text-txt font-mono">{r.methodologyId}</td>
                  <td className="py-2 pr-3 text-txt-dim font-mono truncate max-w-[140px]">
                    {r.model}
                  </td>
                  <td className="py-2 pr-3">
                    <SizeBadge size={r.inputSizeBucket} />
                  </td>
                  <td className="py-2 pr-3 text-right text-txt font-mono font-semibold">
                    ${r.costUsd.toFixed(3)}
                  </td>
                  <td className="py-2 pr-3 text-right text-txt-dim font-mono">
                    {formatDuration(r.durationMs)}
                  </td>
                  <td className="py-2 text-right text-txt-muted font-mono text-[0.65rem]">
                    {formatRelativeTime(r.timestamp)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SizeBadge({ size }: { size: string }) {
  const colorMap: Record<string, string> = {
    xs: 'text-bio-dim bg-bio/5 border-bio/20',
    s: 'text-bio bg-bio/10 border-bio/30',
    m: 'text-cyan bg-cyan/10 border-cyan/30',
    l: 'text-solar bg-solar/10 border-solar/30',
    xl: 'text-error bg-error/10 border-error/30',
  };
  const color = colorMap[size] ?? 'text-txt-muted border-bdr';
  return (
    <span
      className={cn(
        'font-mono text-[0.55rem] font-semibold px-1.5 py-0.5 rounded border uppercase',
        color,
      )}
    >
      {size}
    </span>
  );
}
