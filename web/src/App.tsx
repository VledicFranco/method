import { useEffect, useState } from 'react';
import { listMethodologies, getMethodology } from './api/client.js';
import type { Methodology, MethodologySummary } from './api/types.js';
import { MethodologyList } from './components/MethodologyList.js';
import { MethodologyGraph } from './components/MethodologyGraph.js';
import './App.css';

export default function App() {
  const [summaries, setSummaries] = useState<MethodologySummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [methodology, setMethodology] = useState<Methodology | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMethodologies()
      .then(setSummaries)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setMethodology(null);
    getMethodology(selected)
      .then(setMethodology)
      .catch((e: unknown) => setError(String(e)));
  }, [selected]);

  if (error) return <div className="error">{error}</div>;

  return (
    <div className="app">
      <header className="app-header">
        <h1>method</h1>
        <span className="subtitle">methodology visualizer</span>
      </header>
      <div className="app-body">
        <MethodologyList
          methodologies={summaries}
          selected={selected}
          onSelect={setSelected}
        />
        <main className="app-main">
          {methodology ? (
            <>
              <h2 className="graph-title">{methodology.name}</h2>
              <p className="graph-desc">{methodology.description}</p>
              <MethodologyGraph methodology={methodology} />
            </>
          ) : (
            <div className="empty-state">
              {summaries.length === 0
                ? 'Loading methodologies…'
                : 'Select a methodology to visualize it.'}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
