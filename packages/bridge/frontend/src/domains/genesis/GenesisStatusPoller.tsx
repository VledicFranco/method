/**
 * GenesisStatusPoller — headless component that polls Genesis status and budget.
 *
 * Discovers the real Genesis session ID from /genesis/status and writes it to the
 * store so GenesisChatPanel uses the correct ID for prompts and SSE streaming.
 * Also polls bridge /health for connection status and session budget.
 *
 * Renders nothing — purely side-effect driven.
 */

import { useEffect } from 'react';
import { api } from '@/shared/lib/api';
import { useGenesisStore } from '@/shared/stores/genesis-store';

export function GenesisStatusPoller() {
  const isOpen = useGenesisStore((s) => s.isOpen);
  const setStatus = useGenesisStore((s) => s.setStatus);
  const setBudgetPercent = useGenesisStore((s) => s.setBudgetPercent);
  const setSessionId = useGenesisStore((s) => s.setSessionId);

  // Discover real Genesis session ID and poll status
  useEffect(() => {
    const fetchGenesisStatus = async () => {
      try {
        // Try the Genesis-specific status endpoint first — it returns the real sessionId
        const genesis = await api.get<{
          sessionId: string;
          status: string;
          nickname: string;
          csrf_token: string;
        }>('/genesis/status');

        // Store the real session ID (UUID, not the 'genesis-root' nickname)
        setSessionId(genesis.sessionId);
        setStatus(genesis.status === 'running' ? 'active' : 'idle');
      } catch {
        // Genesis not running — fall back to /health for bridge connectivity
        try {
          await api.get<{ status: string }>('/health');
          setStatus('idle');
        } catch {
          setStatus('disconnected');
        }
      }
    };

    const interval = setInterval(fetchGenesisStatus, 5000);
    fetchGenesisStatus();

    return () => clearInterval(interval);
  }, [setStatus, setSessionId]);

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
