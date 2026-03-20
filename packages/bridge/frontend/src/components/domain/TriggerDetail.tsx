/**
 * PRD 019.4 — Trigger Detail Slide-Over (Component 2)
 *
 * Two tabs for Phase 1:
 *   - Config: full trigger configuration + enable/disable toggle
 *   - Fire History: table of recent fires with debounce count
 *
 * Debounce and Webhook tabs are Phase 2 — placeholder only.
 */

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { SlideOverPanel } from '@/components/layout/SlideOverPanel';
import { Tabs } from '@/components/ui/Tabs';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/formatters';
import { useTriggerDetail, useTriggerHistory, useToggleTrigger } from '@/hooks/useTriggers';
import type { TriggerListItem, TriggerFireEvent, TriggerType } from '@/lib/types';

// ── Props ──

export interface TriggerDetailProps {
  triggerId: string | null;
  /** Pre-fetched trigger from the list (avoids loading flash) */
  trigger?: TriggerListItem;
  onClose: () => void;
}

// ── Tab definitions ──

function getTabs(_triggerType?: TriggerType) {
  const tabs = [
    { id: 'config', label: 'Config' },
    { id: 'history', label: 'Fire History' },
  ];
  // Debounce and Webhook tabs are Phase 2
  return tabs;
}

// ── Component ──

export function TriggerDetail({ triggerId, trigger: listTrigger, onClose }: TriggerDetailProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('config');

  // Fetch full detail (supplements list data with recent_fires)
  const { data: detailData } = useTriggerDetail(triggerId);
  // Fetch per-trigger history for the history tab
  const { data: historyData } = useTriggerHistory(triggerId ?? undefined, 20);

  const toggleMutation = useToggleTrigger();

  // Use detail data if available, fall back to list data
  const trigger = detailData ?? listTrigger;

  const handleToggle = useCallback(() => {
    if (!triggerId || !trigger) return;
    toggleMutation.mutate({
      triggerId,
      enable: !trigger.enabled,
    });
  }, [triggerId, trigger, toggleMutation]);

  if (!triggerId) return null;

  const tabs = getTabs(trigger?.type);
  const fires = historyData?.events ?? detailData?.recent_fires ?? [];

  return (
    <SlideOverPanel
      open={!!triggerId}
      onClose={onClose}
      title={trigger?.trigger_id ?? triggerId}
      subtitle="TRIGGER DETAIL"
    >
      {/* Tabs */}
      <Tabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        className="mb-sp-5 -mx-sp-5 px-sp-5"
      />

      {activeTab === 'config' && trigger && (
        <ConfigTab
          trigger={trigger}
          loading={toggleMutation.isPending}
          onToggle={handleToggle}
          onViewStrategy={() => navigate(`/app/strategies`)}
        />
      )}

      {activeTab === 'history' && (
        <HistoryTab fires={fires} />
      )}
    </SlideOverPanel>
  );
}

// ── Config Tab ──

interface ConfigTabProps {
  trigger: TriggerListItem;
  loading: boolean;
  onToggle: () => void;
  onViewStrategy: () => void;
}

function ConfigTab({ trigger, loading, onToggle, onViewStrategy }: ConfigTabProps) {
  const cfg = trigger.trigger_config;

  return (
    <div className="space-y-sp-5">
      {/* Enable/Disable Toggle */}
      <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-void/50 border border-bdr">
        <span className="text-sm text-txt font-medium">Enabled</span>
        <button
          onClick={onToggle}
          disabled={loading}
          className={cn(
            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200',
            trigger.enabled ? 'bg-bio' : 'bg-bdr-hover',
          )}
          role="switch"
          aria-checked={trigger.enabled}
          aria-label={trigger.enabled ? 'Disable trigger' : 'Enable trigger'}
        >
          <span
            className={cn(
              'inline-block h-4 w-4 rounded-full bg-void transition-transform duration-200',
              trigger.enabled ? 'translate-x-6' : 'translate-x-1',
            )}
          />
        </button>
      </div>

      {/* Configuration Fields */}
      <div className="space-y-3">
        <h3 className="text-xs text-txt-muted uppercase tracking-wider font-medium">Configuration</h3>

        <ConfigField label="Type" value={cfg.type} />
        <ConfigField label="Strategy" value={trigger.strategy_id} accent />
        <ConfigField label="Status" value={trigger.enabled ? 'Active' : 'Disabled'} />
        <ConfigField label="Max Concurrent" value={String(trigger.max_concurrent)} />

        {/* Type-specific fields */}
        {cfg.type === 'git_commit' && (
          <>
            {cfg.branch_pattern && <ConfigField label="Branch Pattern" value={cfg.branch_pattern} />}
            {cfg.path_pattern && <ConfigField label="Path Pattern" value={cfg.path_pattern} />}
          </>
        )}

        {cfg.type === 'file_watch' && (
          <>
            {cfg.paths && <ConfigField label="Watch Paths" value={cfg.paths.join(', ')} />}
            {cfg.events && <ConfigField label="Events" value={cfg.events.join(', ')} />}
          </>
        )}

        {cfg.type === 'schedule' && (
          <>
            {cfg.cron && <ConfigField label="Cron Expression" value={cfg.cron} />}
          </>
        )}

        {cfg.type === 'webhook' && (
          <>
            {cfg.path && <ConfigField label="Webhook Path" value={cfg.path} />}
            <ConfigField label="HMAC" value={cfg.secret_env ? 'Configured' : 'None'} />
            {cfg.filter && <ConfigField label="Filter" value={cfg.filter} />}
            {cfg.methods && <ConfigField label="Methods" value={cfg.methods.join(', ')} />}
          </>
        )}

        {cfg.type === 'pty_watcher' && (
          <>
            {cfg.pattern && <ConfigField label="Pattern" value={cfg.pattern} />}
            {cfg.condition && <ConfigField label="Condition" value={cfg.condition} />}
          </>
        )}

        {cfg.type === 'channel_event' && (
          <>
            {cfg.event_types && <ConfigField label="Event Types" value={cfg.event_types.join(', ')} />}
            {cfg.filter && <ConfigField label="Filter" value={cfg.filter} />}
          </>
        )}

        {/* Debounce fields (common) */}
        {cfg.debounce_ms !== undefined && (
          <ConfigField
            label="Debounce"
            value={`${cfg.debounce_ms}ms ${cfg.debounce_strategy ?? 'trailing'}`}
          />
        )}
        {cfg.max_batch_size !== undefined && (
          <ConfigField label="Max Batch Size" value={String(cfg.max_batch_size)} />
        )}
      </div>

      {/* Stats */}
      <div className="space-y-3">
        <h3 className="text-xs text-txt-muted uppercase tracking-wider font-medium">Statistics</h3>
        <ConfigField label="Total Fires" value={String(trigger.stats.total_fires)} />
        <ConfigField label="Debounced Events" value={String(trigger.stats.debounced_events)} />
        <ConfigField label="Errors" value={String(trigger.stats.errors)} />
        {trigger.stats.last_fired_at && (
          <ConfigField label="Last Fired" value={formatTime(trigger.stats.last_fired_at)} />
        )}
        {trigger.stats.last_execution_id && (
          <ConfigField label="Last Execution" value={trigger.stats.last_execution_id} mono />
        )}
      </div>

      {/* Actions */}
      <div className="pt-sp-3">
        <Button variant="secondary" size="sm" onClick={onViewStrategy}>
          View Strategy
        </Button>
      </div>
    </div>
  );
}

// ── Config field row ──

function ConfigField({
  label,
  value,
  accent = false,
  mono = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-2 py-1">
      <span className="text-xs text-txt-muted shrink-0">{label}</span>
      <span
        className={cn(
          'text-xs text-right truncate max-w-[60%]',
          accent ? 'text-bio' : 'text-txt-dim',
          mono && 'font-mono',
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ── History Tab ──

function HistoryTab({ fires }: { fires: TriggerFireEvent[] }) {
  if (fires.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-txt-muted">
        No fire history yet
      </div>
    );
  }

  return (
    <div className="space-y-sp-2">
      {fires
        .slice()
        .reverse()
        .map((fire, i) => (
          <div
            key={`${fire.timestamp}-${i}`}
            className="flex items-center gap-3 py-2 px-3 rounded-md bg-void/50 border border-bdr"
          >
            {/* Time */}
            <span className="font-mono text-xs text-txt-dim shrink-0 w-[50px]">
              {formatTime(fire.timestamp)}
            </span>

            {/* Debounce count */}
            {fire.debounced_count > 1 && (
              <Badge
                variant="solar"
                size="sm"
                label={`${fire.debounced_count}\u21921`}
              />
            )}

            {/* Execution ID (if available) */}
            {fire.payload.execution_id ? (
              <span className="font-mono text-xs text-txt-muted truncate">
                {String(fire.payload.execution_id).slice(0, 8)}
              </span>
            ) : (
              <span className="font-mono text-xs text-txt-muted truncate flex-1">
                {fire.strategy_id}
              </span>
            )}
          </div>
        ))}
    </div>
  );
}
