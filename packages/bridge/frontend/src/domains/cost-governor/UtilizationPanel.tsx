/**
 * UtilizationPanel — live rate-governor utilization meters.
 * Shows burst window, weekly cap, and concurrent slot usage.
 */

import { Gauge, Zap, WifiOff } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { ProgressBar } from '@/shared/data/ProgressBar';
import { useUtilization } from './useCostGovernor';

function statusFor(pct: number): 'running' | 'completed' | 'failed' {
  if (pct >= 90) return 'failed';
  if (pct >= 60) return 'completed'; // yellow-ish via cyan
  return 'running';
}

function colorFor(pct: number): string {
  if (pct >= 90) return 'text-error';
  if (pct >= 60) return 'text-solar';
  return 'text-bio';
}

export interface UtilizationPanelProps {
  className?: string;
}

export function UtilizationPanel({ className }: UtilizationPanelProps) {
  const { data, isLoading, isError } = useUtilization();

  if (isLoading) {
    return (
      <div className={cn('rounded-card border border-bdr bg-abyss p-sp-4', className)}>
        <div className="flex items-center gap-2 mb-sp-3">
          <Gauge className="h-4 w-4 text-txt-muted" />
          <span className="text-xs text-txt-dim font-medium">Rate Utilization</span>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-6 rounded bg-abyss-light/50 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className={cn('rounded-card border border-bdr bg-abyss p-sp-4', className)}>
        <div className="flex items-center gap-2 text-txt-muted">
          <WifiOff className="h-4 w-4" />
          <span className="text-xs">Cost governor disabled or unreachable</span>
        </div>
      </div>
    );
  }

  // Single-account: always 1 account in the array (for now)
  const account = data.accounts[0];
  if (!account) {
    return (
      <div className={cn('rounded-card border border-bdr bg-abyss p-sp-4', className)}>
        <p className="text-xs text-txt-dim">No accounts registered</p>
      </div>
    );
  }

  const burstPct = Math.min(100, Math.max(0, account.burstWindowUsedPct));
  const weeklyPct = Math.min(100, Math.max(0, account.weeklyUsedPct));

  return (
    <div className={cn('rounded-card border border-bdr bg-abyss p-sp-4', className)}>
      <div className="flex items-center justify-between mb-sp-3">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-bio" />
          <span className="text-xs text-txt-dim font-medium">Rate Utilization</span>
        </div>
        <StatusBadge status={account.status} />
      </div>

      <div className="space-y-sp-3">
        <Meter label="5-Hour Burst Window" pct={burstPct} />
        <Meter label="Weekly Cap" pct={weeklyPct} />

        {/* Concurrent slots + backpressure */}
        <div className="grid grid-cols-2 gap-sp-3 pt-sp-2 border-t border-bdr">
          <div>
            <p className="text-[0.65rem] text-txt-muted mb-0.5">Concurrent</p>
            <div className="flex items-center gap-1.5">
              <Zap className="h-3 w-3 text-bio" />
              <span className="font-mono text-sm text-txt font-semibold">
                {account.inFlightCount}
              </span>
              <span className="text-xs text-txt-muted">/ {data.activeSlots >= account.inFlightCount ? data.activeSlots : account.inFlightCount}</span>
            </div>
          </div>
          <div>
            <p className="text-[0.65rem] text-txt-muted mb-0.5">Backpressure</p>
            <span
              className={cn(
                'font-mono text-sm font-semibold',
                account.backpressureActive ? 'text-solar' : 'text-bio-dim',
              )}
            >
              {account.backpressureActive ? 'ACTIVE' : 'OFF'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Meter({ label, pct }: { label: string; pct: number }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-txt-dim">{label}</span>
        <span className={cn('font-mono text-xs font-medium', colorFor(pct))}>
          {pct.toFixed(1)}%
        </span>
      </div>
      <ProgressBar value={pct} status={statusFor(pct)} />
    </div>
  );
}

function StatusBadge({ status }: { status: 'ready' | 'saturated' | 'unavailable' }) {
  const config = {
    ready: { label: 'READY', color: 'text-bio bg-bio/10 border-bio/30' },
    saturated: { label: 'SATURATED', color: 'text-solar bg-solar/10 border-solar/30' },
    unavailable: { label: 'UNAVAILABLE', color: 'text-error bg-error/10 border-error/30' },
  }[status];
  return (
    <span
      className={cn(
        'font-mono text-[0.6rem] font-semibold px-1.5 py-0.5 rounded border',
        config.color,
      )}
    >
      {config.label}
    </span>
  );
}
