/**
 * Bridge health metric cards — active sessions, total spawned, uptime, dead sessions.
 * Consumes GET /pool/stats.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';
import { MetricCard } from '@/shared/data/MetricCard';
import { formatDuration } from '@/shared/lib/formatters';
import { cn } from '@/shared/lib/cn';
import type { PoolStatsResponse } from '@/lib/types';

export interface BridgeHealthCardsProps {
  className?: string;
}

export function BridgeHealthCards({ className }: BridgeHealthCardsProps) {
  const { data: stats } = useQuery({
    queryKey: ['pool', 'stats'],
    queryFn: ({ signal }) => api.get<PoolStatsResponse>('/pool/stats', signal),
    refetchInterval: 5000,
  });

  if (!stats) {
    return (
      <div className={cn('grid grid-cols-2 md:grid-cols-4 gap-3', className)}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 rounded-card bg-abyss-light/50 animate-pulse border border-bdr" />
        ))}
      </div>
    );
  }

  return (
    <div className={cn('grid grid-cols-2 md:grid-cols-4 gap-3', className)}>
      <MetricCard
        label="Active Sessions"
        value={`${stats.active_count} / ${stats.max_sessions}`}
      />
      <MetricCard
        label="Total Spawned"
        value={stats.total_spawned}
      />
      <MetricCard
        label="Uptime"
        value={formatDuration(stats.uptime_ms)}
      />
      <MetricCard
        label="Dead Sessions"
        value={stats.dead_count}
      />
    </div>
  );
}
