import type { MethodologySummary } from '../api/types.js';

interface Props {
  methodologies: MethodologySummary[];
  selected: string | null;
  onSelect: (name: string) => void;
}

export function MethodologyList({ methodologies, selected, onSelect }: Props) {
  return (
    <aside className="methodology-list">
      <h2>Methodologies</h2>
      <ul>
        {methodologies.map((m) => (
          <li
            key={m.name}
            className={m.name === selected ? 'selected' : ''}
            onClick={() => onSelect(m.name)}
          >
            <strong>{m.name}</strong>
            <span className="phase-count">{m.phase_count} phases</span>
            <p>{m.description}</p>
          </li>
        ))}
      </ul>
    </aside>
  );
}
