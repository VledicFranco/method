/**
 * WS-3: Sessions page with mobile-first chat interface.
 *
 * Mobile (< 768px): session detail is full-screen with transcript + sticky input at bottom.
 * Desktop (>= 768px): horizontal split-pane — session list left, detail panel right.
 *
 * All sessions run in print mode. Output is rendered as plain text transcript.
 */

import { useState, useMemo } from "react";
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
import { useIsMobile } from "@/shared/layout/useIsMobile";
import { cn } from "@/shared/lib/cn";
import { formatDuration, formatTokens } from "@/shared/lib/formatters";
import { useProjects } from "@/domains/projects/useProjects";
import type { SessionSummary } from "@/domains/sessions/types";
import { Terminal as TerminalIcon, Eye, Trash2, RefreshCw, Users, Plus, ArrowLeft, X } from "lucide-react";

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

// ---- Mobile Full-Screen Session Detail ----

function MobileSessionDetail({
  session,
  onBack,
}: {
  session: SessionSummary;
  onBack: () => void;
}) {
  return (
    <PageShell fullScreen>
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-bdr px-sp-4 py-sp-3 shrink-0">
        <button
          onClick={onBack}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-txt-dim hover:text-txt hover:bg-abyss-light transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <TerminalIcon className="h-4 w-4 text-bio shrink-0" />
            <span className="font-display text-sm font-semibold text-txt truncate">
              {session.nickname}
            </span>
            <StatusBadge
              status={(session.status === "idle" ? "running" : session.status) as Status}
              size="sm"
            />
          </div>
          {session.purpose && (
            <p className="text-xs text-txt-dim truncate mt-0.5">{session.purpose}</p>
          )}
        </div>
      </div>

      {/* Transcript area — fills remaining space above prompt bar */}
      <div className="flex-1 overflow-y-auto p-sp-3">
        <pre className="w-full rounded-lg border border-bdr bg-void p-3 font-mono text-xs text-txt whitespace-pre-wrap break-words h-full min-h-[200px]">
          {/* Print-mode output rendered by transcript view */}
        </pre>
      </div>

      {/* Sticky prompt bar at bottom — always visible, above keyboard on mobile */}
      {session.status !== "dead" && (
        <div className="shrink-0 border-t border-bdr p-sp-3 bg-abyss">
          <PromptBar sessionId={session.session_id} />
        </div>
      )}
    </PageShell>
  );
}

// ---- Session Detail Content (shared between desktop slide-over and mobile) ----

function SessionDetailContent({ session }: { session: SessionSummary }) {
  return (
    <div className="space-y-sp-4">
      <div>
        <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Status</p>
        <StatusBadge status={(session.status === "idle" ? "running" : session.status) as Status} />
      </div>

      {session.purpose && (
        <div>
          <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Purpose</p>
          <p className="text-sm text-txt">{session.purpose}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Depth</p>
          <p className="font-mono text-sm text-txt">{session.depth}</p>
        </div>
        <div>
          <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Prompts</p>
          <p className="font-mono text-sm text-txt">{session.prompt_count}</p>
        </div>
        <div>
          <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Mode</p>
          <p className="font-mono text-sm text-txt">{session.mode}</p>
        </div>
        <div>
          <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Isolation</p>
          <p className="font-mono text-sm text-txt">{session.isolation}</p>
        </div>
      </div>

      {/* Token usage detail */}
      <SessionDetailTokens sessionId={session.session_id} />

      {session.parent_session_id && (
        <div>
          <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Parent</p>
          <p className="font-mono text-xs text-bio">{session.parent_session_id}</p>
        </div>
      )}

      {session.children.length > 0 && (
        <div>
          <p className="text-[0.65rem] text-txt-muted uppercase mb-1">Children</p>
          <div className="space-y-1">
            {session.children.map((childId) => (
              <p key={childId} className="font-mono text-xs text-txt-dim">{childId}</p>
            ))}
          </div>
        </div>
      )}

      {/* Transcript output */}
      <div>
        <p className="text-[0.65rem] text-txt-muted uppercase mb-2">Transcript Output</p>
        <pre className="w-full rounded-lg border border-bdr bg-void p-3 font-mono text-xs text-txt whitespace-pre-wrap break-words min-h-[200px] max-h-[400px] overflow-y-auto">
          {/* Print-mode output */}
        </pre>
      </div>

      {/* Prompt bar for live sessions */}
      {session.status !== "dead" && (
        <PromptBar sessionId={session.session_id} />
      )}
    </div>
  );
}

// ---- Session List (extracted for split-pane reuse) ----

function SessionList({
  activeSessions,
  deadSessions,
  selectedSessionId,
  onSelect,
  onKill,
  onSpawnOpen,
  compact = false,
}: {
  activeSessions: SessionSummary[];
  deadSessions: SessionSummary[];
  selectedSessionId: string | null;
  onSelect: (id: string) => void;
  onKill: (id: string) => void;
  onSpawnOpen: () => void;
  compact?: boolean;
}) {
  if (activeSessions.length === 0 && deadSessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 rounded-card border border-bdr bg-abyss">
        <TerminalIcon className="h-8 w-8 text-txt-muted mb-3" />
        <p className="text-txt-dim text-sm mb-1">No Sessions</p>
        <p className="text-txt-muted text-xs mb-4">
          Sessions appear here when spawned via the bridge API or MCP tools.
        </p>
        <Button variant="primary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={onSpawnOpen}>
          Spawn Session
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-sp-6">
      {activeSessions.length > 0 && (
        <div>
          <h3 className="text-xs text-txt-muted uppercase tracking-wider font-medium mb-sp-3">
            Active ({activeSessions.length})
          </h3>
          <div className={cn("grid gap-3", compact ? "grid-cols-1" : "md:grid-cols-2")}>
            {activeSessions.map((session) => (
              <SessionCard
                key={session.session_id}
                session={session}
                selected={selectedSessionId === session.session_id}
                onSelect={() => onSelect(session.session_id)}
                onKill={() => onKill(session.session_id)}
              />
            ))}
          </div>
        </div>
      )}

      {deadSessions.length > 0 && (
        <div>
          <h3 className="text-xs text-txt-muted uppercase tracking-wider font-medium mb-sp-3">
            Completed ({deadSessions.length})
          </h3>
          <div className={cn("grid gap-3", compact ? "grid-cols-1" : "md:grid-cols-2")}>
            {deadSessions.map((session) => (
              <SessionCard
                key={session.session_id}
                session={session}
                selected={selectedSessionId === session.session_id}
                onSelect={() => onSelect(session.session_id)}
                onKill={() => onKill(session.session_id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Desktop Detail Panel (inline, no overlay) ----

function DesktopDetailPanel({
  session,
  onClose,
}: {
  session: SessionSummary;
  onClose: () => void;
}) {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-bdr px-sp-4 py-sp-3 shrink-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <TerminalIcon className="h-4 w-4 text-bio shrink-0" />
            <span className="font-display text-sm font-semibold text-txt truncate">
              {session.nickname}
            </span>
            <StatusBadge
              status={(session.status === "idle" ? "running" : session.status) as Status}
              size="sm"
            />
          </div>
          <p className="text-xs text-txt-dim truncate mt-0.5 font-mono">{session.session_id}</p>
        </div>
        <button
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-txt-dim hover:text-txt hover:bg-abyss-light transition-colors"
          aria-label="Close detail panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-sp-4">
        <SessionDetailContent session={session} />
      </div>
    </div>
  );
}

// ---- Main Sessions Page ----

export default function Sessions() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const isMobile = useIsMobile();
  const { projects } = useProjects();

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

  // Mobile: show full-screen session detail
  if (isMobile && selectedSession) {
    return (
      <MobileSessionDetail
        session={selectedSession}
        onBack={() => setSelectedSessionId(null)}
      />
    );
  }

  const breadcrumbs = selectedSession
    ? [{ label: 'Sessions', path: '/sessions' }, { label: selectedSession.nickname }]
    : [{ label: 'Sessions' }];

  if (isLoading) {
    return (
      <PageShell breadcrumbs={[{ label: 'Sessions' }]}>
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
      <PageShell breadcrumbs={[{ label: 'Sessions' }]}>
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
      wide={selectedSession != null}
      breadcrumbs={breadcrumbs}
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
      {/* Desktop split-pane: session list left, detail right */}
      {!isMobile && selectedSession ? (
        <div className="grid grid-cols-2 gap-4">
          {/* Left: session list (single-column when in split mode) */}
          <div className="overflow-y-auto max-h-[calc(100vh-160px)]">
            <SessionList
              activeSessions={activeSessions}
              deadSessions={deadSessions}
              selectedSessionId={selectedSessionId}
              onSelect={(id) => setSelectedSessionId(id)}
              onKill={(id) => kill(id)}
              onSpawnOpen={() => setSpawnOpen(true)}
              compact
            />
          </div>

          {/* Right: detail panel */}
          <div className="border-l border-bdr pl-4 max-h-[calc(100vh-160px)] overflow-hidden">
            <DesktopDetailPanel
              session={selectedSession}
              onClose={() => setSelectedSessionId(null)}
            />
          </div>
        </div>
      ) : (
        /* No session selected (or mobile fallback) — full-width session list */
        <SessionList
          activeSessions={activeSessions}
          deadSessions={deadSessions}
          selectedSessionId={selectedSessionId}
          onSelect={(id) => setSelectedSessionId(id)}
          onKill={(id) => kill(id)}
          onSpawnOpen={() => setSpawnOpen(true)}
        />
      )}

      {/* Mobile: session detail slide-over (kept for < 768px) */}
      {isMobile && (
        <SlideOverPanel
          open={selectedSession != null}
          onClose={() => setSelectedSessionId(null)}
          title={selectedSession?.nickname ?? ""}
          subtitle={selectedSession?.session_id}
        >
          {selectedSession && <SessionDetailContent session={selectedSession} />}
        </SlideOverPanel>
      )}

      {/* Spawn modal */}
      <SpawnSessionModal
        open={spawnOpen}
        onClose={() => setSpawnOpen(false)}
        onSpawn={spawn}
        isSpawning={isSpawning}
        projects={projects}
      />
    </PageShell>
  );
}
