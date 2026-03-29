import { PageShell } from '@/shared/layout/PageShell';
import { useGenesisPageContext } from '@/domains/genesis/useGenesisPageContext';

export default function Analytics() {
  useGenesisPageContext('analytics', {});
  return (
    <PageShell breadcrumbs={[{ label: 'Analytics' }]} wide>
      <div className="flex items-center justify-center h-64 rounded-card border border-bdr bg-abyss">
        <p className="text-txt-dim text-sm">Analytics — Coming Soon</p>
      </div>
    </PageShell>
  );
}
