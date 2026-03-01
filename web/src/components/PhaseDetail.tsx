'use client';

import type { Phase } from '../lib/types';

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
        {phase.role && (
          <section>
            <h4>Role</h4>
            <p className="phase-role">{phase.role}</p>
          </section>
        )}
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
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(phase.output_schema).map(([name, field]) => (
                <tr key={name}>
                  <td><code>{name}</code></td>
                  <td>{field.enum ? `enum(${field.enum.join('|')})` : field.type}</td>
                  <td>{field.description ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        {phase.invariants.length > 0 && (
          <section>
            <h4>Invariants</h4>
            <ul className="invariants-list">
              {phase.invariants.map((inv) => (
                <li key={inv.id} className={inv.hard ? 'invariant-hard' : 'invariant-soft'}>
                  <span className="inv-badge">{inv.hard ? 'hard' : 'soft'}</span>
                  <span className="inv-id">{inv.id}</span>
                  <span className="inv-desc">{inv.description}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
