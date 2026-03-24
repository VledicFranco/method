/**
 * PRD 019.3: Strategy detail page at /strategies/:id.
 *
 * Full-page strategy view with:
 * - Header: mini-DAG, strategy info, metrics, execute button
 * - Tabs: Overview (structured fields), YAML (syntax highlighted), History (filtered executions)
 * - Execute confirmation dialog with context inputs form
 */

import { useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PageShell } from '@/shared/layout/PageShell';
import { Tabs } from '@/shared/components/Tabs';
import { Button } from '@/shared/components/Button';
import { Badge } from '@/shared/components/Badge';
import { Card } from '@/shared/components/Card';
import { StatusBadge, type Status } from '@/shared/data/StatusBadge';
import { MetricCard } from '@/shared/data/MetricCard';
import { StrategyDefinitionPanel } from '@/domains/strategies/StrategyDefinitionPanel';
import { ExecuteDialog } from '@/domains/strategies/ExecuteDialog';
import { MiniDag } from '@/domains/strategies/MiniDag';
import { cn } from '@/shared/lib/cn';
import {
  useStrategyDefinitions,
  useStrategyExecutions,
  useExecuteStrategy,
} from '@/domains/strategies/useStrategies';
import { formatCost, formatDuration, formatRelativeTime } from '@/shared/lib/formatters';
import type { StrategyExecution } from '@/domains/strategies/types';
import { ArrowLeft, Play, GitCompare, ExternalLink } from 'lucide-react';

// ── Toast notification ──

interface ToastState {
  message: string;
  variant: 'success' | 'error';
  visible: boolean;
}

// ── Tab config ──

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'yaml', label: 'YAML' },
  { id: 'history', label: 'History' },
];

// ── Comparison Panel ──

function ComparisonPanel({
  executions,
  compareIds,
}: {
  executions: StrategyExecution[];
  compareIds: string[];
}) {
  const [a, b] = compareIds.map((eid) => executions.find((e) => e.execution_id === eid));
  if (!a || !b) return null;

  const costDelta = b.cost_usd - a.cost_usd;
  const costPct = a.cost_usd > 0 ? ((costDelta / a.cost_usd) * 100) : 0;

  return (
    <Card className="mt-sp-4">
      <div className="flex items-center gap-2 mb-sp-3">
        <GitCompare className="h-4 w-4 text-bio" />
        <h3 className="text-sm text-txt font-medium">Execution Comparison</h3>
      </div>

      <div className="grid grid-cols-3 gap-sp-4 text-xs">
        <div />
        <div className="font-mono text-txt-muted truncate text-center" title={a.execution_id}>
          {a.execution_id.slice(0, 16)}...
        </div>
        <div className="font-mono text-txt-muted truncate text-center" title={b.execution_id}>
          {b.execution_id.slice(0, 16)}...
        </div>

        {/* Status */}
        <div className="text-txt-dim">Status</div>
        <div className="text-center"><StatusBadge status={a.status as Status} size="sm" /></div>
        <div className="text-center"><StatusBadge status={b.status as Status} size="sm" /></div>

        {/* Cost */}
        <div className="text-txt-dim">Cost</div>
        <div className="font-mono text-center text-txt">{formatCost(a.cost_usd)}</div>
        <div className="font-mono text-center">
          <span className="text-txt">{formatCost(b.cost_usd)}</span>
          {costDelta !== 0 && (
            <span className={cn('ml-1', costDelta > 0 ? 'text-error' : 'text-bio')}>
              ({costDelta > 0 ? '+' : ''}{costPct.toFixed(0)}%)
            </span>
          )}
        </div>

        {/* Started */}
        <div className="text-txt-dim">Started</div>
        <div className="font-mono text-center text-txt-dim">{formatRelativeTime(a.started_at)}</div>
        <div className="font-mono text-center text-txt-dim">{formatRelativeTime(b.started_at)}</div>
      </div>
    </Card>
  );
}

// ── History Tab ──

function HistoryTab({
  executions,
  strategyId,
  compareIds,
  onCompareToggle,
  onClearCompare,
}: {
  executions: StrategyExecution[];
  strategyId: string;
  compareIds: string[];
  onCompareToggle: (eid: string) => void;
  onClearCompare: () => void;
}) {
  const navigate = useNavigate();

  return (
    <div className="space-y-sp-3">
      {/* Compare toolbar */}
      {executions.length >= 2 && (
        <div className="flex items-center justify-between mb-sp-2">
          <p className="text-[0.65rem] text-txt-muted">
            {compareIds.length === 0
              ? 'Select 2 executions to compare'
              : `${compareIds.length}/2 selected`}
          </p>
          {compareIds.length > 0 && (
            <Button variant="ghost" size="sm" onClick={onClearCompare}>
              Clear
            </Button>
          )}
        </div>
      )}

      {/* Comparison panel */}
      {compareIds.length === 2 && (
        <ComparisonPanel executions={executions} compareIds={compareIds} />
      )}

      {executions.length === 0 ? (
        <Card>
          <p className="text-txt-dim text-sm text-center py-sp-4">
            No executions yet.
          </p>
        </Card>
      ) : (
        executions.map((exec) => {
          const isSelected = compareIds.includes(exec.execution_id);
          return (
            <Card key={exec.execution_id} variant="interactive" selected={isSelected}>
              <div className="flex items-center justify-between mb-sp-2">
                <div className="flex items-center gap-2 min-w-0">
                  {executions.length >= 2 && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onCompareToggle(exec.execution_id)}
                      className="shrink-0 accent-bio"
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                  <span
                    className="font-mono text-xs text-txt truncate max-w-[260px]"
                    title={exec.execution_id}
                  >
                    {exec.execution_id}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge status={exec.status as Status} size="sm" />
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<ExternalLink className="h-3 w-3" />}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/strategies/${strategyId}/exec/${exec.execution_id}`);
                    }}
                  >
                    DAG
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-sp-4 text-xs text-txt-dim font-mono">
                <span>{formatRelativeTime(exec.started_at)}</span>
                {exec.cost_usd > 0 && <span>{formatCost(exec.cost_usd)}</span>}
              </div>
              {exec.retro_path && (
                <p className="text-[0.7rem] text-bio mt-sp-2 font-mono truncate">
                  retro: {exec.retro_path}
                </p>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}

// ── Page Component ──

export default function StrategyDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: defData, isLoading: defsLoading } = useStrategyDefinitions();
  const { data: executions } = useStrategyExecutions();
  const executeMutation = useExecuteStrategy();
  const [activeTab, setActiveTab] = useState('overview');
  const [executeDialogOpen, setExecuteDialogOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);

  const definition = useMemo(
    () => defData?.definitions.find((d) => d.id === id) ?? null,
    [defData, id],
  );

  const strategyExecutions = useMemo(
    () =>
      (executions ?? [])
        .filter((e) => e.strategy_id === id)
        .sort(
          (a, b) =>
            new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
        ),
    [executions, id],
  );

  const showToast = useCallback((message: string, variant: 'success' | 'error') => {
    setToast({ message, variant, visible: true });
    setTimeout(() => setToast(null), 5000);
  }, []);

  const handleExecute = useCallback(
    (inputs: Record<string, unknown>) => {
      if (!definition) return;
      executeMutation.mutate(
        {
          strategy_path: `.method/strategies/${definition.file_path}`,
          context_inputs: inputs,
        },
        {
          onSuccess: (data) => {
            setExecuteDialogOpen(false);
            showToast(
              `Strategy "${definition.name}" started (${data.execution_id})`,
              'success',
            );
          },
          onError: (error) => {
            showToast(
              `Failed to execute: ${(error as Error).message}`,
              'error',
            );
          },
        },
      );
    },
    [definition, executeMutation, showToast],
  );

  if (defsLoading) {
    return (
      <PageShell title="Strategy Detail" wide>
        <div className="h-64 rounded-card bg-abyss-light/50 animate-pulse border border-bdr" />
      </PageShell>
    );
  }

  if (!definition) {
    return (
      <PageShell title="Strategy Not Found" wide>
        <Card>
          <p className="text-txt-dim text-sm">
            Strategy <span className="font-mono text-bio">{id}</span> not found in
            definitions.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-sp-4"
            leftIcon={<ArrowLeft className="h-3.5 w-3.5" />}
            onClick={() => navigate('/strategies')}
          >
            Back to Strategies
          </Button>
        </Card>
      </PageShell>
    );
  }

  const isRunning =
    definition.last_execution?.status === 'running' ||
    definition.last_execution?.status === 'started';

  return (
    <PageShell
      title={definition.name}
      wide
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<ArrowLeft className="h-3.5 w-3.5" />}
            onClick={() => navigate('/strategies')}
          >
            Back
          </Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Play className="h-3.5 w-3.5" />}
            onClick={() => setExecuteDialogOpen(true)}
            loading={executeMutation.isPending}
          >
            Execute Now
          </Button>
        </div>
      }
    >
      {/* Header info row */}
      <div className="flex items-start gap-sp-6 mb-sp-6">
        {/* Mini-DAG thumbnail */}
        <MiniDag
          nodes={definition.nodes}
          gates={definition.strategy_gates}
          lastStatus={definition.last_execution?.status}
          className="shrink-0"
        />

        {/* Strategy identity */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="font-mono text-sm text-bio">{definition.id}</p>
            {isRunning && (
              <StatusBadge status="running" />
            )}
            {definition.last_execution && !isRunning && (
              <StatusBadge status={definition.last_execution.status as Status} />
            )}
          </div>
          <p className="text-xs text-txt-dim mb-sp-2">v{definition.version}</p>

          {/* Trigger + node type badges */}
          <div className="flex flex-wrap gap-1">
            {definition.triggers.map((t, i) => (
              <Badge
                key={i}
                variant={
                  t.type === 'manual'
                    ? 'muted'
                    : t.type === 'file_watch'
                      ? 'solar'
                      : t.type === 'git_commit'
                        ? 'nebular'
                        : 'bio'
                }
                label={t.type}
              />
            ))}
            {definition.nodes.filter((n) => n.type === 'methodology').length > 0 && (
              <Badge
                variant="nebular"
                label={`${definition.nodes.filter((n) => n.type === 'methodology').length} methodology`}
              />
            )}
            {definition.nodes.filter((n) => n.type === 'script').length > 0 && (
              <Badge
                variant="bio"
                label={`${definition.nodes.filter((n) => n.type === 'script').length} script`}
              />
            )}
          </div>
        </div>

        {/* Metric cards */}
        {definition.last_execution && (
          <div className="flex gap-sp-3 shrink-0">
            <MetricCard
              label="Last Cost"
              value={formatCost(definition.last_execution.cost_usd)}
              className="min-w-[120px]"
            />
            <MetricCard
              label="Last Duration"
              value={
                definition.last_execution.duration_ms > 0
                  ? formatDuration(definition.last_execution.duration_ms)
                  : '--'
              }
              className="min-w-[120px]"
            />
            <MetricCard
              label="Executions"
              value={strategyExecutions.length}
              className="min-w-[100px]"
            />
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs
        tabs={TABS.map((t) => ({
          ...t,
          count: t.id === 'history' ? strategyExecutions.length : undefined,
        }))}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        className="mb-sp-6"
      />

      {/* Tab content */}
      {activeTab === 'overview' && (
        <StrategyDefinitionPanel definition={definition} />
      )}

      {activeTab === 'yaml' && (
        <div className="rounded-card border border-bdr bg-abyss p-sp-5 overflow-auto max-h-[70vh]">
          <pre className="text-[0.75rem] text-txt-dim font-mono whitespace-pre-wrap leading-relaxed">
            {definition.raw_yaml}
          </pre>
        </div>
      )}

      {activeTab === 'history' && (
        <HistoryTab
          executions={strategyExecutions}
          strategyId={id!}
          compareIds={compareIds}
          onCompareToggle={(eid) => {
            setCompareIds((prev) => {
              if (prev.includes(eid)) return prev.filter((x) => x !== eid);
              if (prev.length >= 2) return [prev[1], eid];
              return [...prev, eid];
            });
          }}
          onClearCompare={() => setCompareIds([])}
        />
      )}

      {/* Execute dialog */}
      <ExecuteDialog
        key={definition.id}
        definition={definition}
        open={executeDialogOpen}
        onClose={() => setExecuteDialogOpen(false)}
        onExecute={handleExecute}
        loading={executeMutation.isPending}
      />

      {/* Toast Notification */}
      {toast?.visible && (
        <div
          className={cn(
            'fixed bottom-6 right-6 z-50 max-w-sm rounded-card border px-sp-4 py-sp-3 shadow-xl',
            'animate-slide-in-left',
            toast.variant === 'error'
              ? 'bg-error-dim border-error/30'
              : 'bg-abyss border-bio/30',
          )}
        >
          <p className={cn(
            'text-sm',
            toast.variant === 'error' ? 'text-error' : 'text-txt',
          )}>
            {toast.message}
          </p>
        </div>
      )}
    </PageShell>
  );
}
