import Link from 'next/link';
import { listProjects, getStats } from '../../lib/api';

export default async function ProjectsPage() {
  let projects, stats;
  try {
    [projects, stats] = await Promise.all([listProjects(), getStats()]);
  } catch {
    return <div className="error">Could not reach server.</div>;
  }

  return (
    <div className="page">
      <h1>Projects</h1>
      <p className="subtitle">Named project contexts for grouping sessions.</p>

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-value">{stats.total_sessions}</div>
          <div className="stat-label">Total sessions</div>
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

      {projects.length === 0 ? (
        <p className="empty-state">No projects yet. Pass a project slug to method_start.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Slug</th>
              <th>Name</th>
              <th>Created</th>
              <th>Sessions</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/sessions?project=${encodeURIComponent(p.slug)}`}>
                    {p.slug}
                  </Link>
                </td>
                <td>{p.name}</td>
                <td>{new Date(p.created_at).toLocaleDateString()}</td>
                <td>
                  <Link href={`/sessions?project=${encodeURIComponent(p.slug)}`}>
                    View sessions →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
