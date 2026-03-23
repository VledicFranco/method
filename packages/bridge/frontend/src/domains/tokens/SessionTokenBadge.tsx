/**
 * Compact token usage badge for session cards.
 * Shows total tokens + cache hit rate with color coding.
 * Green >= 70%, yellow 40-69%, dim < 40%.
 */

import { cn } from '@/shared/lib/cn';
import { formatTokens } from '@/shared/lib/formatters';
import { useSessionTokens } from '@/domains/tokens/useTokens';
import { Database } from 'lucide-react';

export interface SessionTokenBadgeProps {
  sessionId: string;
  className?: string;
}

export function SessionTokenBadge({ sessionId, className }: SessionTokenBadgeProps) {
  const { data: tokens } = useSessionTokens(sessionId);

  if (!tokens) return null;

  const rate = tokens.cacheHitRate;
  const rateColor =
    rate >= 70 ? 'text-bio' : rate >= 40 ? 'text-solar' : 'text-txt-muted';

  return (
    <div className={cn('flex items-center gap-1.5 text-[0.6rem]', className)}>
      <Database className="h-3 w-3 text-txt-muted" />
      <span className="font-mono text-txt-dim">{formatTokens(tokens.totalTokens)}</span>
      <span className={cn('font-mono font-medium', rateColor)}>
        {rate.toFixed(0)}%
      </span>
    </div>
  );
}
