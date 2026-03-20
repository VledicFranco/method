/**
 * PRD 019.4 — Triggers Page (Phase 1)
 *
 * Trigger command center: trigger card list, fire history timeline,
 * maintenance mode banner, toolbar, and slide-over detail panel.
 */

import { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PageShell } from '@/components/layout/PageShell';
import { AttentionBanner } from '@/components/layout/AttentionBanner';
import { Button } from '@/components/ui/Button';
import { TimelineEvent, type TimelineEventData } from '@/components/data/TimelineEvent';
import { TriggerCard } from '@/components/domain/TriggerCard';
import { TriggerDetail } from '@/components/domain/TriggerDetail';
import { cn } from '@/lib/cn';
import type { TriggerType, TriggerFireEvent } from '@/lib/types';
import {
  useTriggerList,
  useTriggerHistory,
  usePauseTriggers,
  useResumeTriggers,
  useReloadTriggers,
} from '@/hooks/useTriggers';
import {
  RefreshCw,
  Pause,
  Play,
  AlertTriangle,
} from 'lucide-react';

// ── Timeline dot colors by trigger type ──

const TIMELINE_DOT_COLORS: Record<TriggerType, string> = {
  git_commit: 'bg-solar',
  file_watch: 'bg-solar',
  schedule: 'bg-bio',
  webhook: 'bg-cyan',
  pty_watcher: 'bg-error',
  channel_event: 'bg-nebular',
};

// ── Time grouping helpers ──

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

function groupByTime(events: TriggerFireEvent[]): Array<{ label: string; events: TriggerFireEvent[] }> {
  const groups = new Map<string, TriggerFireEvent[]>();

  // Events come oldest-first from the API, reverse for newest-first display
  const sorted = [...events].reverse();

  for (const event of sorted) {
    const label = getTimeGroup(event.timestamp);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(event);
  }

  return Array.from(groups.entries()).map(([label, events]) => ({ label, events }));
}

// ── Toast notification ──

interface ToastState {
  message: string;
  variant: 'success' | 'warning';
  visible: boolean;
}

// ── Page Component ──

export default function Triggers() {
  const { id: urlTriggerId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // State
  const [selectedTriggerId, setSelectedTriggerId] = useState<string | null>(
    urlTriggerId ? decodeURIComponent(urlTriggerId) : null,
  );
  const [toast, setToast] = useState<ToastState | null>(null);
  const [confirmingPause, setConfirmingPause] = useState(false);
  const [confirmingResume, setConfirmingResume] = useState(false);

  // Data
  const { data: triggerData, isLoading: triggersLoading } = useTriggerList();
  const { data: historyData, isLoading: historyLoading } = useTriggerHistory(undefined, 50);

  // Mutations
  const pauseMutation = usePauseTriggers();
  const resumeMutation = useResumeTriggers();
  const reloadMutation = useReloadTriggers();

  const triggers = triggerData?.triggers ?? [];
  const paused = triggerData?.paused ?? false;
  const history = historyData?.events ?? [];
  const activeTriggerCount = triggers.filter((t) => t.enabled).length;

  // Selected trigger from list
  const selectedTrigger = useMemo(
    () => triggers.find((t) => t.trigger_id === selectedTriggerId),
    [triggers, selectedTriggerId],
  );

  // Timeline data
  const timelineGroups = useMemo(() => groupByTime(history), [history]);

  // ── Handlers ──

  const handleSelectTrigger = useCallback((id: string) => {
    setSelectedTriggerId(id);
    navigate(`/app/triggers/${encodeURIComponent(id)}`, { replace: true });
  }, [navigate]);

  const handleCloseTrigger = useCallback(() => {
    setSelectedTriggerId(null);
    navigate('/app/triggers', { replace: true });
  }, [navigate]);

  const showToast = useCallback((message: string, variant: 'success' | 'warning') => {
    setToast({ message, variant, visible: true });
    setTimeout(() => setToast(null), 5000);
  }, []);

  const handleReload = useCallback(async () => {
    try {
      const result = await reloadMutation.mutateAsync();
      const hasErrors = result.errors.length > 0;
      const msg = `Added ${result.added.length}, updated ${result.updated.length}, removed ${result.removed.length}${hasErrors ? `, ${result.errors.length} error(s)` : ''}`;
      showToast(msg, hasErrors ? 'warning' : 'success');
    } catch (e) {
      showToast(`Reload failed: ${(e as Error).message}`, 'warning');
    }
  }, [reloadMutation, showToast]);

  const handlePause = useCallback(async () => {
    try {
      await pauseMutation.mutateAsync();
      setConfirmingPause(false);
      showToast('All triggers paused', 'success');
    } catch (e) {
      showToast(`Pause failed: ${(e as Error).message}`, 'warning');
    }
  }, [pauseMutation, showToast]);

  const handleResume = useCallback(async () => {
    try {
      await resumeMutation.mutateAsync();
      setConfirmingResume(false);
      showToast('All triggers resumed', 'success');
    } catch (e) {
      showToast(`Resume failed: ${(e as Error).message}`, 'warning');
    }
  }, [resumeMutation, showToast]);

  // ── Toolbar actions ──

  const toolbarActions = (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
        loading={reloadMutation.isPending}
        onClick={handleReload}
      >
        Reload
      </Button>

      {paused ? (
        confirmingResume ? (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-txt-dim">Resume {activeTriggerCount} triggers?</span>
            <Button variant="primary" size="sm" onClick={handleResume} loading={resumeMutation.isPending}>
              Confirm
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmingResume(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Play className="h-3.5 w-3.5" />}
            onClick={() => setConfirmingResume(true)}
          >
            Resume
          </Button>
        )
      ) : (
        confirmingPause ? (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-txt-dim">Pause {activeTriggerCount} triggers?</span>
            <Button variant="danger" size="sm" onClick={handlePause} loading={pauseMutation.isPending}>
              Confirm
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmingPause(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Pause className="h-3.5 w-3.5" />}
            onClick={() => setConfirmingPause(true)}
          >
            Pause
          </Button>
        )
      )}
    </div>
  );

  return (
    <PageShell title="Triggers" actions={toolbarActions}>
      {/* Maintenance Mode Banner */}
      {paused && (
        <AttentionBanner
          items={[
            {
              id: 'maintenance-mode',
              icon: <AlertTriangle className="h-4 w-4" />,
              description: `Triggers Paused -- Maintenance Mode (${activeTriggerCount} active triggers suspended)`,
              actionLabel: 'Resume All',
              onAction: () => setConfirmingResume(true),
              priority: 'high',
            },
          ]}
          className="mb-sp-6"
        />
      )}

      {/* Loading state */}
      {triggersLoading && (
        <div className="space-y-3 mb-sp-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-card bg-abyss animate-pulse" />
          ))}
        </div>
      )}

      {/* Trigger Card List */}
      {!triggersLoading && triggers.length > 0 && (
        <section className="mb-sp-8">
          <h2 className="text-xs text-txt-muted uppercase tracking-wider font-medium mb-sp-3">
            Registered Triggers ({triggers.length})
          </h2>
          <div className="space-y-3">
            {triggers.map((trigger, i) => (
              <TriggerCard
                key={trigger.trigger_id}
                trigger={trigger}
                history={history}
                selected={trigger.trigger_id === selectedTriggerId}
                paused={paused}
                onClick={() => handleSelectTrigger(trigger.trigger_id)}
                style={{ animationDelay: `${i * 100}ms` }}
              />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {!triggersLoading && triggers.length === 0 && (
        <div className="flex flex-col items-center justify-center h-48 rounded-card border border-bdr bg-abyss mb-sp-8">
          <p className="text-txt-dim text-sm mb-2">No triggers registered</p>
          <p className="text-txt-muted text-xs">
            Add event triggers to strategy YAML files and reload.
          </p>
        </div>
      )}

      {/* Fire History Timeline */}
      {!historyLoading && history.length > 0 && (
        <section>
          <h2 className="text-xs text-txt-muted uppercase tracking-wider font-medium mb-sp-3">
            Fire History
          </h2>
          {timelineGroups.map((group) => (
            <div key={group.label} className="mb-sp-5">
              <div className="sticky top-14 z-10 py-1 bg-void/95 backdrop-blur-sm">
                <span className="text-xs text-txt-muted uppercase font-display tracking-wider">
                  {group.label}
                </span>
              </div>
              <div className="mt-sp-2">
                {group.events.map((fire, i) => {
                  const dotColor = TIMELINE_DOT_COLORS[fire.trigger_type] ?? 'bg-bio';
                  const debounceInfo = fire.debounced_count > 1
                    ? `debounced ${fire.debounced_count} events -> 1 fire`
                    : undefined;

                  const eventData: TimelineEventData = {
                    id: `${fire.trigger_id}-${fire.timestamp}-${i}`,
                    type: fire.trigger_type,
                    title: `${fire.trigger_type} -> ${fire.strategy_id}`,
                    context: debounceInfo,
                    timestamp: fire.timestamp,
                    dotColor,
                  };

                  return (
                    <TimelineEvent
                      key={eventData.id}
                      event={eventData}
                      onClick={() => handleSelectTrigger(fire.trigger_id)}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Slide-over Detail Panel */}
      <TriggerDetail
        triggerId={selectedTriggerId}
        trigger={selectedTrigger}
        onClose={handleCloseTrigger}
      />

      {/* Toast Notification */}
      {toast?.visible && (
        <div
          className={cn(
            'fixed bottom-6 right-6 z-50 max-w-sm rounded-card border px-sp-4 py-sp-3 shadow-xl',
            'animate-slide-in-left',
            toast.variant === 'warning'
              ? 'bg-solar-dim border-solar/30'
              : 'bg-abyss border-bdr',
          )}
        >
          <p className={cn(
            'text-sm',
            toast.variant === 'warning' ? 'text-solar' : 'text-txt',
          )}>
            {toast.message}
          </p>
        </div>
      )}
    </PageShell>
  );
}
