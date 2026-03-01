import Link from 'next/link';
import { listSessions } from '../../lib/api';

interface Props {
  searchParams: Promise<{ project?: string }>;
}

export default async function SessionsPage({ searchParams }: Props) {
  const { project } = await searchParams;
  let sessions;
  try {
    sessions = await listSessions(project);
  } catch {
    return <div className="error">Could not reach server.</div>;
  }

  const title = project ? `Sessions — ${project}` : 'Sessions';

  return (
    <div className="page">
      <h1>{title}</h1>
      <p className="subtitle">{sessions.length} session{sessions.length !== 1 ? 's' : ''}</p>
      {sessions.length === 0 ? (
        <p className="empty-state">No sessions yet. Use method_start in Claude to begin one.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Methodology</th>
              <th>Topic</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link href={`/sessions/${s.id}`}>
                    <code>{s.id}</code>
                  </Link>
                </td>
                <td>{s.methodology_name}</td>
                <td>{s.topic}</td>
                <td>
                  <span className={`status-badge status-${s.status}`}>{s.status}</span>
                </td>
                <td>{Math.round(s.delta * 100)}%</td>
                <td>{new Date(s.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
