import { cn } from '@/shared/lib/cn';

export interface ProgressBarProps {
  /** Current value (0-100) */
  value: number;
  /** Maximum value (default 100) */
  max?: number;
  /** Status controls the fill color */
  status?: 'running' | 'completed' | 'failed' | 'default';
  /** Animate the fill on mount */
  animate?: boolean;
  className?: string;
}

export function ProgressBar({
  value,
  max = 100,
  status = 'default',
  animate = true,
  className,
}: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));

  const fillColor = {
    running: 'bg-bio',
    completed: 'bg-cyan',
    failed: 'bg-error',
    default: 'bg-bio',
  }[status];

  return (
    <div
      className={cn('h-1 w-full overflow-hidden rounded-full bg-bio/10', className)}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div
        className={cn(
          'h-full rounded-full transition-all duration-500 ease-out',
          fillColor,
          status === 'running' && 'animate-pulse-glow',
          animate && 'motion-safe:animate-[progress-fill_800ms_ease-out]',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
