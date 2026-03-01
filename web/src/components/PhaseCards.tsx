import ReactMarkdown from 'react-markdown';
import type { Phase } from '../lib/types';

interface PhaseCardsProps {
  phases: Phase[];
}

export function PhaseCards({ phases }: PhaseCardsProps) {
  return (
    <div className="phase-cards">
      {phases.map((phase) => (
        <div key={phase.id} className="phase-card glass-card">
          <div className="phase-card-header">
            <span className="phase-card-num">#{phase.id}</span>
            <span className="phase-card-name">{phase.name}</span>
            {phase.role && <span className="phase-card-role">{phase.role}</span>}
          </div>

          {phase.guidance && (
            <div className="phase-guidance">
              <ReactMarkdown>{phase.guidance}</ReactMarkdown>
            </div>
          )}

          {Object.keys(phase.output_schema).length > 0 && (
            <div className="phase-card-section">
              <h4 className="phase-card-section-title">Output Schema</h4>
              <table className="output-schema-table">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Type</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(phase.output_schema).map(([field, spec]) => (
                    <tr key={field}>
                      <td><code>{field}</code></td>
                      <td>
                        <code>{spec.type}</code>
                        {spec.min_items !== undefined && <span className="schema-constraint"> ≥{spec.min_items}</span>}
                        {spec.max_items !== undefined && <span className="schema-constraint"> ≤{spec.max_items}</span>}
                        {spec.min_length !== undefined && <span className="schema-constraint"> ≥{spec.min_length}ch</span>}
                        {spec.min_value !== undefined && <span className="schema-constraint"> [{spec.min_value}–{spec.max_value}]</span>}
                        {spec.enum && <span className="schema-constraint"> {spec.enum.join(' | ')}</span>}
                      </td>
                      <td>{spec.description ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {phase.invariants.length > 0 && (
            <div className="phase-card-section">
              <h4 className="phase-card-section-title">Invariants</h4>
              <ul className="invariants-list">
                {phase.invariants.map((inv) => (
                  <li key={inv.id} className={inv.hard ? 'invariant-hard' : 'invariant-soft'}>
                    <span className="inv-badge">{inv.hard ? 'hard' : 'soft'}</span>
                    <span className="inv-id">{inv.id}</span>
                    <span className="inv-desc">{inv.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
