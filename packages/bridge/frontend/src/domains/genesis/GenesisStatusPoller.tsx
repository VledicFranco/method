/**
 * GenesisStatusPoller — headless component that polls Genesis status and budget.
 *
 * Discovers the real Genesis session ID from /genesis/status and writes it to the
 * store so GenesisChatPanel uses the correct ID for prompts and SSE streaming.
 * Also polls bridge /health for connection status and session budget.
 *
 * Renders nothing — purely side-effect driven.
 *
 * PRD 040 C-6: Exponential backoff on consecutive 503s from /genesis/status.
 * After 3 consecutive failures, stops polling entirely and sets status to 'unavailable'.
 */

import { useEffect, useRef, useCallback } from 'react';
import { api } from '@/shared/lib/api';
import { useGenesisStore } from '@/shared/stores/genesis-store';

/** Backoff delays (ms) for consecutive genesis 503 failures. */
const BACKOFF_DELAYS = [5_000, 15_000] as const;
/** After this many consecutive failures, stop polling entirely. */
const MAX_CONSECUTIVE_FAILURES = 3;

export function GenesisStatusPoller() {
  const isOpen = useGenesisStore((s) => s.isOpen);
  const setStatus = useGenesisStore((s) => s.setStatus);
  const setBudgetPercent = useGenesisStore((s) => s.setBudgetPercent);
  const setSessionId = useGenesisStore((s) => s.setSessionId);

  // Track consecutive genesis endpoint failures for backoff (PRD 040 C-6 / AC-10)
  const consecutiveFailuresRef = useRef(0);
  const backoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  const scheduleNextPoll = useCallback((fetchFn: () => Promise<void>) => {
    if (stoppedRef.current) return;

    const failures = consecutiveFailuresRef.current;
    // Pick delay: 0 failures → 5s (normal), 1 → 5s, 2 → 15s, ≥3 → stopped
    const delay = failures === 0
      ? 5_000
      : failures <= BACKOFF_DELAYS.length
        ? BACKOFF_DELAYS[failures - 1]
        : BACKOFF_DELAYS[BACKOFF_DELAYS.length - 1];

    backoffTimerRef.current = setTimeout(() => {
      fetchFn();
    }, delay);
  }, []);

  // Discover real Genesis session ID and poll status
  useEffect(() => {
    consecutiveFailuresRef.current = 0;
    stoppedRef.current = false;

    const fetchGenesisStatus = async () => {
      if (stoppedRef.current) return;

      try {
        // Try the Genesis-specific status endpoint first — it returns the real sessionId
        const genesis = await api.get<{
          sessionId: string;
          status: string;
          nickname: string;
          csrf_token: string;
        }>('/genesis/status');

        // Success — reset backoff counter
        consecutiveFailuresRef.current = 0;

        // Store the real session ID (UUID, not the 'genesis-root' nickname)
        setSessionId(genesis.sessionId);
        setStatus(genesis.status === 'running' ? 'active' : 'idle');
      } catch (err) {
        // Genesis not running — increment failure counter
        consecutiveFailuresRef.current += 1;

        if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
          // PRD 040 C-6: Stop polling after 3 consecutive failures
          stoppedRef.current = true;
          setStatus('disconnected');
          return; // Don't schedule another poll
        }

        // Fall back to /health for bridge connectivity
        try {
          await api.get<{ status: string }>('/health');
          setStatus('idle');
        } catch {
          setStatus('disconnected');
        }
      }

      // Schedule next poll with backoff
      scheduleNextPoll(fetchGenesisStatus);
    };

    // Initial fetch
    fetchGenesisStatus();

    return () => {
      stoppedRef.current = true;
      if (backoffTimerRef.current) {
        clearTimeout(backoffTimerRef.current);
        backoffTimerRef.current = null;
      }
    };
  }, [setStatus, setSessionId, scheduleNextPoll]);

  // Poll budget from session details
  useEffect(() => {
    const fetchBudget = async () => {
      const sessionId = useGenesisStore.getState().sessionId;
      if (!sessionId) return;

      try {
        const response = await api.get<{
          budget?: {
            max_agents?: number;
            agents_spawned?: number;
          };
        }>(`/sessions/${sessionId}`);

        if (response.budget) {
          const percent = (response.budget.agents_spawned ?? 0) / (response.budget.max_agents ?? 10) * 100;
          setBudgetPercent(percent);
        }
      } catch {
        setBudgetPercent(0);
      }
    };

    const interval = setInterval(fetchBudget, 10000);
    if (isOpen) fetchBudget();

    return () => clearInterval(interval);
  }, [isOpen, setBudgetPercent]);

  return null;
}
