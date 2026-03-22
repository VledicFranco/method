/**
 * PRD 019.1: Sessions page with session list and xterm.js terminal viewer.
 * Shows all bridge sessions with status, metadata, and live terminal output.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/layout/PageShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge, type Status } from "@/components/data/StatusBadge";
import { SlideOverPanel } from "@/components/layout/SlideOverPanel";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/formatters";
import type { SessionSummary } from "@/lib/types";
import { Terminal as TerminalIcon, Eye, Trash2, RefreshCw, Users } from "lucide-react";

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
        <span>{formatDuration(idleMs)} ago</span>
      </div>

      <div className="flex items-center justify-end gap-1 mt-2 pt-2 border-t border-bdr">
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
  );
}

// ---- Main Sessions Page ----

export default function Sessions() {
  const queryClient = useQueryClient();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const { data: sessions = [], isLoading, error } = useQuery({
    queryKey: ["sessions"],
    queryFn: ({ signal }) => api.get<SessionSummary[]>("/sessions", signal),
    refetchInterval: 5000,
  });

  const killMutation = useMutation({
    mutationFn: (sessionId: string) => api.del(`/sessions/${sessionId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const selectedSession = useMemo(
    () => sessions.find((s) => s.session_id === selectedSessionId),
    [sessions, selectedSessionId],
  );

  const activeSessions = sessions.filter((s) => s.status !== "dead");
  const deadSessions = sessions.filter((s) => s.status === "dead");

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
  }, [queryClient]);

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
            Failed to load sessions: {(error as Error).message}
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
          <Button variant="secondary" size="sm" leftIcon={<RefreshCw className="h-3.5 w-3.5" />} onClick={handleRefresh}>
            Refresh
          </Button>
        </div>
      }
    >
      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 rounded-card border border-bdr bg-abyss">
          <TerminalIcon className="h-8 w-8 text-txt-muted mb-3" />
          <p className="text-txt-dim text-sm mb-1">No Sessions</p>
          <p className="text-txt-muted text-xs">
            Sessions appear here when spawned via the bridge API or MCP tools.
          </p>
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
                    onKill={() => killMutation.mutate(session.session_id)}
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
                    onKill={() => killMutation.mutate(session.session_id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Session detail slide-over with terminal */}
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
          </div>
        )}
      </SlideOverPanel>
    </PageShell>
  );
}
