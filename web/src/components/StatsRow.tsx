import { getStats, listSessions } from '../lib/api';

export async function StatsRow() {
  let stats;
  let activeSessions: number = 0;
  try {
    [stats] = await Promise.all([getStats()]);
    const sessions = await listSessions();
    activeSessions = sessions.filter((s) => s.status === 'active').length;
  } catch {
    return null;
  }

  return (
    <div className="stats-row">
      <div className="stat-card">
        <div className="stat-value">{stats.total_sessions}</div>
        <div className="stat-label">Total Sessions</div>
      </div>
      <div className="stat-card">
        <div className="stat-value" style={{ color: 'var(--success)' }}>{activeSessions}</div>
        <div className="stat-label">Active Now</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{stats.completed_sessions}</div>
        <div className="stat-label">Completed</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{stats.methodologies_count}</div>
        <div className="stat-label">Methodologies</div>
      </div>
    </div>
  );
}
