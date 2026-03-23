/**
 * Subscription usage meters — 5h window, 7d ceiling, 7d sonnet, 7d opus.
 * Ported from old dashboard. Color-coded progress bars with utilization %.
 */

import { cn } from '@/shared/lib/cn';
import { ProgressBar } from '@/shared/data/ProgressBar';
import { useSubscriptionUsage } from '@/domains/tokens/useTokens';
import { Gauge, AlertTriangle, WifiOff } from 'lucide-react';
import type { UsageBucket } from '@/lib/types';
import { formatRelativeTime } from '@/shared/lib/formatters';

export interface SubscriptionMetersProps {
  className?: string;
}

function bucketStatus(utilization: number): 'running' | 'completed' | 'failed' {
  if (utilization >= 80) return 'failed';
  if (utilization >= 50) return 'completed'; // yellow-ish via "completed" = cyan; we override below
  return 'running';
}

function bucketColor(utilization: number): string {
  if (utilization >= 80) return 'text-error';
  if (utilization >= 50) return 'text-solar';
  return 'text-bio';
}

function MeterRow({ label, bucket }: { label: string; bucket: UsageBucket }) {
  const pct = Math.min(100, Math.max(0, bucket.utilization));
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-txt-dim">{label}</span>
        <span className={cn('font-mono text-xs font-medium', bucketColor(pct))}>
          {pct.toFixed(1)}%
        </span>
      </div>
      <ProgressBar value={pct} status={bucketStatus(pct)} />
      {bucket.resets_at && (
        <p className="text-[0.55rem] text-txt-muted mt-0.5">
          Resets {formatRelativeTime(bucket.resets_at)}
        </p>
      )}
    </div>
  );
}

export function SubscriptionMeters({ className }: SubscriptionMetersProps) {
  const { data, isLoading } = useSubscriptionUsage();

  if (isLoading) {
    return (
      <div className={cn('rounded-card border border-bdr bg-abyss p-sp-4', className)}>
        <div className="flex items-center gap-2 mb-sp-3">
          <Gauge className="h-4 w-4 text-txt-muted" />
          <span className="text-xs text-txt-dim font-medium">Subscription Usage</span>
        </div>
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-6 rounded bg-abyss-light/50 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // Not configured state
  if (!data || data.status === 'not_configured') {
    return (
      <div className={cn('rounded-card border border-bdr bg-abyss p-sp-4', className)}>
        <div className="flex items-center gap-2 mb-sp-3">
          <Gauge className="h-4 w-4 text-txt-muted" />
          <span className="text-xs text-txt-dim font-medium">Subscription Usage</span>
        </div>
        <p className="text-[0.65rem] text-txt-muted">
          Set <code className="text-txt-dim">CLAUDE_OAUTH_TOKEN</code> to enable usage tracking.
        </p>
      </div>
    );
  }

  // Error states
  if (data.status === 'scope_error') {
    return (
      <div className={cn('rounded-card border border-bdr bg-abyss p-sp-4', className)}>
        <div className="flex items-center gap-2 text-solar">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-xs font-medium">OAuth token missing required scope</span>
        </div>
      </div>
    );
  }

  if (data.status === 'network_error' && !data.usage) {
    return (
      <div className={cn('rounded-card border border-bdr bg-abyss p-sp-4', className)}>
        <div className="flex items-center gap-2 text-error">
          <WifiOff className="h-4 w-4" />
          <span className="text-xs font-medium">Usage polling failed</span>
        </div>
      </div>
    );
  }

  if (!data.usage) return null;

  const { usage } = data;

  return (
    <div className={cn('rounded-card border border-bdr bg-abyss p-sp-4', className)}>
      <div className="flex items-center justify-between mb-sp-3">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-bio" />
          <span className="text-xs text-txt-dim font-medium">Subscription Usage</span>
        </div>
        <span className="text-[0.55rem] text-txt-muted">
          {formatRelativeTime(usage.polled_at)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <MeterRow label="5-Hour Window" bucket={usage.five_hour} />
        <MeterRow label="7-Day Ceiling" bucket={usage.seven_day} />
        <MeterRow label="7-Day Sonnet" bucket={usage.seven_day_sonnet} />
        <MeterRow label="7-Day Opus" bucket={usage.seven_day_opus} />
      </div>

      {usage.extra_usage && (
        <p className="text-[0.55rem] text-txt-muted mt-2">
          Extra usage: {usage.extra_usage.enabled ? 'enabled' : 'disabled'}
        </p>
      )}
    </div>
  );
}
