import type { Phase } from '../api/types.js';

interface Props {
  phase: Phase | null;
  onClose: () => void;
}

export function PhaseDetail({ phase, onClose }: Props) {
  if (!phase) return null;

  return (
    <div className="phase-detail">
      <div className="phase-detail-header">
        <h3>Phase {phase.id} — {phase.name}</h3>
        <button onClick={onClose}>✕</button>
      </div>
      <div className="phase-detail-body">
        <section>
          <h4>Guidance</h4>
          <p>{phase.guidance}</p>
        </section>
        <section>
          <h4>Output Schema</h4>
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Type</th>
                <th>Required</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {phase.output_schema.map((f) => (
                <tr key={f.name} className={f.soft ? 'soft-row' : ''}>
                  <td><code>{f.name}</code></td>
                  <td>{f.enum ? `enum(${f.enum.join('|')})` : f.type}</td>
                  <td>{f.soft ? 'soft' : '✓'}</td>
                  <td>{f.description ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
