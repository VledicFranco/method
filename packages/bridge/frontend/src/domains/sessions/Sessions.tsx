/**
 * Sessions — pure composition root.
 * Wires SessionSidebar, ChatView, PromptInput, StatusBar, and SpawnSessionModal.
 */

import React, { useState, useCallback } from 'react';
import { SessionSidebar } from './SessionSidebar';
import { ChatView } from './ChatView';
import { PromptInput } from './PromptInput';
import { StatusBar } from './StatusBar';
import { SpawnSessionModal } from './SpawnSessionModal';
import { useSessions } from './useSessions';
import { useTranscript } from './useTranscript';
import { api } from '@/shared/lib/api';
import { useProjects } from '@/domains/projects/useProjects';
import type { ChatTurn, PromptResult, PromptResponse, SpawnRequest } from './types';

// ── ErrorBoundary ────────────────────────────────────────────────────────────

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--error)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          <div>&#x2297; render error: {this.state.error?.message}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export default function Sessions() {
  const { sessions, refresh, spawn, isSpawning } = useSessions();
  const { projects } = useProjects();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [liveTurns, setLiveTurns] = useState<ChatTurn[]>([]);
  const [isWorking, setIsWorking] = useState(false);
  const [spawnOpen, setSpawnOpen] = useState(false);

  const { data: historicalTurns = [] } = useTranscript(activeSessionId);

  // Derived
  const activeSession = sessions.find((s) => s.session_id === activeSessionId) ?? null;
  const allTurns: ChatTurn[] = [...historicalTurns, ...liveTurns];
  const totalCost = (activeSession?.metadata as any)?.cost_usd as number | undefined;

  const handleSelect = useCallback((id: string) => {
    setActiveSessionId(id);
    setLiveTurns([]);
    setIsWorking(false);
  }, []);

  const handleSend = useCallback(
    async (prompt: string): Promise<PromptResult> => {
      if (!activeSessionId) throw new Error('No active session');

      // Add pending turn immediately
      setLiveTurns((prev) => [...prev, { kind: 'pending', prompt }]);
      setIsWorking(true);

      try {
        const response = await api.post<PromptResponse>(
          `/sessions/${activeSessionId}/prompt`,
          { prompt, timeout_ms: 300_000 },
        );

        const result: PromptResult = {
          output: response.output,
          timed_out: response.timed_out,
          metadata: response.metadata,
        };

        // Replace pending turn with live turn
        setLiveTurns((prev) => {
          const withoutLast = prev.slice(0, -1);
          return [
            ...withoutLast,
            {
              kind: 'live',
              prompt,
              output: result.output,
              metadata: result.metadata ?? {
                cost_usd: 0,
                num_turns: 0,
                duration_ms: 0,
                stop_reason: 'unknown',
                input_tokens: 0,
                output_tokens: 0,
                cache_read_tokens: 0,
                cache_write_tokens: 0,
              },
              timestamp: new Date().toISOString(),
            },
          ];
        });

        return result;
      } catch (e) {
        // Remove the pending turn on error
        setLiveTurns((prev) => prev.slice(0, -1));
        throw e;
      } finally {
        setIsWorking(false);
      }
    },
    [activeSessionId],
  );

  const handleSpawn = useCallback(
    async (req: SpawnRequest) => {
      const response = await spawn(req);
      setSpawnOpen(false);
      setActiveSessionId(response.session_id);
      setLiveTurns([]);
      return response;
    },
    [spawn],
  );

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        width: '100%',
        background: 'var(--void)',
      }}
    >
      <SessionSidebar
        sessions={sessions}
        activeId={activeSessionId}
        onSelect={handleSelect}
        onSpawn={() => setSpawnOpen(true)}
        onRefresh={refresh}
      />
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <ErrorBoundary>
          {activeSession ? (
            <ChatView
              session={activeSession}
              turns={allTurns}
              isWorking={isWorking}
            />
          ) : (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
              }}
            >
              Select a session or spawn a new one.
            </div>
          )}
        </ErrorBoundary>
        <PromptInput
          sessionId={activeSessionId ?? ''}
          disabled={!activeSession || activeSession.status === 'dead' || isWorking}
          onSend={handleSend}
        />
        {activeSession && <StatusBar session={activeSession} totalCost={totalCost} />}
      </div>
      <SpawnSessionModal
        open={spawnOpen}
        onClose={() => setSpawnOpen(false)}
        onSpawn={handleSpawn}
        isSpawning={isSpawning}
        projects={projects}
      />
    </div>
  );
}
