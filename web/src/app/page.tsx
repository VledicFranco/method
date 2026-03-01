import Link from 'next/link';
import { Suspense } from 'react';
import { listSessions } from '../lib/api';
import { StatsRow } from '../components/StatsRow';
import { LiveSessions } from '../components/LiveSessions';
import { EventStream } from '../components/EventStream';

async function RecentSessionsTable() {
  let sessions;
  try {
    sessions = await listSessions();
  } catch {
    return <p className="error" style={{ padding: '20px 0' }}>Could not reach server.</p>;
  }

  const recent = sessions.slice(0, 20);

  if (recent.length === 0) {
    return <p className="empty-state">No sessions yet. Use <code>method_start</code> in Claude to begin one.</p>;
  }

  return (
    <div className="glass-card" style={{ overflow: 'auto' }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Methodology</th>
            <th>Topic</th>
            <th>Status</th>
            <th>Progress</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((s) => (
            <tr key={s.id}>
              <td>
                <Link href={`/sessions/${s.id}`}>
                  <code>{s.id}</code>
                </Link>
              </td>
              <td>{s.methodology_name}</td>
              <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.topic}
              </td>
              <td>
                <span className={`status-badge status-${s.status}`}>{s.status}</span>
              </td>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 60, height: 3, background: 'rgba(129, 140, 248, 0.12)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.round(s.delta * 100)}%`, height: '100%', background: 'linear-gradient(90deg, #818cf8, #a78bfa)', borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{Math.round(s.delta * 100)}%</span>
                </div>
              </td>
              <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                {new Date(s.updated_at).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Mission Control</h1>
        <div style={{ height: 1, width: 52, background: 'linear-gradient(90deg, #818cf8, transparent)', margin: '6px 0 8px' }} />
        <p className="subtitle">Live methodology sessions</p>
      </div>

      <Suspense fallback={<div className="stats-row" style={{ height: 88 }} />}>
        <StatsRow />
      </Suspense>

      <div className="dashboard-main">
        <div className="dashboard-live">
          <LiveSessions />
        </div>
        <div className="dashboard-events">
          <EventStream />
        </div>
      </div>

      <section className="dashboard-recent">
        <h2>Recent Sessions</h2>
        <Suspense fallback={<div className="empty-state">Loading…</div>}>
          <RecentSessionsTable />
        </Suspense>
      </section>
    </div>
  );
}
