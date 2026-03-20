import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export interface MetricCardProps {
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'flat';
  trendValue?: string;
  sparkline?: ReactNode;
  className?: string;
}

export function MetricCard({
  label,
  value,
  trend,
  trendValue,
  sparkline,
  className,
}: MetricCardProps) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const trendColor = trend === 'up' ? 'text-bio' : trend === 'down' ? 'text-error' : 'text-txt-dim';

  return (
    <div
      className={cn(
        'rounded-card border border-bdr bg-abyss p-sp-4',
        className,
      )}
    >
      <p className="text-xs text-txt-dim font-medium mb-sp-2">{label}</p>
      <div className="flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-lg text-txt font-semibold animate-count-up">
            {value}
          </span>
          {trend && (
            <span className={cn('flex items-center gap-0.5 text-xs font-medium', trendColor)}>
              <TrendIcon className="h-3 w-3" />
              {trendValue}
            </span>
          )}
        </div>
        {sparkline && <div className="shrink-0">{sparkline}</div>}
      </div>
    </div>
  );
}
