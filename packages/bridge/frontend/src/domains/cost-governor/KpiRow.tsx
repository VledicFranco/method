/**
 * KpiRow — 4 top-level metric cards derived from utilization + event stream.
 *
 *   [Burst %]    [Weekly %]    [In-Flight]    [Total Cost Today]
 */

import { useMemo } from 'react';
import { MetricCard } from '@/shared/data/MetricCard';
import { CostSparkline } from './CostSparkline';
import { useUtilization } from './useCostGovernor';
import { useEventStore } from '@/shared/stores/event-store';

export interface KpiRowProps {
  className?: string;
}

export function KpiRow({ className }: KpiRowProps) {
  const { data: util } = useUtilization();
  const events = useEventStore((s) => s.events);

  const stats = useMemo(() => {
    const obsEvents = events.filter((e) => e.type === 'cost.observation_recorded');
    const rateLimits = events.filter((e) => e.type === 'cost.rate_limited').length;

    // Extract cost values, newest last for sparkline
    const costs = obsEvents
      .map((e) => (e.payload as { costUsd?: number }).costUsd ?? 0)
      .filter((c) => c > 0);

    // Today's total (observations since 00:00 local)
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const todayTotal = obsEvents
      .filter((e) => new Date(e.timestamp).getTime() >= midnight.getTime())
      .reduce((sum, e) => sum + ((e.payload as { costUsd?: number }).costUsd ?? 0), 0);

    return {
      obsCount: obsEvents.length,
      rateLimitCount: rateLimits,
      costSparkline: costs.slice(-20),
      todayTotal,
    };
  }, [events]);

  const account = util?.accounts[0];
  const burstPct = account?.burstWindowUsedPct ?? 0;
  const weeklyPct = account?.weeklyUsedPct ?? 0;
  const inFlight = account?.inFlightCount ?? 0;

  return (
    <div className={className}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-sp-3">
        <MetricCard
          label="Burst Window"
          value={`${burstPct.toFixed(0)}%`}
          trendValue="5h"
          trend={burstPct >= 90 ? 'up' : burstPct >= 60 ? 'flat' : 'down'}
        />
        <MetricCard
          label="Weekly Cap"
          value={`${weeklyPct.toFixed(0)}%`}
          trendValue="7d"
          trend={weeklyPct >= 90 ? 'up' : weeklyPct >= 60 ? 'flat' : 'down'}
        />
        <MetricCard
          label="In-Flight"
          value={inFlight}
          trendValue={stats.rateLimitCount > 0 ? `${stats.rateLimitCount} 429s` : 'slots'}
          trend={stats.rateLimitCount > 0 ? 'up' : 'flat'}
        />
        <MetricCard
          label="Today's Cost"
          value={`$${stats.todayTotal.toFixed(2)}`}
          trendValue={`${stats.obsCount} obs`}
          sparkline={
            stats.costSparkline.length > 0 ? (
              <CostSparkline data={stats.costSparkline} />
            ) : undefined
          }
        />
      </div>
    </div>
  );
}
