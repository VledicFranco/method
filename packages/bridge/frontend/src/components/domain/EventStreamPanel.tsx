import { useEffect, useState } from 'react';
import { useEventStream } from '@/hooks/useEventStream';
import { useProjects } from '@/hooks/useProjects';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loader2, AlertCircle, Zap } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ProjectEvent } from '@/lib/types';

export interface EventStreamPanelProps {
  /** Optional initial project ID filter */
  initialProjectId?: string;
  /** Enable auto-scroll to latest events */
  autoScroll?: boolean;
}

function isGenesisEvent(event: ProjectEvent): boolean {
  return (
    event.type === 'genesis_report' ||
    event.type === 'genesis_observation' ||
    (event.metadata?.is_genesis === true)
  );
}

function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return 'unknown';
  }
}

function getEventTypeColor(type: string): string {
  switch (type) {
    case 'genesis_report':
      return 'text-solar';
    case 'genesis_observation':
      return 'text-solar';
    case 'config_updated':
      return 'text-bio';
    case 'discovery_complete':
      return 'text-bio';
    case 'error':
      return 'text-error';
    default:
      return 'text-txt-muted';
  }
}

export function EventStreamPanel({
  initialProjectId,
  autoScroll = true,
}: EventStreamPanelProps) {
  const { projects } = useProjects();
  const [filterProjectId, setFilterProjectId] = useState<string | undefined>(initialProjectId);
  const { events, loading, error } = useEventStream({
    projectId: filterProjectId,
    pollIntervalMs: 3000,
    enabled: true,
  });

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (autoScroll) {
      const container = document.getElementById('event-stream-container');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }, [events, autoScroll]);

  const displayedEvents = events.slice(-50); // Show last 50 events
  const reversedEvents = [...displayedEvents].reverse(); // Show newest first

  return (
    <div className="space-y-sp-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-txt">Event Stream</h2>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-txt-dim" />}
      </div>

      {/* Project Filter (F-E-2: Mobile text wrapping) */}
      <div className="flex gap-sp-2 flex-wrap">
        <button
          onClick={() => setFilterProjectId(undefined)}
          className={cn(
            'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
            'overflow-hidden text-ellipsis whitespace-nowrap max-w-full',
            !filterProjectId
              ? 'bg-bio text-void'
              : 'bg-abyss border border-bdr text-txt-dim hover:bg-abyss-light',
          )}
        >
          All Projects
        </button>
        {projects.map((project) => (
          <button
            key={project.id}
            onClick={() => setFilterProjectId(project.id)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              'overflow-hidden text-ellipsis whitespace-nowrap max-w-xs',
              filterProjectId === project.id
                ? 'bg-bio text-void'
                : 'bg-abyss border border-bdr text-txt-dim hover:bg-abyss-light',
            )}
            title={project.name}
          >
            {project.name}
          </button>
        ))}
      </div>

      {/* Error State */}
      {error && (
        <Card variant="default" padding="md" accent="error">
          <div className="flex gap-sp-3 items-start">
            <AlertCircle className="h-5 w-5 text-error shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-txt">Failed to load events</p>
              <p className="text-sm text-txt-dim mt-1">{error}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Events List */}
      <div
        id="event-stream-container"
        className="h-96 overflow-y-auto rounded-card border border-bdr bg-void/30 p-sp-4 space-y-sp-2"
      >
        {events.length === 0 ? (
          <div className="flex items-center justify-center h-full text-txt-dim text-sm">
            {loading ? 'Listening for events...' : 'No events yet'}
          </div>
        ) : (
          reversedEvents.map((event) => {
            const isGenesis = isGenesisEvent(event);
            return (
              <div
                key={event.id}
                className={cn(
                  'p-sp-3 rounded-lg border text-xs transition-colors',
                  isGenesis
                    ? 'border-solar/30 bg-solar/5'
                    : 'border-bdr/50 bg-abyss-light/30',
                )}
              >
                <div className="flex items-start justify-between gap-sp-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-sp-2">
                      {isGenesis && <Zap className="h-3.5 w-3.5 text-solar shrink-0" />}
                      <span className={cn('font-medium', getEventTypeColor(event.type))}>
                        {event.type}
                      </span>
                      <span className="text-txt-muted">•</span>
                      <code className="text-txt-muted font-mono">
                        {event.projectId.slice(0, 8)}
                      </code>
                    </div>
                    {event.payload && Object.keys(event.payload).length > 0 && (
                      <div className="mt-sp-1.5 pl-sp-2 border-l border-bdr/30 text-txt-dim">
                        {Object.entries(event.payload)
                          .slice(0, 2) // Show first 2 payload items
                          .map(([key, value]) => (
                            <div key={key} className="line-clamp-1">
                              <span className="font-mono text-xs">{key}:</span>{' '}
                              <span className="text-xs">
                                {typeof value === 'string'
                                  ? value.slice(0, 60)
                                  : JSON.stringify(value).slice(0, 60)}
                              </span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                  <time className="shrink-0 text-txt-muted whitespace-nowrap">
                    {formatTimestamp(event.timestamp)}
                  </time>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Event Count */}
      {events.length > 0 && (
        <p className="text-xs text-txt-muted">
          Showing latest {displayedEvents.length} of {events.length} events
          {filterProjectId && ` (filtered)`}
        </p>
      )}
    </div>
  );
}
