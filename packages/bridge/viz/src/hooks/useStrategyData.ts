import { useState, useEffect } from 'react';
import type { StrategyDAG, ExecutionListItem } from '../lib/types';

/** Fetch the strategy DAG definition from the API */
export function useStrategyDag(executionId: string | null) {
  const [dag, setDag] = useState<StrategyDAG | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!executionId) return;

    setLoading(true);
    setError(null);

    fetch(`/api/strategies/${executionId}/dag`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        setDag(data as StrategyDAG);
        setLoading(false);
      })
      .catch((err) => {
        setError((err as Error).message);
        setLoading(false);
      });
  }, [executionId]);

  return { dag, loading, error };
}

/** Fetch the list of all strategy executions */
export function useExecutionList() {
  const [executions, setExecutions] = useState<ExecutionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/strategies')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setExecutions(data as ExecutionListItem[]);
        setLoading(false);
      })
      .catch((err) => {
        setError((err as Error).message);
        setLoading(false);
      });
  }, []);

  return { executions, loading, error };
}
