/**
 * GenesisStatusPoller — headless component that polls Genesis status and budget.
 *
 * Extracted from Dashboard.tsx so that Genesis status is updated globally
 * regardless of which page the user is on (PRD 025 Phase 1).
 * Renders nothing — purely side-effect driven.
 */

import { useEffect } from 'react';
import { api } from '@/shared/lib/api';
import { useGenesisStore, GENESIS_SESSION_ID } from '@/shared/stores/genesis-store';

export function GenesisStatusPoller() {
  const isOpen = useGenesisStore((s) => s.isOpen);
  const setStatus = useGenesisStore((s) => s.setStatus);
  const setBudgetPercent = useGenesisStore((s) => s.setBudgetPercent);

  // Poll Genesis status periodically
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await api.get<{
          status: string;
          active_sessions: number;
          max_sessions: number;
        }>('/health');
        // Simple heuristic: active sessions > 1 means Genesis is active
        setStatus(response.active_sessions > 1 ? 'active' : 'idle');
      } catch (err) {
        console.error('Failed to fetch Genesis status:', err);
      }
    };

    const interval = setInterval(fetchStatus, 5000);
    fetchStatus(); // Initial fetch

    return () => clearInterval(interval);
  }, [setStatus]);

  // Calculate budget percent from session details
  useEffect(() => {
    const sessionId = useGenesisStore.getState().sessionId ?? GENESIS_SESSION_ID;

    const fetchSessionDetails = async () => {
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
        // Genesis session may not exist yet, use default
        setBudgetPercent(0);
      }
    };

    const interval = setInterval(fetchSessionDetails, 10000);
    if (isOpen) {
      fetchSessionDetails(); // Fetch immediately when opening
    }

    return () => clearInterval(interval);
  }, [isOpen, setBudgetPercent]);

  // Renders nothing — purely side-effect
  return null;
}
