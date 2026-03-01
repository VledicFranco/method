'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listSessions } from '../lib/api-client';
import type { Session } from '../lib/types';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export function LiveSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const data = await listSessions('active');
        if (!cancelled) setSessions(data);
      } catch {
        // server may not be up yet
      }
    }

    poll();
    const interval = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return (
    <div>
      <div className="live-sessions-header">
        <div className="live-dot" />
        <h2>Active Sessions</h2>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {sessions.length} active
        </span>
      </div>

      {sessions.length === 0 ? (
        <div className="session-empty">
          <p>No active sessions.</p>
          <p>Start one with <code>method_start</code> in Claude.</p>
        </div>
      ) : (
        <div className="session-cards-grid">
          {sessions.map((s) => (
            <Link key={s.id} href={`/sessions/${s.id}`} style={{ textDecoration: 'none' }}>
              <div className="session-card">
                <div className="session-card-header">
                  <div>
                    <div className="session-card-method">{s.methodology_name}</div>
                    <div className="session-card-id">{s.id}</div>
                  </div>
                  <span className="status-badge status-active">active</span>
                </div>
                <div className="session-card-topic">{s.topic}</div>
                <div className="session-progress-track">
                  <div
                    className="session-progress-bar"
                    style={{ width: `${Math.round(s.delta * 100)}%` }}
                  />
                </div>
                <div className="session-card-footer">
                  <span className="session-card-phase">
                    Phase {s.current_phase + 1} / {s.total_phases}
                  </span>
                  <span>{timeAgo(s.updated_at)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
