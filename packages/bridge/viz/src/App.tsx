import { useState, useMemo, useCallback } from 'react';
import type { ViewMode } from './lib/types';
import { StrategyDag } from './components/StrategyDag';
import { ViewSelector } from './components/ViewSelector';
import { CostDashboard } from './components/CostDashboard';
import { useStrategyDag, useExecutionList } from './hooks/useStrategyData';
import { useLiveExecution } from './hooks/useLiveExecution';
import { StatusBadge } from './components/StatusBadge';

/**
 * Extract execution ID from the URL path.
 * Expects: /viz/exec-... or /viz/live/exec-...
 */
function getExecutionIdFromUrl(): string | null {
  const path = window.location.pathname;
  const match = path.match(/\/viz\/(?:live\/)?(exec-[^\s/]+)/);
  return match ? match[1] : null;
}

/** Determine initial view from URL */
function getInitialView(): ViewMode {
  const path = window.location.pathname;
  if (path.includes('/live/')) return 'live';
  if (getExecutionIdFromUrl()) return 'live';
  return 'definition';
}

// ── Execution List View ────────────────────────────────────────

function ExecutionListView() {
  const { executions, loading, error } = useExecutionList();

  if (loading) {
    return (
      <div className="empty-state">
        <div className="spinner" style={{ width: 24, height: 24 }} />
        <div className="empty-state__subtitle">Loading executions...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-state__title">Connection Error</div>
        <div className="empty-state__subtitle">
          Could not connect to the bridge API. Make sure the bridge is running.
        </div>
        <div className="empty-state__url">Error: {error}</div>
      </div>
    );
  }

  if (executions.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state__title">No Executions</div>
        <div className="empty-state__subtitle">
          No strategy executions found. Start a strategy execution using the
          bridge API or MCP tools.
        </div>
        <div className="empty-state__url">
          POST /strategies/execute
        </div>
      </div>
    );
  }

  return (
    <div className="exec-list">
      <div className="exec-list__title">Strategy Executions</div>
      {executions.map((exec) => (
        <a
          key={exec.execution_id}
          className="exec-list__item"
          href={`/viz/${exec.execution_id}`}
        >
          <div>
            <div className="exec-list__item-name">{exec.strategy_name}</div>
            <div className="exec-list__item-id">{exec.execution_id}</div>
          </div>
          <div className="exec-list__item-meta">
            <StatusBadge status={exec.status} />
            <div className="exec-list__item-cost">
              ${exec.cost_usd.toFixed(4)}
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}

// ── DAG View (Definition or Live) ──────────────────────────────

function DagView({
  executionId,
  view,
}: {
  executionId: string;
  view: ViewMode;
}) {
  const { dag, loading: dagLoading, error: dagError } = useStrategyDag(executionId);
  const { data: execution, error: execError } = useLiveExecution(
    view === 'live' ? executionId : null,
  );

  // Compute dashboard stats
  const stats = useMemo(() => {
    if (!dag) return null;

    const nodeStatuses = execution?.node_statuses ?? {};
    const totalNodes = dag.nodes.length;
    const completedCount = Object.values(nodeStatuses).filter(
      (s) => s === 'completed',
    ).length;
    const failedCount = Object.values(nodeStatuses).filter(
      (s) => s === 'failed' || s === 'gate_failed',
    ).length;

    const now = Date.now();
    const startedAt = execution?.started_at
      ? new Date(execution.started_at).getTime()
      : now;
    const durationMs = execution?.duration_ms ?? (now - startedAt);

    return {
      nodeCount: totalNodes,
      completedCount,
      failedCount,
      durationMs,
    };
  }, [dag, execution]);

  if (dagLoading) {
    return (
      <div className="empty-state">
        <div className="spinner" style={{ width: 24, height: 24 }} />
        <div className="empty-state__subtitle">Loading strategy DAG...</div>
      </div>
    );
  }

  if (dagError || execError) {
    return (
      <div className="empty-state">
        <div className="empty-state__title">Error</div>
        <div className="empty-state__subtitle">{dagError ?? execError}</div>
      </div>
    );
  }

  if (!dag) {
    return (
      <div className="empty-state">
        <div className="empty-state__title">No DAG Data</div>
        <div className="empty-state__subtitle">
          The strategy DAG could not be loaded for this execution.
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Strategy header */}
      <div className="strategy-header">
        <div className="strategy-header__name">{dag.name}</div>
        <div className="strategy-header__id">
          {dag.id} v{dag.version}
          {execution && (
            <span> &mdash; {executionId}</span>
          )}
        </div>
      </div>

      {/* Cost dashboard (only in live view with execution data) */}
      {execution && stats && (
        <CostDashboard
          strategyName={dag.name}
          status={execution.status}
          costUsd={execution.cost_usd}
          nodeCount={stats.nodeCount}
          completedCount={stats.completedCount}
          failedCount={stats.failedCount}
          durationMs={stats.durationMs}
          panelOpen={false}
        />
      )}

      {/* DAG canvas */}
      <div style={{ width: '100vw', height: '100vh' }}>
        <StrategyDag dag={dag} execution={execution} />
      </div>
    </>
  );
}

// ── Main App ───────────────────────────────────────────────────

export function App() {
  const [view, setView] = useState<ViewMode>(getInitialView);
  const executionId = useMemo(getExecutionIdFromUrl, []);

  const handleViewChange = useCallback((newView: ViewMode) => {
    setView(newView);
  }, []);

  // If we have an execution ID, show the DAG view
  const showDag = executionId !== null;

  return (
    <>
      <ViewSelector current={view} onChange={handleViewChange} />

      {showDag ? (
        <DagView executionId={executionId} view={view} />
      ) : (
        <ExecutionListView />
      )}
    </>
  );
}
