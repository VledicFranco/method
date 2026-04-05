/**
 * AnalyticsView — Cross-build analytics tab content.
 *
 * Four sections: phase bottleneck chart, failure patterns,
 * refinement list with filters, and cost trend sparkline.
 *
 * Fetches analytics data from /api/builds/analytics and passes
 * refinements to the RefinementList. Other charts use embedded
 * data until the backend computes aggregations.
 *
 * @see PRD 047 §Dashboard Architecture — Analytics Tab
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';
import { PhaseBottleneckChart } from './PhaseBottleneckChart';
import { FailurePatterns } from './FailurePatterns';
import { RefinementList } from './RefinementList';
import { CostTrend } from './CostTrend';
import type { Refinement } from './types';

interface AnalyticsResponse {
  totalBuilds: number;
  refinements: Refinement[];
}

export function AnalyticsView() {
  const { data } = useQuery({
    queryKey: ['build-analytics'],
    queryFn: async ({ signal }) => {
      return api.get<AnalyticsResponse>('/api/builds/analytics', signal);
    },
    retry: 1,
    refetchInterval: 60_000,
  });

  return (
    <div>
      {data && (
        <div className="text-[11px] font-mono text-txt-dim mb-4">
          {data.totalBuilds} total build{data.totalBuilds !== 1 ? 's' : ''}
        </div>
      )}
      <PhaseBottleneckChart />
      <FailurePatterns />
      <RefinementList refinements={data?.refinements} />
      <CostTrend />
    </div>
  );
}
