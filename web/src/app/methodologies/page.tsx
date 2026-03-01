import Link from 'next/link';
import { listMethodologies } from '../../lib/api';

export default async function MethodologiesPage() {
  let methodologies;
  try {
    methodologies = await listMethodologies();
  } catch {
    return <div className="error">Could not reach server. Is the method server running?</div>;
  }

  return (
    <div className="page">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: '0 0 6px', fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.03em' }}>
          Methodologies
        </h1>
        <div style={{ height: 1, width: 52, background: 'linear-gradient(90deg, #818cf8, transparent)', marginBottom: 10 }} />
        <p className="subtitle" style={{ margin: 0 }}>Select a methodology to visualize its phase DAG and read guidance.</p>
      </div>
      <div className="glass-card">
        <ul className="methodology-list" style={{ width: '100%', borderRight: 'none', background: 'transparent', backdropFilter: 'none', WebkitBackdropFilter: 'none' }}>
          {methodologies.map((m) => (
            <li key={m.name}>
              <Link href={`/methodologies/${encodeURIComponent(m.name)}`}>
                <span className="phase-count">{m.phase_count} phases</span>
                <strong>{m.name}</strong>
                <p>{m.description}</p>
              </Link>
            </li>
          ))}
          {methodologies.length === 0 && (
            <li className="empty-state">No methodologies loaded.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
