/**
 * WS-3: Session history panel — browse and resume past sessions.
 * Shows all persisted sessions (active + completed + dead) for a given project.
 * Users can tap any past session to see transcript and resume conversation.
 */

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/shared/components/Card';
import { Badge } from '@/shared/components/Badge';
import { Button } from '@/shared/components/Button';
import { StatusBadge, type Status } from '@/shared/data/StatusBadge';
import { SlideOverPanel } from '@/shared/layout/SlideOverPanel';
import { useSessionHistory, useSessionHistoryDetail, type PersistedSessionSummary } from './useSessionHistory';
import { cn } from '@/shared/lib/cn';
import { formatRelativeTime } from '@/shared/lib/formatters';
import { Terminal, Play, Clock, Hash, Loader2 } from 'lucide-react';

function HistoryCard({
  session,
  onSelect,
  onResume,
  isResuming,
}: {
  session: PersistedSessionSummary;
  onSelect: () => void;
  onResume: () => void;
  isResuming: boolean;
}) {
  const statusMap: Record<string, Status> = {
    running: 'running',
    idle: 'running',
    ready: 'running',
    working: 'running',
    dead: 'dead',
  };

  return (
    <div
      className="rounded-card border border-bdr bg-abyss p-sp-4 hover:border-bio/30 transition-colors cursor-pointer"
      onClick={onSelect}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Terminal className="h-4 w-4 text-bio shrink-0" />
          <span className="font-mono text-xs text-txt font-medium truncate">
            {session.nickname}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <StatusBadge status={statusMap[session.status] ?? 'dead'} size="sm" />
          <Badge variant="muted" size="sm">{session.mode}</Badge>
        </div>
      </div>

      {session.purpose && (
        <p className="text-[0.65rem] text-txt-dim mb-2 line-clamp-2">{session.purpose}</p>
      )}

      <div className="flex items-center justify-between text-[0.6rem] text-txt-muted">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Hash className="h-3 w-3" />
            {session.prompt_count} prompts
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatRelativeTime(session.last_activity_at)}
          </span>
        </div>
        {session.status === 'dead' && (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={isResuming ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            onClick={(e) => {
              e.stopPropagation();
              onResume();
            }}
            disabled={isResuming}
          >
            Resume
          </Button>
        )}
      </div>
    </div>
  );
}

export interface SessionHistoryProps {
  /** Filter sessions by workdir (project path) */
  workdir?: string;
  className?: string;
}

export function SessionHistory({ workdir, className }: SessionHistoryProps) {
  const navigate = useNavigate();
  const { sessions, isLoading, error, resume, isResuming } = useSessionHistory(workdir);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const { session: detailSession } = useSessionHistoryDetail(selectedSessionId);

  const handleResume = useCallback(
    async (sessionId: string) => {
      try {
        await resume({ sessionId });
        navigate('/sessions');
      } catch (err) {
        console.error('Resume failed:', err);
      }
    },
    [resume, navigate],
  );

  if (isLoading) {
    return (
      <div className={cn('space-y-3', className)}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-card bg-abyss-light/50 animate-pulse border border-bdr" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <p className="text-error text-sm">Failed to load session history: {error.message}</p>
      </Card>
    );
  }

  if (sessions.length === 0) {
    return (
      <Card className={cn('text-center py-sp-6', className)}>
        <Terminal className="h-6 w-6 text-txt-muted mx-auto mb-2" />
        <p className="text-txt-dim text-sm">No session history</p>
        <p className="text-txt-muted text-xs mt-1">
          Sessions will appear here after they are created.
        </p>
      </Card>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {sessions.map((session) => (
        <HistoryCard
          key={session.session_id}
          session={session}
          onSelect={() => setSelectedSessionId(session.session_id)}
          onResume={() => handleResume(session.session_id)}
          isResuming={isResuming}
        />
      ))}

      {/* Detail slide-over for viewing transcript */}
      <SlideOverPanel
        open={selectedSessionId !== null}
        onClose={() => setSelectedSessionId(null)}
        title={detailSession?.nickname ?? 'Session Detail'}
        subtitle={selectedSessionId ?? undefined}
      >
        {detailSession && (
          <div className="space-y-sp-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Status</p>
                <StatusBadge
                  status={(detailSession.status === 'idle' ? 'running' : detailSession.status) as Status}
                />
              </div>
              <div>
                <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Mode</p>
                <p className="font-mono text-sm text-txt">{detailSession.mode}</p>
              </div>
              <div>
                <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Prompts</p>
                <p className="font-mono text-sm text-txt">{detailSession.prompt_count}</p>
              </div>
              <div>
                <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Last Active</p>
                <p className="text-xs text-txt">{formatRelativeTime(detailSession.last_activity_at)}</p>
              </div>
            </div>

            {detailSession.purpose && (
              <div>
                <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Purpose</p>
                <p className="text-sm text-txt">{detailSession.purpose}</p>
              </div>
            )}

            {detailSession.transcript && detailSession.transcript !== '[see transcript file]' && (
              <div>
                <p className="text-[0.65rem] text-txt-muted uppercase mb-2">Transcript</p>
                <pre className="bg-void rounded-lg border border-bdr p-sp-3 text-xs text-txt-dim font-mono overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap">
                  {detailSession.transcript}
                </pre>
              </div>
            )}

            {detailSession.status === 'dead' && (
              <Button
                variant="primary"
                size="md"
                leftIcon={isResuming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                onClick={() => handleResume(detailSession.session_id)}
                disabled={isResuming}
                className="w-full"
              >
                Resume Session
              </Button>
            )}
          </div>
        )}
      </SlideOverPanel>
    </div>
  );
}
