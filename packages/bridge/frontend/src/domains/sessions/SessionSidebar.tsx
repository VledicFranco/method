/**
 * SessionSidebar — 228px fixed left panel for session navigation.
 * Shows session list, spawn/refresh controls, and footer nav links.
 *
 * PRD 029 C-4: Connection health dot + stale-mode opacity.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { wsManager } from '@/shared/websocket/ws-manager';
import type { SessionSummary } from './types';

export interface SessionSidebarProps {
  sessions: SessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onSpawn: () => void;
  onRefresh: () => void;
  /** When true, session data may be outdated (WebSocket disconnected). */
  stale?: boolean;
}

// ── Connection health states ────────────────────────────────────

type HealthState = 'connected' | 'reconnecting' | 'disconnected';

function useConnectionHealth(): HealthState {
  const [connected, setConnected] = useState(wsManager.connected);

  useEffect(() => {
    return wsManager.onConnectionChange(setConnected);
  }, []);

  // The wsManager reconnects automatically with exponential backoff,
  // so any disconnected state is effectively "reconnecting" until
  // the manager is destroyed. We track a simple connected/not model;
  // "disconnected" would only apply if the manager is permanently down,
  // but since it always retries, we use "reconnecting" for not-connected.
  if (connected) return 'connected';
  return 'reconnecting';
}

function healthDotColor(state: HealthState): string {
  switch (state) {
    case 'connected': return 'var(--bio)';
    case 'reconnecting': return 'var(--solar)';
    case 'disconnected': return 'var(--error)';
  }
}

function healthDotTitle(state: HealthState): string {
  switch (state) {
    case 'connected': return 'Connected';
    case 'reconnecting': return 'Reconnecting...';
    case 'disconnected': return 'Disconnected';
  }
}

// ── Styles ──────────────────────────────────────────────────────

const styles = {
  sidebar: {
    width: '228px',
    minWidth: '228px',
    height: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    background: 'var(--abyss)',
    borderRight: '1px solid var(--border)',
    overflow: 'hidden',
  },
  progressBar: {
    height: '2px',
    background: 'var(--bio)',
    transition: 'opacity 0.3s ease',
    flexShrink: 0,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px 8px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  headerText: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.08em',
    color: 'var(--text-muted)',
    textTransform: 'uppercase' as const,
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
  },
  iconBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--text-muted)',
    fontSize: '16px',
    lineHeight: 1,
    padding: '2px 4px',
    borderRadius: '4px',
    transition: 'color 0.15s ease',
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
  },
  spawnBtn: {
    display: 'block',
    width: 'calc(100% - 16px)',
    margin: '8px',
    padding: '7px 12px',
    background: 'var(--bio)',
    color: 'var(--abyss)',
    border: 'none',
    borderRadius: '6px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'center' as const,
    flexShrink: 0,
    transition: 'opacity 0.15s ease',
  },
  sessionList: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '4px 0',
  },
  sessionItem: (isActive: boolean): React.CSSProperties => ({
    padding: '8px 12px',
    cursor: 'pointer',
    borderLeft: isActive ? '3px solid var(--bio)' : '3px solid transparent',
    background: isActive ? 'var(--bio-dim)' : 'transparent',
    transition: 'background 0.15s ease',
  }),
  sessionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    marginBottom: '2px',
  },
  statusDot: (isRunning: boolean): React.CSSProperties => ({
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    flexShrink: 0,
    background: isRunning ? 'var(--bio)' : 'var(--text-muted)',
    animation: isRunning ? 'sidebar-pulse 2s ease-in-out infinite' : 'none',
  }),
  nickname: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--text)',
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    flex: 1,
    minWidth: 0,
  },
  purpose: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    paddingLeft: '14px',
    marginBottom: '2px',
  },
  stats: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--text-muted)',
    paddingLeft: '14px',
  },
  footer: {
    borderTop: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-around',
    padding: '8px 12px',
    flexShrink: 0,
  },
  footerLink: {
    color: 'var(--text-muted)',
    textDecoration: 'none',
    fontSize: '18px',
    lineHeight: 1,
    padding: '4px 6px',
    borderRadius: '4px',
    transition: 'color 0.15s ease',
  },
};

// ── Component ───────────────────────────────────────────────────

export function SessionSidebar({
  sessions,
  activeId,
  onSelect,
  onSpawn,
  onRefresh,
  stale = false,
}: SessionSidebarProps) {
  const hasRunning = sessions.some((s) => s.status === 'running');
  const health = useConnectionHealth();

  return (
    <>
      {/* Keyframe for status dot pulse + health dot pulse — injected inline */}
      <style>{`
        @keyframes sidebar-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes health-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
      `}</style>

      <aside style={styles.sidebar}>
        {/* Bio progress bar */}
        <div
          style={{
            ...styles.progressBar,
            opacity: hasRunning ? 1 : 0,
          }}
          aria-hidden="true"
        />

        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <span style={styles.headerText}>Sessions</span>
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: healthDotColor(health),
                display: 'inline-block',
                flexShrink: 0,
                animation: health !== 'connected' ? 'health-pulse 1.5s ease-in-out infinite' : 'none',
              }}
              title={healthDotTitle(health)}
              aria-label={healthDotTitle(health)}
            />
          </div>
          <div style={styles.headerActions}>
            <button
              style={styles.iconBtn}
              onClick={onRefresh}
              aria-label="Refresh sessions"
              title="Refresh"
            >
              ⟳
            </button>
            <Link to="/" style={styles.iconBtn} title="Dashboard" aria-label="Go to dashboard">
              ⌂
            </Link>
          </div>
        </div>

        {/* Spawn button */}
        <button style={styles.spawnBtn} onClick={onSpawn}>
          ＋ new session
        </button>

        {/* Session list */}
        <div
          style={{
            ...styles.sessionList,
            opacity: stale ? 0.5 : 1,
            transition: 'opacity 0.3s ease',
          }}
        >
          {sessions.map((session) => {
            const isActive = session.session_id === activeId;
            const isRunning = session.status === 'running' || session.status === 'idle' || session.status === 'ready' || session.status === 'working';
            const cost = typeof session.metadata?.cost_usd === 'number'
              ? (session.metadata.cost_usd as number)
              : 0;

            return (
              <div
                key={session.session_id}
                style={styles.sessionItem(isActive)}
                onClick={() => onSelect(session.session_id)}
                data-active={isActive ? 'true' : 'false'}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onSelect(session.session_id);
                }}
              >
                <div style={styles.sessionRow}>
                  <span style={styles.statusDot(isRunning)} />
                  <span style={styles.nickname}>{session.nickname}</span>
                </div>
                {session.purpose && (
                  <div style={styles.purpose}>{session.purpose}</div>
                )}
                <div style={styles.stats}>
                  {session.prompt_count}p · ${cost.toFixed(3)}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer nav */}
        <nav style={styles.footer} aria-label="Navigation">
          <Link to="/sessions" style={styles.footerLink} title="Sessions">
            ≡
          </Link>
          <Link to="/settings" style={styles.footerLink} title="Settings">
            ⚙
          </Link>
          <Link to="/governance" style={styles.footerLink} title="Governance">
            ?
          </Link>
        </nav>
      </aside>
    </>
  );
}
