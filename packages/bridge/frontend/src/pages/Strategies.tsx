/**
 * PRD 019.3: Strategies page — definition browser + execution history.
 *
 * Section 1: Strategy definition cards (2-column grid)
 * Section 2: Execution history timeline
 *
 * Cards are ordered: running > recently completed > never executed.
 * Clicking a card opens the detail slide-over panel.
 */

import { useState, useMemo, useCallback } from 'react';
import { PageShell } from '@/components/layout/PageShell';
import { SlideOverPanel } from '@/components/layout/SlideOverPanel';
import { Tabs } from '@/components/ui/Tabs';
import { Button } from '@/components/ui/Button';
import { StatusBadge, type Status } from '@/components/data/StatusBadge';
import { TimelineEvent, type TimelineEventData } from '@/components/data/TimelineEvent';
import { Badge } from '@/components/ui/Badge';
import { StrategyCard } from '@/components/domain/StrategyCard';
import { StrategyDefinitionPanel } from '@/components/domain/StrategyDefinitionPanel';
import {
  useStrategyDefinitions,
  useStrategyExecutions,
  useExecuteStrategy,
} from '@/hooks/useStrategies';
import { formatCost, formatDuration, formatRelativeTime } from '@/lib/formatters';
import type { StrategyDefinition, StrategyExecution, ContextInputDef } from '@/lib/types';
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

// ── Execute confirmation dialog ──

interface ExecuteDialogProps {
  definition: StrategyDefinition;
  open: boolean;
  onClose: () => void;
  onExecute: (inputs: Record<string, unknown>) => void;
  loading: boolean;
}

function ExecuteDialog({ definition, open, onClose, onExecute, loading }: ExecuteDialogProps) {
  const [inputs, setInputs] = useState<Record<string, unknown>>(() => {
    const defaults: Record<string, unknown> = {};
    for (const ci of definition.context_inputs) {
      defaults[ci.name] = ci.default ?? '';
    }
    return defaults;
  });

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-void/60 backdrop-blur-sm animate-backdrop-fade"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-md rounded-card border border-bdr bg-abyss p-sp-6 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="font-display text-md text-txt font-semibold mb-1">
            Execute Strategy
          </h3>
          <p className="text-xs text-txt-dim mb-sp-4">
            {definition.name} ({definition.id})
          </p>

          {/* Context input fields */}
          {definition.context_inputs.length > 0 && (
            <div className="space-y-sp-3 mb-sp-5">
              <p className="text-xs text-txt-muted font-medium uppercase tracking-wider">
                Context Inputs
              </p>
              {definition.context_inputs.map((ci: ContextInputDef) => (
                <div key={ci.name}>
                  <label className="block text-xs text-txt-dim mb-1">
                    <span className="font-mono">{ci.name}</span>
                    <Badge variant="default" label={ci.type} className="ml-2" />
                  </label>
                  {ci.type === 'object' ? (
                    <textarea
                      className="w-full rounded-lg border border-bdr bg-void px-3 py-2 text-xs font-mono text-txt focus:border-bio focus:outline-none resize-y min-h-[60px]"
                      value={
                        typeof inputs[ci.name] === 'string'
                          ? (inputs[ci.name] as string)
                          : JSON.stringify(inputs[ci.name], null, 2)
                      }
                      onChange={(e) => {
                        try {
                          setInputs({ ...inputs, [ci.name]: JSON.parse(e.target.value) });
                        } catch {
                          setInputs({ ...inputs, [ci.name]: e.target.value });
                        }
                      }}
                    />
                  ) : (
                    <input
                      type={ci.type === 'number' ? 'number' : 'text'}
                      className="w-full rounded-lg border border-bdr bg-void px-3 py-2 text-xs font-mono text-txt focus:border-bio focus:outline-none"
                      value={String(inputs[ci.name] ?? '')}
                      onChange={(e) => {
                        const val =
                          ci.type === 'number'
                            ? parseFloat(e.target.value) || 0
                            : e.target.value;
                        setInputs({ ...inputs, [ci.name]: val });
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={loading}
              leftIcon={<Play className="h-3.5 w-3.5" />}
              onClick={() => onExecute(inputs)}
            >
              Execute
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Detail panel tabs ──

const DETAIL_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'yaml', label: 'YAML' },
  { id: 'history', label: 'History' },
];

// ── Main page ──

export default function Strategies() {
  const { data: defData, isLoading: defsLoading, refetch: refetchDefs } = useStrategyDefinitions();
  const { data: executions, isLoading: execsLoading } = useStrategyExecutions();
  const executeMutation = useExecuteStrategy();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState('overview');
  const [executeDialogOpen, setExecuteDialogOpen] = useState(false);

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

  // All executions for timeline
  const allExecutions = useMemo(
    () =>
      (executions ?? []).sort(
        (a, b) =>
          new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
      ),
    [executions],
  );

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
          onSuccess: () => {
            setExecuteDialogOpen(false);
          },
        },
      );
    },
    [selectedDef, executeMutation],
  );

  const loading = defsLoading || execsLoading;

  return (
    <PageShell
      title="Strategies"
      wide
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
          <div className="flex items-center justify-center h-32 rounded-card border border-bdr bg-abyss">
            <p className="text-txt-dim text-sm">
              No strategy definitions found in .method/strategies/
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
        </h2>

        {allExecutions.length === 0 ? (
          <div className="flex items-center justify-center h-24 rounded-card border border-bdr bg-abyss">
            <p className="text-txt-dim text-sm">No executions yet</p>
          </div>
        ) : (
          <div className="relative">
            {allExecutions.map((exec, index) => (
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
              <div className="rounded-lg border border-bdr bg-void p-sp-4 overflow-auto">
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
                        className="rounded-lg border border-bdr bg-void/50 p-sp-3"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono text-[0.7rem] text-txt truncate max-w-[200px]">
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
              definition={selectedDef}
              open={executeDialogOpen}
              onClose={() => setExecuteDialogOpen(false)}
              onExecute={handleExecute}
              loading={executeMutation.isPending}
            />
          </>
        )}
      </SlideOverPanel>
    </PageShell>
  );
}
