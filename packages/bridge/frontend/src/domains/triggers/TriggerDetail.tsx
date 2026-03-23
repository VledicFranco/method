/**
 * PRD 019.4 — Trigger Detail Slide-Over (Component 2)
 *
 * Four tabs:
 *   - Config: full trigger configuration + enable/disable toggle
 *   - Fire History: table of recent fires with debounce count
 *   - Debounce: bar chart visualization of raw events vs debounced fires
 *   - Webhook: request log with HMAC status (webhook type only)
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { SlideOverPanel } from '@/components/layout/SlideOverPanel';
import { Tabs } from '@/components/ui/Tabs';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/formatters';
import {
  useTriggerDetail,
  useTriggerHistory,
  useToggleTrigger,
  useWebhookLog,
} from '@/domains/triggers/useTriggers';
import type { TriggerListItem, TriggerFireEvent, TriggerType, WebhookLogEntry } from '@/lib/types';
import { ChevronDown, ChevronRight } from 'lucide-react';

// ── Props ──

export interface TriggerDetailProps {
  triggerId: string | null;
  /** Pre-fetched trigger from the list (avoids loading flash) */
  trigger?: TriggerListItem;
  onClose: () => void;
}

// ── Tab definitions ──

function getTabs(triggerType?: TriggerType, hasDebounce?: boolean) {
  const tabs = [
    { id: 'config', label: 'Config' },
    { id: 'history', label: 'Fire History' },
  ];
  if (hasDebounce) {
    tabs.push({ id: 'debounce', label: 'Debounce' });
  }
  if (triggerType === 'webhook') {
    tabs.push({ id: 'webhook', label: 'Webhook' });
  }
  return tabs;
}

// ── Component ──

export function TriggerDetail({ triggerId, trigger: listTrigger, onClose }: TriggerDetailProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('config');

  // Reset tab when switching between triggers
  useEffect(() => {
    setActiveTab('config');
  }, [triggerId]);

  // Fetch full detail (supplements list data with recent_fires)
  const { data: detailData } = useTriggerDetail(triggerId);
  // Fetch per-trigger history for the history tab
  const { data: historyData } = useTriggerHistory(triggerId ?? undefined, 20);

  const toggleMutation = useToggleTrigger();

  // Use detail data if available, fall back to list data
  const trigger = detailData ?? listTrigger;

  const hasDebounce = trigger?.trigger_config?.debounce_ms !== undefined;

  const handleToggle = useCallback(() => {
    if (!triggerId || !trigger) return;
    toggleMutation.mutate({
      triggerId,
      enable: !trigger.enabled,
    });
  }, [triggerId, trigger, toggleMutation]);

  if (!triggerId) return null;

  const tabs = getTabs(trigger?.type, hasDebounce);
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
          onViewStrategy={() => navigate(`/app/strategies/${encodeURIComponent(trigger.strategy_id)}`)}
        />
      )}

      {activeTab === 'history' && (
        <HistoryTab fires={fires} />
      )}

      {activeTab === 'debounce' && (
        <DebounceTab fires={fires} trigger={trigger} />
      )}

      {activeTab === 'webhook' && triggerId && (
        <WebhookTab triggerId={triggerId} />
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

// ── Debounce Tab (Phase 2) ──

interface DebounceTabProps {
  fires: TriggerFireEvent[];
  trigger?: TriggerListItem;
}

function DebounceTab({ fires, trigger }: DebounceTabProps) {
  const { buckets, totalRaw, totalFires, collapseRatio } = useMemo(() => {
    const now = Date.now();
    const twelveHoursAgo = now - 12 * 60 * 60 * 1000;
    const bucketCount = 12;
    const bucketSize = (12 * 60 * 60 * 1000) / bucketCount; // 1 hour each

    const rawBuckets = new Array(bucketCount).fill(0);
    const fireBuckets = new Array(bucketCount).fill(0);

    let totalRawCount = 0;
    let totalFireCount = 0;

    for (const fire of fires) {
      const ts = new Date(fire.timestamp).getTime();
      if (ts < twelveHoursAgo) continue;
      const idx = Math.min(bucketCount - 1, Math.floor((ts - twelveHoursAgo) / bucketSize));
      rawBuckets[idx] += fire.debounced_count;
      fireBuckets[idx] += 1;
      totalRawCount += fire.debounced_count;
      totalFireCount += 1;
    }

    const maxVal = Math.max(1, ...rawBuckets, ...fireBuckets);

    return {
      buckets: rawBuckets.map((raw, i) => ({
        raw,
        fires: fireBuckets[i],
        rawHeight: raw === 0 ? 0 : Math.max(3, (raw / maxVal) * 60),
        fireHeight: fireBuckets[i] === 0 ? 0 : Math.max(3, (fireBuckets[i] / maxVal) * 60),
      })),
      totalRaw: totalRawCount,
      totalFires: totalFireCount,
      collapseRatio: totalFireCount > 0 ? (totalRawCount / totalFireCount).toFixed(1) : '0',
    };
  }, [fires]);

  const debounceWindow = trigger?.trigger_config?.debounce_ms
    ? `${trigger.trigger_config.debounce_ms}ms ${trigger.trigger_config.debounce_strategy ?? 'trailing'}`
    : 'N/A';

  return (
    <div className="space-y-sp-5">
      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3">
        <DebounceStat label="Raw Events (12h)" value={String(totalRaw)} />
        <DebounceStat label="Debounced Fires" value={String(totalFires)} />
        <DebounceStat label="Collapse Ratio" value={`${collapseRatio}:1`} />
        <DebounceStat label="Debounce Window" value={debounceWindow} />
      </div>

      {/* Bar chart */}
      <div className="py-sp-3">
        {totalRaw === 0 && totalFires === 0 ? (
          <div className="flex items-center justify-center h-[60px] text-xs text-txt-muted">
            No events in the last 12 hours
          </div>
        ) : (
          <div className="flex items-end gap-[3px] h-[60px]">
            {buckets.map((bucket, i) => (
              <div key={i} className="flex-1 flex flex-col items-stretch justify-end h-full gap-px">
                {/* Raw events bar (top) */}
                <div
                  className="w-full rounded-t-sm transition-all duration-1000 ease-out"
                  style={{
                    height: `${bucket.rawHeight}px`,
                    backgroundColor: 'var(--border)',
                  }}
                />
                {/* Debounced fires bar (bottom) */}
                <div
                  className="w-full rounded-b-sm bg-bio/70 transition-all duration-1000 ease-out"
                  style={{ height: `${bucket.fireHeight}px` }}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-txt-muted">
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: 'var(--border)' }} />
          <span>Raw events</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-sm bg-bio/70" />
          <span>Debounced fires</span>
        </div>
      </div>
    </div>
  );
}

function DebounceStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-2 px-3 rounded-lg bg-void/50 border border-bdr">
      <span className="block text-[0.65rem] text-txt-muted uppercase tracking-wider">{label}</span>
      <span className="block font-mono text-sm text-txt mt-0.5">{value}</span>
    </div>
  );
}

// ── Webhook Tab (Phase 2) ──

function WebhookTab({ triggerId }: { triggerId: string }) {
  const { data, isLoading, isError } = useWebhookLog(triggerId);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 rounded-md bg-void/50 animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-sm text-txt-muted">
        <p>Webhook request log unavailable</p>
        <p className="text-xs mt-1">Backend endpoint not yet implemented</p>
      </div>
    );
  }

  const requests = data?.requests ?? [];

  if (requests.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-txt-muted">
        No webhook requests recorded
      </div>
    );
  }

  return (
    <div className="space-y-sp-2">
      {requests.map((req, i) => (
        <WebhookRequestRow
          key={`${req.timestamp}-${i}`}
          request={req}
          expanded={expandedRow === i}
          onToggle={() => setExpandedRow(expandedRow === i ? null : i)}
        />
      ))}
    </div>
  );
}

function WebhookRequestRow({
  request,
  expanded,
  onToggle,
}: {
  request: WebhookLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hmacBadge = {
    pass: { variant: 'bio' as const, label: 'Pass' },
    fail: { variant: 'error' as const, label: 'Fail' },
    none: { variant: 'muted' as const, label: 'None' },
  }[request.hmac_status];

  const filterBadge = {
    pass: { variant: 'bio' as const, label: 'Pass' },
    reject: { variant: 'solar' as const, label: 'Reject' },
    'N/A': { variant: 'muted' as const, label: 'N/A' },
  }[request.filter_result];

  return (
    <div className="rounded-md bg-void/50 border border-bdr overflow-hidden">
      {/* Row header */}
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full py-2 px-3 text-left hover:bg-abyss-light transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-txt-muted shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-txt-muted shrink-0" />
        )}

        {/* Time */}
        <span className="font-mono text-xs text-txt-dim shrink-0 w-[50px]">
          {formatTime(request.timestamp)}
        </span>

        {/* Method badge */}
        <Badge variant="default" size="sm" label={request.method} />

        {/* HMAC badge */}
        <Badge variant={hmacBadge.variant} size="sm" label={hmacBadge.label} />

        {/* Filter badge */}
        {filterBadge && (
          <Badge variant={filterBadge.variant} size="sm" label={filterBadge.label} />
        )}

        {/* Payload preview */}
        <span className="font-mono text-xs text-txt-muted truncate flex-1">
          {request.payload_preview.slice(0, 80)}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-bdr px-3 py-2 space-y-2">
          {/* Headers */}
          <div>
            <span className="text-[0.65rem] text-txt-muted uppercase tracking-wider">Headers</span>
            <pre className="font-mono text-xs text-txt-dim mt-1 overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(request.headers, null, 2)}
            </pre>
          </div>

          {/* Full payload */}
          <div>
            <span className="text-[0.65rem] text-txt-muted uppercase tracking-wider">Payload</span>
            <pre className="font-mono text-xs text-txt-dim mt-1 overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
              {formatPayload(request.payload_preview)}
            </pre>
          </div>

          {/* Size */}
          <div className="text-xs text-txt-muted">
            Payload size: {request.payload_size_bytes} bytes
          </div>
        </div>
      )}
    </div>
  );
}

function formatPayload(preview: string): string {
  try {
    return JSON.stringify(JSON.parse(preview), null, 2);
  } catch {
    return preview;
  }
}
