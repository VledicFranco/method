/**
 * PRD 019.1: Sessions page with session list and xterm.js terminal viewer.
 * Shows all bridge sessions with status, metadata, and live terminal output.
 * Now uses libified hooks and components (SpawnSessionModal, PromptBar, SessionTokenBadge).
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { PageShell } from "@/shared/layout/PageShell";
import { Card } from "@/shared/components/Card";
import { Button } from "@/shared/components/Button";
import { Badge } from "@/shared/components/Badge";
import { StatusBadge, type Status } from "@/shared/data/StatusBadge";
import { SlideOverPanel } from "@/shared/layout/SlideOverPanel";
import { SpawnSessionModal } from "@/domains/sessions/SpawnSessionModal";
import { PromptBar } from "@/domains/sessions/PromptBar";
import { SessionTokenBadge } from "@/domains/tokens/SessionTokenBadge";
import { useSessions } from "@/domains/sessions/useSessions";
import { useSessionTokens } from "@/domains/tokens/useTokens";
import { cn } from "@/shared/lib/cn";
import { formatDuration, formatTokens } from "@/shared/lib/formatters";
import type { SessionSummary } from "@/domains/sessions/types";
import { Terminal as TerminalIcon, Eye, Trash2, RefreshCw, Users, Plus } from "lucide-react";

// ---- xterm.js Terminal ----

function TerminalViewer({ sessionId, enabled }: { sessionId: string; enabled: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    let mounted = true;

    async function initTerminal() {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      // xterm CSS
      await import("@xterm/xterm/css/xterm.css");

      if (!mounted || !containerRef.current) return;

      const term = new Terminal({
        theme: {
          background: "#080e14",
          foreground: "#c8cdd2",
          cursor: "#00c9a7",
          selectionBackground: "rgba(0, 201, 167, 0.2)",
          black: "#080e14",
          red: "#e05a5a",
          green: "#00c9a7",
          yellow: "#e8a45a",
          blue: "#5a9ae0",
          magenta: "#7b5fb5",
          cyan: "#00e5cc",
          white: "#c8cdd2",
        },
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 13,
        cursorBlink: false,
        disableStdin: true,
        scrollback: 5000,
      });

      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current!);
      fit.fit();
      termRef.current = term;

      // Connect to SSE stream
      const es = new EventSource(`/sessions/${sessionId}/stream`);
      esRef.current = es;

      es.onmessage = (event) => {
        if (mounted && term) {
          term.write(event.data);
        }
      };

      // Handle window resize
      const resizeObserver = new ResizeObserver(() => {
        if (mounted) fit.fit();
      });
      resizeObserver.observe(containerRef.current!);

      return () => {
        resizeObserver.disconnect();
      };
    }

    const cleanup = initTerminal();

    return () => {
      mounted = false;
      esRef.current?.close();
      esRef.current = null;
      termRef.current?.dispose();
      termRef.current = null;
      cleanup?.then((fn) => fn?.());
    };
  }, [sessionId, enabled]);

  return (
    <div
      ref={containerRef}
      className="w-full h-[400px] rounded-lg overflow-hidden border border-bdr"
    />
  );
}

// ---- Session Card ----

function SessionCard({
  session,
  selected,
  onSelect,
  onKill,
}: {
  session: SessionSummary;
  selected: boolean;
  onSelect: () => void;
  onKill: () => void;
}) {
  const statusMap: Record<string, Status> = {
    running: "running",
    idle: "running",
    completed: "completed",
    dead: "dead",
    suspended: "suspended",
  };

  const now = Date.now();
  const lastActivity = new Date(session.last_activity_at).getTime();
  const idleMs = now - lastActivity;

  return (
    <div
      className={cn(
        "rounded-card border p-sp-4 cursor-pointer transition-all hover:border-bio/50",
        selected ? "border-bio bg-bio-dim" : "border-bdr bg-abyss",
        session.stale && "opacity-60",
      )}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <TerminalIcon className="h-4 w-4 text-bio shrink-0" />
          <span className="font-mono text-xs text-txt font-medium truncate">
            {session.nickname}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <StatusBadge status={statusMap[session.status] ?? "pending"} size="sm" />
          {session.stale && <Badge variant="solar" label="STALE" size="sm" />}
        </div>
      </div>

      {session.purpose && (
        <p className="text-[0.65rem] text-txt-dim mb-2 line-clamp-2">{session.purpose}</p>
      )}

      <div className="flex items-center justify-between text-[0.6rem] text-txt-muted">
        <div className="flex items-center gap-3">
          <span>Depth: {session.depth}</span>
          <span>Prompts: {session.prompt_count}</span>
          {session.children.length > 0 && (
            <span className="flex items-center gap-0.5">
              <Users className="h-3 w-3" />
              {session.children.length}
            </span>
          )}
        </div>
        <SessionTokenBadge sessionId={session.session_id} />
      </div>

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-bdr">
        <span className="text-[0.55rem] text-txt-muted">{formatDuration(idleMs)} ago</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Eye className="h-3 w-3" />}
            onClick={(e) => { e.stopPropagation(); onSelect(); }}
          >
            View
          </Button>
          {session.status !== "dead" && (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Trash2 className="h-3 w-3 text-error" />}
              onClick={(e) => { e.stopPropagation(); onKill(); }}
            >
              Kill
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Session Detail Token Info ----

function SessionDetailTokens({ sessionId }: { sessionId: string }) {
  const { data: tokens } = useSessionTokens(sessionId);
  if (!tokens) return null;

  const rateColor =
    tokens.cacheHitRate >= 70 ? 'text-bio' : tokens.cacheHitRate >= 40 ? 'text-solar' : 'text-txt-muted';

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Tokens</p>
        <p className="font-mono text-sm text-txt">{formatTokens(tokens.totalTokens)}</p>
        <p className="font-mono text-[0.6rem] text-txt-muted">
          in: {formatTokens(tokens.inputTokens)} / out: {formatTokens(tokens.outputTokens)}
        </p>
      </div>
      <div>
        <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Cache Hit Rate</p>
        <p className={cn('font-mono text-sm font-medium', rateColor)}>
          {tokens.cacheHitRate.toFixed(1)}%
        </p>
        <p className="font-mono text-[0.6rem] text-txt-muted">
          {formatTokens(tokens.cacheReadTokens)} cached
        </p>
      </div>
    </div>
  );
}

// ---- Main Sessions Page ----

export default function Sessions() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [spawnOpen, setSpawnOpen] = useState(false);

  const {
    sessions,
    activeSessions,
    deadSessions,
    isLoading,
    error,
    refresh,
    kill,
    spawn,
    isSpawning,
  } = useSessions();

  const selectedSession = useMemo(
    () => sessions.find((s) => s.session_id === selectedSessionId),
    [sessions, selectedSessionId],
  );

  if (isLoading) {
    return (
      <PageShell title="Sessions">
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-card bg-abyss-light/50 animate-pulse border border-bdr" />
          ))}
        </div>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell title="Sessions">
        <Card>
          <p className="text-error text-sm">
            Failed to load sessions: {error.message}
          </p>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Sessions"
      actions={
        <div className="flex items-center gap-2">
          <Badge variant="default" label={`${activeSessions.length} active`} />
          <Button variant="secondary" size="sm" leftIcon={<RefreshCw className="h-3.5 w-3.5" />} onClick={refresh}>
            Refresh
          </Button>
          <Button variant="primary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setSpawnOpen(true)}>
            Spawn
          </Button>
        </div>
      }
    >
      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 rounded-card border border-bdr bg-abyss">
          <TerminalIcon className="h-8 w-8 text-txt-muted mb-3" />
          <p className="text-txt-dim text-sm mb-1">No Sessions</p>
          <p className="text-txt-muted text-xs mb-4">
            Sessions appear here when spawned via the bridge API or MCP tools.
          </p>
          <Button variant="primary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setSpawnOpen(true)}>
            Spawn Session
          </Button>
        </div>
      ) : (
        <div className="space-y-sp-6">
          {/* Active sessions */}
          {activeSessions.length > 0 && (
            <div>
              <h3 className="text-xs text-txt-muted uppercase tracking-wider font-medium mb-sp-3">
                Active ({activeSessions.length})
              </h3>
              <div className="grid gap-3 md:grid-cols-2">
                {activeSessions.map((session) => (
                  <SessionCard
                    key={session.session_id}
                    session={session}
                    selected={selectedSessionId === session.session_id}
                    onSelect={() => setSelectedSessionId(session.session_id)}
                    onKill={() => kill(session.session_id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Dead sessions */}
          {deadSessions.length > 0 && (
            <div>
              <h3 className="text-xs text-txt-muted uppercase tracking-wider font-medium mb-sp-3">
                Completed ({deadSessions.length})
              </h3>
              <div className="grid gap-3 md:grid-cols-2">
                {deadSessions.map((session) => (
                  <SessionCard
                    key={session.session_id}
                    session={session}
                    selected={selectedSessionId === session.session_id}
                    onSelect={() => setSelectedSessionId(session.session_id)}
                    onKill={() => kill(session.session_id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Session detail slide-over with terminal + prompt bar */}
      <SlideOverPanel
        open={selectedSession !== null}
        onClose={() => setSelectedSessionId(null)}
        title={selectedSession?.nickname ?? ""}
        subtitle={selectedSession?.session_id}
      >
        {selectedSession && (
          <div className="space-y-sp-4">
            <div>
              <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Status</p>
              <StatusBadge status={(selectedSession.status === "idle" ? "running" : selectedSession.status) as Status} />
            </div>

            {selectedSession.purpose && (
              <div>
                <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Purpose</p>
                <p className="text-sm text-txt">{selectedSession.purpose}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Depth</p>
                <p className="font-mono text-sm text-txt">{selectedSession.depth}</p>
              </div>
              <div>
                <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Prompts</p>
                <p className="font-mono text-sm text-txt">{selectedSession.prompt_count}</p>
              </div>
              <div>
                <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Mode</p>
                <p className="font-mono text-sm text-txt">{selectedSession.mode}</p>
              </div>
              <div>
                <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Isolation</p>
                <p className="font-mono text-sm text-txt">{selectedSession.isolation}</p>
              </div>
            </div>

            {/* Token usage detail */}
            <SessionDetailTokens sessionId={selectedSession.session_id} />

            {selectedSession.parent_session_id && (
              <div>
                <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Parent</p>
                <p className="font-mono text-xs text-bio">{selectedSession.parent_session_id}</p>
              </div>
            )}

            {selectedSession.children.length > 0 && (
              <div>
                <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Children</p>
                <div className="space-y-1">
                  {selectedSession.children.map((childId) => (
                    <p key={childId} className="font-mono text-xs text-txt-dim">{childId}</p>
                  ))}
                </div>
              </div>
            )}

            {/* Live terminal */}
            <div>
              <p className="text-[0.65rem] text-txt-muted uppercase mb-2">Terminal Output</p>
              <TerminalViewer
                sessionId={selectedSession.session_id}
                enabled={selectedSession.status !== "dead"}
              />
            </div>

            {/* Prompt bar for live sessions */}
            {selectedSession.status !== "dead" && selectedSession.mode === "pty" && (
              <PromptBar sessionId={selectedSession.session_id} />
            )}
          </div>
        )}
      </SlideOverPanel>

      {/* Spawn modal */}
      <SpawnSessionModal
        open={spawnOpen}
        onClose={() => setSpawnOpen(false)}
        onSpawn={spawn}
        isSpawning={isSpawning}
      />
    </PageShell>
  );
}
