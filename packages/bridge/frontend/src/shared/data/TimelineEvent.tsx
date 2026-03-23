import { type ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

export interface TimelineEventData {
  id: string;
  type: string;
  title: string;
  context?: string;
  timestamp: string;
  dotColor?: string;
  actions?: Array<{
    label: string;
    onClick: () => void;
  }>;
}

export interface TimelineEventProps {
  event: TimelineEventData;
  onClick?: () => void;
  className?: string;
}

export function TimelineEvent({ event, onClick, className }: TimelineEventProps) {
  const dotColor = event.dotColor ?? 'bg-bio';

  return (
    <div
      className={cn(
        'group relative flex gap-sp-4 animate-slide-in-left',
        className,
      )}
    >
      {/* Timeline dot + line */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            'h-3 w-3 shrink-0 rounded-full mt-1.5',
            dotColor,
          )}
        />
        <div className="w-0.5 flex-1 bg-bdr" />
      </div>

      {/* Event card */}
      <div
        className={cn(
          'flex-1 mb-sp-4 rounded-card border border-bdr bg-abyss p-sp-4 transition-all duration-200',
          onClick && 'cursor-pointer hover:border-bdr-hover hover:bg-abyss-light hover:-translate-y-0.5',
        )}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-txt">{event.title}</p>
            {event.context && (
              <p className="text-xs text-txt-dim mt-1 line-clamp-2">{event.context}</p>
            )}
          </div>
          <time className="shrink-0 text-xs text-txt-muted font-mono">
            {new Date(event.timestamp).toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </time>
        </div>

        {/* Actions */}
        {event.actions && event.actions.length > 0 && (
          <div className="flex gap-3 mt-sp-3">
            {event.actions.map((action) => (
              <button
                key={action.label}
                onClick={(e) => {
                  e.stopPropagation();
                  action.onClick();
                }}
                className="text-xs text-bio hover:text-bio/80 font-medium transition-colors"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
