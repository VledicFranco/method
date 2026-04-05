/**
 * CostEventStream — live stream of cost.* events from the Universal Event Bus.
 * Subscribes to the global event store and filters for domain='cost'.
 */

import { useMemo } from 'react';
import { Activity, DollarSign, AlertTriangle, Zap, TrendingUp, Clock } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { useEventStore, type BridgeEvent } from '@/shared/stores/event-store';
import { formatRelativeTime } from '@/shared/lib/formatters';

const MAX_VISIBLE = 25;

function iconFor(type: string) {
  if (type.includes('observation_recorded')) return DollarSign;
  if (type.includes('rate_limited')) return AlertTriangle;
  if (type.includes('saturated')) return AlertTriangle;
  if (type.includes('slot_leaked')) return AlertTriangle;
  if (type.includes('estimate')) return TrendingUp;
  if (type.includes('observations_corrupted')) return AlertTriangle;
  if (type.includes('integrity_violation')) return AlertTriangle;
  return Activity;
}

function colorFor(severity: BridgeEvent['severity']): string {
  switch (severity) {
    case 'critical':
    case 'error':
      return 'text-error';
    case 'warning':
      return 'text-solar';
    default:
      return 'text-bio';
  }
}

function labelFor(type: string): string {
  // cost.observation_recorded → Observation recorded
  const parts = type.split('.');
  const label = parts[parts.length - 1].replace(/_/g, ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function renderPayloadSummary(event: BridgeEvent): string | null {
  const p = event.payload as Record<string, unknown>;
  if (event.type === 'cost.observation_recorded') {
    const cost = p.costUsd as number | undefined;
    const duration = p.durationMs as number | undefined;
    if (cost !== undefined && duration !== undefined) {
      return `$${cost.toFixed(3)} · ${Math.round(duration / 1000)}s`;
    }
  }
  if (event.type === 'cost.rate_limited') {
    const retryMs = p.retryAfterMs as number | undefined;
    return retryMs ? `retry in ${Math.round(retryMs / 1000)}s` : 'retry later';
  }
  if (event.type === 'cost.account_saturated') {
    const window = p.window as string | undefined;
    const pct = p.usedPct as number | undefined;
    return `${window} ${pct?.toFixed(0)}%`;
  }
  if (event.type === 'cost.estimate_emitted') {
    const p50 = p.totalCostP50Usd as number | undefined;
    const p90 = p.totalCostP90Usd as number | undefined;
    if (p50 !== undefined && p90 !== undefined) {
      return `p50 $${p50.toFixed(2)} / p90 $${p90.toFixed(2)}`;
    }
  }
  if (event.type === 'cost.slot_leaked') {
    const age = p.ageMs as number | undefined;
    return age ? `leaked after ${Math.round(age / 1000)}s` : null;
  }
  return null;
}

export interface CostEventStreamProps {
  className?: string;
}

export function CostEventStream({ className }: CostEventStreamProps) {
  const { events, connected } = useEventStore((s) => ({
    events: s.events,
    connected: s.connected,
  }));

  const costEvents = useMemo(
    () =>
      events
        .filter((e) => e.domain === 'cost' || e.type.startsWith('cost.'))
        .slice(-MAX_VISIBLE)
        .reverse(),
    [events],
  );

  return (
    <div className={cn('rounded-card border border-bdr bg-abyss p-sp-4 flex flex-col', className)}>
      <div className="flex items-center justify-between mb-sp-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-bio" />
          <span className="text-xs text-txt-dim font-medium">Cost Event Stream</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              connected ? 'bg-bio animate-pulse-glow' : 'bg-txt-muted',
            )}
          />
          <span className="text-[0.55rem] text-txt-muted font-mono">
            {connected ? 'LIVE' : 'DISCONNECTED'}
          </span>
        </div>
      </div>

      {costEvents.length === 0 ? (
        <div className="flex-1 flex items-center justify-center min-h-[200px]">
          <p className="text-xs text-txt-muted">No cost events yet</p>
        </div>
      ) : (
        <div className="space-y-1 overflow-y-auto max-h-[400px] pr-1">
          {costEvents.map((event) => {
            const Icon = iconFor(event.type);
            const summary = renderPayloadSummary(event);
            return (
              <div
                key={event.id}
                className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-abyss-light/50 transition-colors group"
              >
                <Icon className={cn('h-3 w-3 shrink-0', colorFor(event.severity))} />
                <div className="flex-1 min-w-0 flex items-baseline gap-2">
                  <span className="text-xs text-txt truncate">{labelFor(event.type)}</span>
                  {summary && (
                    <span className="font-mono text-[0.65rem] text-txt-dim truncate">
                      {summary}
                    </span>
                  )}
                </div>
                <span className="font-mono text-[0.55rem] text-txt-muted shrink-0">
                  {formatRelativeTime(event.timestamp)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
