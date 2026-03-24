/**
 * PRD 019.3: Strategies page — definition browser + execution history.
 *
 * Section 1: Strategy definition cards (2-column grid)
 * Section 2: Execution history timeline (grouped by time period)
 *
 * Cards are ordered: running > recently completed > never executed.
 * Clicking a card opens the detail slide-over panel.
 */

import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageShell } from '@/shared/layout/PageShell';
import { SlideOverPanel } from '@/shared/layout/SlideOverPanel';
import { Tabs } from '@/shared/components/Tabs';
import { Button } from '@/shared/components/Button';
import { StatusBadge, type Status } from '@/shared/data/StatusBadge';
import { TimelineEvent, type TimelineEventData } from '@/shared/data/TimelineEvent';
import { Badge } from '@/shared/components/Badge';
import { StrategyCard } from '@/domains/strategies/StrategyCard';
import { StrategyDefinitionPanel } from '@/domains/strategies/StrategyDefinitionPanel';
import { ExecuteDialog } from '@/domains/strategies/ExecuteDialog';
import { cn } from '@/shared/lib/cn';
import {
  useStrategyDefinitions,
  useStrategyExecutions,
  useExecuteStrategy,
} from '@/domains/strategies/useStrategies';
import { formatCost, formatRelativeTime } from '@/shared/lib/formatters';
import type { StrategyDefinition, StrategyExecution } from '@/domains/strategies/types';
import { Play, RefreshCw } from 'lucide-react';

// ── Sort helpers ──

function sortDefinitions(defs: StrategyDefinition[]): StrategyDefinition[] {
  return [...defs].sort((a, b) => {
    const aRunning = a.last_execution?.status === 'running' || a.last_execution?.status === 'started';
    const bRunning = b.last_execution?.status === 'running' || b.last_execution?.status === 'started';
    if (aRunning && !bRunning) return -1;
    if (!aRunning && bRunning) return 1;

    const aTime = a.last_execution?.started_at ? new Date(a.last_execution.started_at).getTime() : 0;
    const bTime = b.last_execution?.started_at ? new Date(b.last_execution.started_at).getTime() : 0;
    if (aTime !== bTime) return bTime - aTime;

    return a.id.localeCompare(b.id);
  });
}

// ── Time grouping for execution timeline ──

function getTimeGroup(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const eventDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (eventDay.getTime() === today.getTime()) return 'Today';
  if (eventDay.getTime() === yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function groupExecutionsByTime(
  executions: StrategyExecution[],
): Array<{ label: string; executions: StrategyExecution[] }> {
  const groups = new Map<string, StrategyExecution[]>();

  for (const exec of executions) {
    const label = getTimeGroup(exec.started_at);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(exec);
  }

  return Array.from(groups.entries()).map(([label, execs]) => ({ label, executions: execs }));
}

// ── Execution timeline event mapper ──

function executionToTimelineEvent(exec: StrategyExecution): TimelineEventData {
  const dotColor =
    exec.status === 'completed'
      ? 'bg-cyan'
      : exec.status === 'failed'
        ? 'bg-error'
        : exec.status === 'running' || exec.status === 'started'
          ? 'bg-bio'
          : 'bg-txt-muted';

  const contextParts: string[] = [];
  if (exec.cost_usd > 0) contextParts.push(formatCost(exec.cost_usd));

  return {
    id: exec.execution_id,
    type: 'strategy_execution',
    title: `${exec.strategy_id} — ${exec.strategy_name}`,
    context: contextParts.join(' | ') || undefined,
    timestamp: exec.started_at,
    dotColor,
  };
}

// ── Toast notification ──

interface ToastState {
  message: string;
  variant: 'success' | 'error';
  visible: boolean;
}

// ── Detail panel tabs ──

const DETAIL_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'yaml', label: 'YAML' },
  { id: 'history', label: 'History' },
];

// ── Main page ──

export default function Strategies() {
  const navigate = useNavigate();
  const { data: defData, isLoading: defsLoading, refetch: refetchDefs } = useStrategyDefinitions();
  const { data: executions, isLoading: execsLoading } = useStrategyExecutions();
  const executeMutation = useExecuteStrategy();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState('overview');
  const [executeDialogOpen, setExecuteDialogOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const definitions = useMemo(
    () => sortDefinitions(defData?.definitions ?? []),
    [defData],
  );

  const selectedDef = useMemo(
    () => definitions.find((d) => d.id === selectedId) ?? null,
    [definitions, selectedId],
  );

  // Filter executions for selected strategy
  const selectedExecutions = useMemo(
    () =>
      (executions ?? [])
        .filter((e) => selectedId && e.strategy_id === selectedId)
        .sort(
          (a, b) =>
            new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
        ),
    [executions, selectedId],
  );

  // All executions for timeline (newest first)
  const allExecutions = useMemo(
    () =>
      (executions ?? []).sort(
        (a, b) =>
          new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
      ),
    [executions],
  );

  // Group executions by time period for the timeline
  const timelineGroups = useMemo(
    () => groupExecutionsByTime(allExecutions),
    [allExecutions],
  );

  const showToast = useCallback((message: string, variant: 'success' | 'error') => {
    setToast({ message, variant, visible: true });
    setTimeout(() => setToast(null), 5000);
  }, []);

  const handleCardClick = useCallback(
    (id: string) => {
      setSelectedId((prev) => (prev === id ? null : id));
      setDetailTab('overview');
    },
    [],
  );

  const handleExecute = useCallback(
    (inputs: Record<string, unknown>) => {
      if (!selectedDef) return;
      executeMutation.mutate(
        {
          strategy_path: `.method/strategies/${selectedDef.file_path}`,
          context_inputs: inputs,
        },
        {
          onSuccess: (data) => {
            setExecuteDialogOpen(false);
            showToast(
              `Strategy "${selectedDef.name}" started (${data.execution_id})`,
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
    [selectedDef, executeMutation, showToast],
  );

  const handleViewDetail = useCallback(
    (id: string) => {
      navigate(`/strategies/${encodeURIComponent(id)}`);
    },
    [navigate],
  );

  const loading = defsLoading || execsLoading;

  return (
    <PageShell
      wide
      breadcrumbs={[{ label: 'Strategies' }]}
      actions={
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
          onClick={() => refetchDefs()}
        >
          Refresh
        </Button>
      }
    >
      {/* Section 1: Strategy Definition Cards */}
      <section className="mb-sp-8">
        <h2 className="font-display text-sm font-semibold text-txt-dim uppercase tracking-wider mb-sp-4">
          Definitions
          {definitions.length > 0 && (
            <span className="ml-2 text-txt-muted font-normal">({definitions.length})</span>
          )}
        </h2>

        {loading && definitions.length === 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-sp-4">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-40 rounded-card bg-abyss-light/50 animate-pulse border border-bdr"
              />
            ))}
          </div>
        ) : definitions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 rounded-card border border-bdr bg-abyss">
            <p className="text-txt-dim text-sm">
              No strategy definitions found in .method/strategies/
            </p>
            <p className="text-txt-muted text-xs mt-1">
              Add strategy YAML files and refresh.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-sp-4">
            {definitions.map((def, index) => (
              <div
                key={def.id}
                style={{ animationDelay: `${index * 100}ms` }}
                className="animate-slide-in-left"
              >
                <StrategyCard
                  definition={def}
                  selected={selectedId === def.id}
                  onClick={() => handleCardClick(def.id)}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Section 2: Execution History Timeline */}
      <section>
        <h2 className="font-display text-sm font-semibold text-txt-dim uppercase tracking-wider mb-sp-4">
          Execution History
          {allExecutions.length > 0 && (
            <span className="ml-2 text-txt-muted font-normal">({allExecutions.length})</span>
          )}
        </h2>

        {allExecutions.length === 0 ? (
          <div className="flex items-center justify-center h-24 rounded-card border border-bdr bg-abyss">
            <p className="text-txt-dim text-sm">No executions yet</p>
          </div>
        ) : (
          <div className="relative">
            {timelineGroups.map((group) => (
              <div key={group.label} className="mb-sp-5">
                {/* Time period header */}
                <div className="sticky top-14 z-10 py-1 bg-void/95 backdrop-blur-sm">
                  <span className="text-xs text-txt-muted uppercase font-display tracking-wider">
                    {group.label}
                  </span>
                </div>

                <div className="mt-sp-2">
                  {group.executions.map((exec, index) => (
                    <div
                      key={exec.execution_id}
                      style={{ animationDelay: `${index * 100}ms` }}
                    >
                      <TimelineEvent
                        event={executionToTimelineEvent(exec)}
                        onClick={() => {
                          setSelectedId(exec.strategy_id);
                          setDetailTab('history');
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Detail Slide-Over Panel */}
      <SlideOverPanel
        open={selectedDef !== null}
        onClose={() => setSelectedId(null)}
        title={selectedDef?.name}
        subtitle="STRATEGY DEFINITION"
      >
        {selectedDef && (
          <>
            {/* Strategy ID + version below header */}
            <div className="flex items-center gap-2 mb-sp-3 -mt-sp-1">
              <span className="font-mono text-xs text-bio">{selectedDef.id}</span>
              <Badge variant="default" label={`v${selectedDef.version}`} />
              {selectedDef.last_execution && (
                <StatusBadge status={selectedDef.last_execution.status as Status} />
              )}
            </div>

            <Tabs
              tabs={DETAIL_TABS.map((t) => ({
                ...t,
                count: t.id === 'history' ? selectedExecutions.length : undefined,
              }))}
              activeTab={detailTab}
              onTabChange={setDetailTab}
              className="mb-sp-4 -mx-sp-5 px-sp-5"
            />

            {/* Overview tab */}
            {detailTab === 'overview' && (
              <StrategyDefinitionPanel definition={selectedDef} />
            )}

            {/* YAML tab */}
            {detailTab === 'yaml' && (
              <div className="rounded-lg border border-bdr bg-void p-sp-4 overflow-auto max-h-[60vh]">
                <pre className="text-[0.7rem] text-txt-dim font-mono whitespace-pre-wrap leading-relaxed">
                  {selectedDef.raw_yaml}
                </pre>
              </div>
            )}

            {/* History tab */}
            {detailTab === 'history' && (
              <div>
                {selectedExecutions.length === 0 ? (
                  <p className="text-xs text-txt-muted py-sp-4">
                    No executions found for this strategy.
                  </p>
                ) : (
                  <div className="space-y-sp-3">
                    {selectedExecutions.map((exec) => (
                      <div
                        key={exec.execution_id}
                        className="rounded-lg border border-bdr bg-void/50 p-sp-3 transition-colors duration-200 hover:border-bdr-hover hover:bg-abyss-light"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span
                            className="font-mono text-[0.7rem] text-txt truncate max-w-[200px]"
                            title={exec.execution_id}
                          >
                            {exec.execution_id}
                          </span>
                          <StatusBadge status={exec.status as Status} />
                        </div>
                        <div className="flex items-center gap-3 text-[0.7rem] text-txt-muted font-mono">
                          <span>{formatRelativeTime(exec.started_at)}</span>
                          {exec.cost_usd > 0 && (
                            <span>{formatCost(exec.cost_usd)}</span>
                          )}
                        </div>
                        {exec.retro_path && (
                          <p className="text-[0.65rem] text-bio mt-1 font-mono truncate">
                            retro: {exec.retro_path}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Actions footer */}
            <div className="flex gap-2 mt-sp-6 pt-sp-4 border-t border-bdr">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleViewDetail(selectedDef.id)}
              >
                View Full Detail
              </Button>
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Play className="h-3.5 w-3.5" />}
                onClick={() => setExecuteDialogOpen(true)}
              >
                Execute Now
              </Button>
            </div>

            {/* Execute dialog */}
            <ExecuteDialog
              key={selectedDef.id}
              definition={selectedDef}
              open={executeDialogOpen}
              onClose={() => setExecuteDialogOpen(false)}
              onExecute={handleExecute}
              loading={executeMutation.isPending}
            />
          </>
        )}
      </SlideOverPanel>

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
