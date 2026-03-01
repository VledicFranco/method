import { notFound } from 'next/navigation';
import { getSession } from '../../../lib/api';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SessionDetailPage({ params }: Props) {
  const { id } = await params;

  let session;
  try {
    session = await getSession(id);
  } catch {
    notFound();
  }

  return (
    <div className="page">
      <h1>Session</h1>
      <dl className="session-dl">
        <dt>ID</dt>
        <dd><code>{session.id}</code></dd>
        <dt>Methodology</dt>
        <dd>{session.methodology_name}</dd>
        <dt>Topic</dt>
        <dd>{session.topic}</dd>
        <dt>Status</dt>
        <dd><span className={`status-badge status-${session.status}`}>{session.status}</span></dd>
        <dt>Progress</dt>
        <dd>Phase {session.current_phase} / {session.total_phases} ({Math.round(session.delta * 100)}%)</dd>
        <dt>Created</dt>
        <dd>{new Date(session.created_at).toLocaleString()}</dd>
        <dt>Updated</dt>
        <dd>{new Date(session.updated_at).toLocaleString()}</dd>
      </dl>

      {Object.keys(session.phase_outputs).length > 0 && (
        <section>
          <h2>Phase Outputs</h2>
          {Object.entries(session.phase_outputs).map(([phase, output]) => (
            <details key={phase} className="phase-output-block">
              <summary>Phase {phase}</summary>
              <pre>{JSON.stringify(output, null, 2)}</pre>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}
