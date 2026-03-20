import type { ExecutionStatus } from '../lib/types';
import { StatusBadge } from './StatusBadge';

interface CostDashboardProps {
  strategyName: string;
  status: ExecutionStatus;
  costUsd: number;
  nodeCount: number;
  completedCount: number;
  failedCount: number;
  durationMs?: number;
  panelOpen: boolean;
}

function formatCost(usd: number): string {
  if (usd < 0.001) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

export function CostDashboard({
  status,
  costUsd,
  nodeCount,
  completedCount,
  failedCount,
  durationMs,
  panelOpen,
}: CostDashboardProps) {
  const costClass =
    costUsd > 5
      ? 'cost-dashboard__value cost-dashboard__value--danger'
      : costUsd > 1
        ? 'cost-dashboard__value cost-dashboard__value--warn'
        : 'cost-dashboard__value';

  const dashClass = `cost-dashboard${panelOpen ? ' cost-dashboard--panel-open' : ''}`;

  return (
    <div className={dashClass}>
      <div className="cost-dashboard__title">Execution</div>

      <div className="cost-dashboard__row">
        <span className="cost-dashboard__label">Cost</span>
        <span className={costClass}>{formatCost(costUsd)}</span>
      </div>

      <div className="cost-dashboard__row">
        <span className="cost-dashboard__label">Nodes</span>
        <span className="cost-dashboard__value">
          {completedCount}/{nodeCount}
          {failedCount > 0 && (
            <span style={{ color: 'var(--solar)', marginLeft: 4 }}>
              ({failedCount} failed)
            </span>
          )}
        </span>
      </div>

      {durationMs != null && (
        <div className="cost-dashboard__row">
          <span className="cost-dashboard__label">Duration</span>
          <span className="cost-dashboard__value">
            {formatDuration(durationMs)}
          </span>
        </div>
      )}

      <div className="cost-dashboard__status">
        <StatusBadge status={status} />
      </div>
    </div>
  );
}
