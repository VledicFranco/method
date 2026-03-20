/**
 * PRD 019.3: Strategy detail page at /app/strategies/:id.
 *
 * Renders the full strategy definition structurally, with node list,
 * trigger configuration, oversight rules, execution history,
 * and an Execute Now button.
 *
 * Links to /viz/:execId for live DAG view (future absorption).
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
import { MiniDag } from '@/components/domain/MiniDag';
import {
  useStrategyDefinitions,
  useStrategyExecutions,
  useExecuteStrategy,
} from '@/hooks/useStrategies';
import { formatCost, formatDuration, formatRelativeTime } from '@/lib/formatters';
import { ArrowLeft, Play } from 'lucide-react';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'yaml', label: 'YAML' },
  { id: 'history', label: 'History' },
];

export default function StrategyDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: defData, isLoading: defsLoading } = useStrategyDefinitions();
  const { data: executions } = useStrategyExecutions();
  const executeMutation = useExecuteStrategy();
  const [activeTab, setActiveTab] = useState('overview');

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

  const handleExecute = useCallback(() => {
    if (!definition) return;
    const defaults: Record<string, unknown> = {};
    for (const ci of definition.context_inputs) {
      defaults[ci.name] = ci.default ?? '';
    }
    executeMutation.mutate({
      strategy_path: `.method/strategies/${definition.file_path}`,
      context_inputs: defaults,
    });
  }, [definition, executeMutation]);

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
            onClick={handleExecute}
            loading={executeMutation.isPending}
          >
            Execute Now
          </Button>
        </div>
      }
    >
      {/* Header info */}
      <div className="flex items-start gap-sp-6 mb-sp-6">
        <MiniDag
          nodes={definition.nodes}
          gates={definition.strategy_gates}
          lastStatus={definition.last_execution?.status}
          className="shrink-0"
        />
        <div className="flex-1 min-w-0">
          <p className="font-mono text-sm text-bio mb-1">{definition.id}</p>
          <p className="text-xs text-txt-dim">v{definition.version}</p>
          <div className="flex flex-wrap gap-1 mt-sp-2">
            {definition.triggers.map((t, i) => (
              <Badge key={i} variant="default" label={t.type} />
            ))}
          </div>
        </div>

        {/* Metrics */}
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
        <div className="rounded-card border border-bdr bg-abyss p-sp-5 overflow-auto">
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
                  <span className="font-mono text-xs text-txt truncate max-w-[300px]">
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
    </PageShell>
  );
}
