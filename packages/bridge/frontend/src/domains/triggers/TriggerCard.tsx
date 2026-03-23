/**
 * PRD 019.4 — Trigger Card (Component 1)
 *
 * Interactive card for a registered trigger. Shows type icon, status,
 * config summary, fire/error counts, and a fire rate sparkline.
 */

import { cn } from '@/lib/cn';
import { Card } from '@/components/ui/Card';
import type { TriggerListItem, TriggerType, TriggerFireEvent } from '@/lib/types';
import { formatTime } from '@/lib/formatters';
import {
  GitBranch,
  FolderOpen,
  Clock,
  Webhook,
  Eye,
  Radio,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';

// ── Type icon + color mapping (PRD 019.4 Section 3.1) ──

interface TriggerTypeConfig {
  icon: LucideIcon;
  bgClass: string;
  textClass: string;
  dotColor: string;
  label: string;
}

const TYPE_CONFIG: Record<TriggerType, TriggerTypeConfig> = {
  git_commit: {
    icon: GitBranch,
    bgClass: 'bg-nebular-dim',
    textClass: 'text-nebular',
    dotColor: 'bg-solar',
    label: 'git_commit',
  },
  file_watch: {
    icon: FolderOpen,
    bgClass: 'bg-solar-dim',
    textClass: 'text-solar',
    dotColor: 'bg-solar',
    label: 'file_watch',
  },
  schedule: {
    icon: Clock,
    bgClass: 'bg-bio-dim',
    textClass: 'text-bio',
    dotColor: 'bg-bio',
    label: 'schedule',
  },
  webhook: {
    icon: Webhook,
    bgClass: 'bg-cyan/15',
    textClass: 'text-cyan',
    dotColor: 'bg-cyan',
    label: 'webhook',
  },
  pty_watcher: {
    icon: Eye,
    bgClass: 'bg-error-dim',
    textClass: 'text-error',
    dotColor: 'bg-error',
    label: 'pty_watcher',
  },
  channel_event: {
    icon: Radio,
    bgClass: 'bg-nebular-dim',
    textClass: 'text-nebular',
    dotColor: 'bg-nebular',
    label: 'channel_event',
  },
};

// ── Config summary helpers ──

function getConfigSummary(trigger: TriggerListItem): Array<{ label: string; value: string }> {
  const cfg = trigger.trigger_config;
  const items: Array<{ label: string; value: string }> = [];

  switch (cfg.type) {
    case 'git_commit':
      if (cfg.branch_pattern) items.push({ label: 'Branch', value: cfg.branch_pattern });
      if (cfg.debounce_ms) items.push({ label: 'Debounce', value: `${cfg.debounce_ms}ms ${cfg.debounce_strategy ?? ''}`.trim() });
      items.push({ label: 'Max concurrent', value: String(trigger.max_concurrent) });
      break;
    case 'file_watch':
      if (cfg.paths?.length) items.push({ label: 'Paths', value: cfg.paths.length === 1 ? cfg.paths[0] : `${cfg.paths.length} paths` });
      if (cfg.debounce_ms) items.push({ label: 'Debounce', value: `${cfg.debounce_ms}ms` });
      break;
    case 'schedule':
      if (cfg.cron) items.push({ label: 'Cron', value: cfg.cron });
      break;
    case 'webhook':
      if (cfg.path) items.push({ label: 'Path', value: cfg.path });
      items.push({ label: 'HMAC', value: cfg.secret_env ? 'configured' : 'none' });
      break;
    case 'pty_watcher':
      if (cfg.pattern) items.push({ label: 'Pattern', value: cfg.pattern });
      if (cfg.condition) items.push({ label: 'Condition', value: cfg.condition });
      break;
    case 'channel_event':
      if (cfg.event_types?.length) items.push({ label: 'Events', value: cfg.event_types.join(', ') });
      if (cfg.filter) items.push({ label: 'Filter', value: cfg.filter });
      break;
  }

  if (trigger.stats.last_fired_at) {
    items.push({ label: 'Last fired', value: formatTime(trigger.stats.last_fired_at) });
  }

  return items.slice(0, 4); // max 2x2 grid
}

// ── Sparkline SVG ──

interface SparklineProps {
  history: TriggerFireEvent[];
  triggerId: string;
}

function Sparkline({ history, triggerId }: SparklineProps) {
  const bars = useMemo(() => {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const bucketSize = 60 * 60 * 1000; // 1 hour
    const counts = new Array(24).fill(0);

    for (const event of history) {
      if (event.trigger_id !== triggerId) continue;
      const ts = new Date(event.timestamp).getTime();
      if (ts < dayAgo) continue;
      const bucketIndex = Math.min(23, Math.floor((ts - dayAgo) / bucketSize));
      counts[bucketIndex]++;
    }

    const max = Math.max(1, ...counts);
    return counts.map((c) => ({
      count: c,
      height: c === 0 ? 2 : Math.max(2, (c / max) * 20),
    }));
  }, [history, triggerId]);

  const totalFires = bars.reduce((sum, b) => sum + b.count, 0);

  return (
    <svg
      width="80"
      height="20"
      viewBox="0 0 80 20"
      className="shrink-0"
      aria-label={`${totalFires} fires in last 24 hours`}
      role="img"
    >
      {bars.map((bar, i) => (
        <rect
          key={i}
          x={i * 3.3}
          y={20 - bar.height}
          width="2.5"
          height={bar.height}
          rx="0.5"
          className={bar.count === 0 ? 'fill-txt-muted/20' : 'fill-bio/70'}
        />
      ))}
    </svg>
  );
}

// ── TriggerCard ──

export interface TriggerCardProps {
  trigger: TriggerListItem;
  history: TriggerFireEvent[];
  selected: boolean;
  paused: boolean;
  onClick: () => void;
  style?: React.CSSProperties;
}

export function TriggerCard({ trigger, history, selected, paused, onClick, style }: TriggerCardProps) {
  const typeConfig = TYPE_CONFIG[trigger.type] ?? TYPE_CONFIG.file_watch;
  const Icon = typeConfig.icon;
  const configSummary = getConfigSummary(trigger);

  // Determine status
  let statusLabel: string;
  let statusDotColor: string;
  let statusPulse = false;

  if (paused) {
    statusLabel = 'Paused';
    statusDotColor = 'bg-solar';
  } else if (!trigger.enabled) {
    statusLabel = 'Disabled';
    statusDotColor = 'bg-txt-muted';
  } else {
    statusLabel = 'Active';
    statusDotColor = 'bg-bio';
    statusPulse = true;
  }

  return (
    <Card
      variant="interactive"
      padding="md"
      selected={selected}
      onClick={onClick}
      className={cn(
        'animate-slide-in-left',
        !trigger.enabled && !paused && 'opacity-60',
      )}
      style={style}
      role="button"
      tabIndex={0}
      aria-label={`Trigger ${trigger.trigger_id}, ${statusLabel}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* Header row: icon + ID + status */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Type icon */}
          <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', typeConfig.bgClass)}>
            <Icon className={cn('h-4.5 w-4.5', typeConfig.textClass)} />
          </div>

          <div className="min-w-0">
            <p className="font-mono text-sm text-txt truncate">{trigger.trigger_id}</p>
            <p className="text-xs text-txt-dim truncate">
              <span className="text-txt-muted">{trigger.type}</span>
              <span className="text-txt-muted mx-1">&rarr;</span>
              <span className="text-bio">{trigger.strategy_id}</span>
            </p>
          </div>
        </div>

        {/* Status dot + label */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div
            className={cn(
              'h-2 w-2 rounded-full',
              statusDotColor,
              statusPulse && 'animate-pulse-glow',
            )}
          />
          <span className={cn(
            'text-xs',
            paused ? 'text-solar' : !trigger.enabled ? 'text-txt-muted' : 'text-bio',
          )}>
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Config summary grid */}
      {configSummary.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3">
          {configSummary.map((item) => (
            <div key={item.label} className="min-w-0">
              <span className="text-[0.65rem] text-txt-muted uppercase tracking-wider">{item.label}</span>
              <p className="font-mono text-xs text-txt-dim truncate">{item.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Footer: fire count, error count, sparkline */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-bdr">
        <div className="flex items-center gap-4">
          <span className="font-mono text-xs text-txt-dim">
            {trigger.stats.total_fires} fires
          </span>
          <span className={cn('font-mono text-xs', trigger.stats.errors > 0 ? 'text-error' : 'text-txt-dim')}>
            {trigger.stats.errors} errors
          </span>
        </div>

        <Sparkline history={history} triggerId={trigger.trigger_id} />
      </div>
    </Card>
  );
}
