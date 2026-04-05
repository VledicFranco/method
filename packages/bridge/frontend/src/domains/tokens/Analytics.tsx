import { PageShell } from '@/shared/layout/PageShell';
import { useGenesisPageContext } from '@/domains/genesis/useGenesisPageContext';
import { KpiRow } from '@/domains/cost-governor/KpiRow';
import { UtilizationPanel } from '@/domains/cost-governor/UtilizationPanel';
import { CostEventStream } from '@/domains/cost-governor/CostEventStream';
import { ObservationHistory } from '@/domains/cost-governor/ObservationHistory';
import { SubscriptionMeters } from '@/domains/tokens/SubscriptionMeters';

export default function Analytics() {
  useGenesisPageContext('analytics', {});
  return (
    <PageShell breadcrumbs={[{ label: 'Analytics' }]} wide>
      <div className="space-y-sp-4">
        {/* Header */}
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-lg font-semibold text-txt">Cost Governor</h1>
            <p className="text-xs text-txt-dim mt-0.5">
              Rate utilization, cost observations, and subscription telemetry
            </p>
          </div>
        </div>

        {/* KPI cards */}
        <KpiRow />

        {/* Utilization + Cost event stream — 2 column grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-sp-4">
          <UtilizationPanel />
          <CostEventStream />
        </div>

        {/* Subscription meters */}
        <SubscriptionMeters />

        {/* Observation history table */}
        <ObservationHistory />
      </div>
    </PageShell>
  );
}
