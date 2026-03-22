/**
 * PRD 019.3: Strategy detail page at /app/strategies/:id.
 *
 * Full-page strategy view with:
 * - Header: mini-DAG, strategy info, metrics, execute button
 * - Tabs: Overview (structured fields), YAML (syntax highlighted), History (filtered executions)
 * - Execute confirmation dialog with context inputs form
 */

import { useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PageShell } from '@/components/layout/PageShell';
import { Tabs } from '@/components/ui/Tabs';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { StatusBadge, type Status } from '@/components/data/StatusBadge';
import { MetricCard } from '@/components/data/MetricCard';
import { StrategyDefinitionPanel } from '@/components/domain/StrategyDefinitionPanel';
import { ExecuteDialog } from '@/components/domain/ExecuteDialog';
import { MiniDag } from '@/components/domain/MiniDag';
import { cn } from '@/lib/cn';
import {
  useStrategyDefinitions,
  useStrategyExecutions,
  useExecuteStrategy,
} from '@/hooks/useStrategies';
import { formatCost, formatDuration, formatRelativeTime } from '@/lib/formatters';
import type { StrategyDefinition } from '@/lib/types';
import { ArrowLeft, Play } from 'lucide-react';

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
            onClick={() => navigate('/app/strategies')}
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
            onClick={() => navigate('/app/strategies')}
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
        <div className="space-y-sp-3">
          {strategyExecutions.length === 0 ? (
            <Card>
              <p className="text-txt-dim text-sm text-center py-sp-4">
                No executions yet.
              </p>
            </Card>
          ) : (
            strategyExecutions.map((exec) => (
              <Card key={exec.execution_id} variant="interactive">
                <div className="flex items-center justify-between mb-sp-2">
                  <span
                    className="font-mono text-xs text-txt truncate max-w-[300px]"
                    title={exec.execution_id}
                  >
                    {exec.execution_id}
                  </span>
                  <StatusBadge status={exec.status as Status} />
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
            ))
          )}
        </div>
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
