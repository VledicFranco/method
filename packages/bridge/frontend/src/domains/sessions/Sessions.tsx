/**
 * Sessions — pure composition root.
 * Wires SessionSidebar, ChatView, PromptInput, StatusBar, and SpawnSessionModal.
 *
 * PRD 029 C-4: URL-driven session selection via :id param.
 * Recovery banner shown when WebSocket reconnects after disconnection.
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { SessionSidebar } from './SessionSidebar';
import { ChatView } from './ChatView';
import { PromptInput } from './PromptInput';
import { StatusBar } from './StatusBar';
import { SpawnSessionModal } from './SpawnSessionModal';
import { useSessions } from './useSessions';
import { useTranscript } from './useTranscript';
import { useProjects } from '@/domains/projects/useProjects';
import { wsManager } from '@/shared/websocket/ws-manager';
import { usePromptStream } from './usePromptStream';
import type { ChatTurn, PromptResult, SpawnRequest } from './types';

// ── Recovery Banner ─────────────────────────────────────────────────────────

interface RecoveryBannerState {
  visible: boolean;
  sessionCount: number;
}

function RecoveryBanner({ visible, sessionCount, onDismiss }: RecoveryBannerState & { onDismiss: () => void }) {
  if (!visible) return null;

  return (
    <div
      style={{
        position: 'relative',
        padding: '10px 16px',
        background: 'var(--bio)',
        color: 'var(--abyss)',
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}
    >
      <span>
        Bridge reconnected — {sessionCount} session{sessionCount !== 1 ? 's' : ''} recovered
      </span>
      <button
        onClick={onDismiss}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--abyss)',
          cursor: 'pointer',
          fontFamily: 'var(--font-mono)',
          fontSize: '14px',
          lineHeight: 1,
          padding: '2px 6px',
        }}
        aria-label="Dismiss recovery banner"
      >
        ✕
      </button>
    </div>
  );
}

// ── Mobile detection ────────────────────────────────────────────────────────

function useIsMobile(breakpoint = 768): boolean {
  const query = useMemo(() => `(max-width: ${breakpoint}px)`, [breakpoint]);
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    setMatches(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

// ── Mobile top bar ──────────────────────────────────────────────────────────

function MobileTopBar({
  sessionName,
  onToggleSidebar,
}: {
  sessionName: string | null;
  onToggleSidebar: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px 12px',
        background: 'var(--abyss)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      <button
        onClick={onToggleSidebar}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          fontSize: '20px',
          cursor: 'pointer',
          padding: '2px 6px',
          lineHeight: 1,
        }}
        aria-label="Toggle session list"
      >
        ≡
      </button>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '13px',
          color: sessionName ? 'var(--text)' : 'var(--text-muted)',
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
      >
        {sessionName ?? 'Sessions'}
      </span>
    </div>
  );
}

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
  const { sessions, refresh, spawn, isSpawning, stale } = useSessions();
  const { projects } = useProjects();
  const { id: activeSessionId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [liveTurns, setLiveTurns] = useState<ChatTurn[]>([]);
  const [isWorking, setIsWorking] = useState(false);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ── Recovery banner state ───────────────────────────────────────
  const [recoveryBanner, setRecoveryBanner] = useState<RecoveryBannerState>({
    visible: false,
    sessionCount: 0,
  });
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasDisconnectedRef = useRef(false);

  useEffect(() => {
    const unsub = wsManager.onConnectionChange((connected) => {
      if (!connected) {
        wasDisconnectedRef.current = true;
      } else if (wasDisconnectedRef.current) {
        // Reconnected after a disconnection — show recovery banner
        wasDisconnectedRef.current = false;
        const activeSessions = sessions.filter((s) => s.status !== 'dead');
        setRecoveryBanner({
          visible: true,
          sessionCount: activeSessions.length,
        });

        // Auto-dismiss after 8 seconds
        if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = setTimeout(() => {
          setRecoveryBanner((prev) => ({ ...prev, visible: false }));
          dismissTimerRef.current = null;
        }, 8000);
      }
    });

    return () => {
      unsub();
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [sessions]);

  const dismissBanner = useCallback(() => {
    setRecoveryBanner((prev) => ({ ...prev, visible: false }));
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  const { data: historicalTurns = [], isLoading: isLoadingTranscript } = useTranscript(activeSessionId ?? null);
  const { streamingText, isStreaming, send: sendStream } = usePromptStream(activeSessionId ?? null);

  // Derived
  const activeSession = sessions.find((s) => s.session_id === activeSessionId) ?? null;

  // Build turns: merge historical, live, and (if streaming) a live streaming turn
  const allTurns: ChatTurn[] = useMemo(() => {
    const base: ChatTurn[] = [...historicalTurns, ...liveTurns];
    // If we're streaming, the last liveTurn is a streaming placeholder — update its output
    if (isStreaming && base.length > 0) {
      const last = base[base.length - 1];
      if (last.kind === 'streaming') {
        return [
          ...base.slice(0, -1),
          { ...last, output: streamingText },
        ];
      }
    }
    return base;
  }, [historicalTurns, liveTurns, isStreaming, streamingText]);

  const totalCost = (activeSession?.metadata as any)?.cost_usd as number | undefined;

  const handleSelect = useCallback((id: string) => {
    navigate('/sessions/' + id);
    setLiveTurns([]);
    setIsWorking(false);
    setSidebarOpen(false);
  }, [navigate]);

  const handleSend = useCallback(
    async (prompt: string): Promise<PromptResult> => {
      if (!activeSessionId) throw new Error('No active session');

      // Add streaming turn immediately (shows dots + accumulating text)
      setLiveTurns((prev) => [...prev, { kind: 'streaming', prompt, output: '' }]);
      setIsWorking(true);

      try {
        const result = await sendStream(prompt);

        const metadata = result.metadata ?? {
          cost_usd: 0,
          num_turns: 0,
          duration_ms: 0,
          stop_reason: 'unknown',
          input_tokens: 0,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
        };

        // Replace streaming turn with completed live turn
        setLiveTurns((prev) => {
          const withoutLast = prev.slice(0, -1);
          return [
            ...withoutLast,
            {
              kind: 'live',
              prompt,
              output: result.output,
              metadata,
              timestamp: new Date().toISOString(),
            },
          ];
        });

        return {
          output: result.output,
          timed_out: result.timed_out,
          metadata: result.metadata,
        };
      } catch (e) {
        // Remove the streaming turn on error
        setLiveTurns((prev) => prev.slice(0, -1));
        throw e;
      } finally {
        setIsWorking(false);
      }
    },
    [activeSessionId, sendStream],
  );

  const handleSpawn = useCallback(
    async (req: SpawnRequest) => {
      const response = await spawn(req);
      setSpawnOpen(false);
      navigate('/sessions/' + response.session_id);
      setLiveTurns([]);
      return response;
    },
    [spawn, navigate],
  );

  // ── Main content (shared between mobile and desktop) ────────
  const mainContent = (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <RecoveryBanner
        visible={recoveryBanner.visible}
        sessionCount={recoveryBanner.sessionCount}
        onDismiss={dismissBanner}
      />
      <ErrorBoundary>
        {activeSession ? (
          <ChatView
            session={activeSession}
            turns={allTurns}
            isWorking={isWorking}
            isLoadingTranscript={isLoadingTranscript}
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
            {isMobile ? 'Tap ≡ to select a session.' : 'Select a session or spawn a new one.'}
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
  );

  // ── Mobile layout ─────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%', background: 'var(--void)' }}>
        <MobileTopBar
          sessionName={activeSession?.nickname ?? null}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        />

        {/* Sidebar overlay */}
        {sidebarOpen && (
          <>
            <div
              onClick={() => setSidebarOpen(false)}
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0, 0, 0, 0.5)',
                zIndex: 40,
              }}
            />
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                bottom: 0,
                width: '280px',
                zIndex: 50,
                boxShadow: '4px 0 24px rgba(0, 0, 0, 0.4)',
              }}
            >
              <SessionSidebar
                sessions={sessions}
                activeId={activeSessionId ?? null}
                onSelect={handleSelect}
                onSpawn={() => { setSpawnOpen(true); setSidebarOpen(false); }}
                onRefresh={refresh}
                stale={stale}
              />
            </div>
          </>
        )}

        {mainContent}

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

  // ── Desktop layout ────────────────────────────────────────────
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
        activeId={activeSessionId ?? null}
        onSelect={handleSelect}
        onSpawn={() => setSpawnOpen(true)}
        onRefresh={refresh}
        stale={stale}
      />
      {mainContent}
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
