import { useState, useEffect, useRef } from 'react';
import type { ExecutionStatusResponse } from '../lib/types';

const POLL_INTERVAL_MS = 2000;

/**
 * Poll /strategies/:id/status every 2 seconds for live execution updates.
 * Stops polling once the execution reaches a terminal state.
 */
export function useLiveExecution(executionId: string | null) {
  const [data, setData] = useState<ExecutionStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!executionId) {
      setData(null);
      return;
    }

    const poll = async () => {
      try {
        const res = await fetch(`/strategies/${executionId}/status`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as ExecutionStatusResponse;
        setData(json);
        setError(null);

        // Stop polling on terminal states
        if (
          json.status === 'completed' ||
          json.status === 'failed' ||
          json.status === 'suspended'
        ) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }
      } catch (err) {
        setError((err as Error).message);
      }
    };

    // Initial fetch
    poll();

    // Set up polling
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [executionId]);

  return { data, error };
}
