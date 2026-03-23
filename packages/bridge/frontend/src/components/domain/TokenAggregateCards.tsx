/**
 * Aggregate token usage metric cards — total tokens, input/output, cache rate, cache savings.
 * Consumes GET /api/tokens (aggregate).
 */

import { MetricCard } from '@/components/data/MetricCard';
import { formatTokens } from '@/lib/formatters';
import { useAggregateTokens } from '@/hooks/useTokens';
import { cn } from '@/lib/cn';

export interface TokenAggregateCardsProps {
  className?: string;
}

export function TokenAggregateCards({ className }: TokenAggregateCardsProps) {
  const { data: tokens } = useAggregateTokens();

  if (!tokens) {
    return (
      <div className={cn('grid grid-cols-2 md:grid-cols-4 gap-3', className)}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 rounded-card bg-abyss-light/50 animate-pulse border border-bdr" />
        ))}
      </div>
    );
  }

  // Cache savings = reads that didn't need to be full input
  const cacheSavings = tokens.cacheReadTokens > 0
    ? formatTokens(tokens.cacheReadTokens)
    : '0';

  const rateColor =
    tokens.cacheHitRate >= 70 ? 'up' as const :
    tokens.cacheHitRate >= 40 ? 'flat' as const :
    'down' as const;

  return (
    <div className={cn('grid grid-cols-2 md:grid-cols-4 gap-3', className)}>
      <MetricCard
        label="Total Tokens"
        value={formatTokens(tokens.totalTokens)}
        trendValue={`${tokens.sessionCount} sessions`}
      />
      <MetricCard
        label="Input / Output"
        value={`${formatTokens(tokens.inputTokens)} / ${formatTokens(tokens.outputTokens)}`}
      />
      <MetricCard
        label="Cache Hit Rate"
        value={`${tokens.cacheHitRate.toFixed(1)}%`}
        trend={rateColor}
      />
      <MetricCard
        label="Cache Savings"
        value={cacheSavings}
        trendValue="tokens cached"
      />
    </div>
  );
}
