import { useState, useEffect } from 'react';
import { PageShell } from '@/shared/layout/PageShell';
import { GenesisFAB } from '@/domains/genesis/GenesisFAB';
import { GenesisChatPanel } from '@/domains/genesis/GenesisChatPanel';
import { ProjectListView } from '@/domains/projects/ProjectListView';
import { EventStreamPanel } from '@/domains/projects/EventStreamPanel';
import { BridgeHealthCards } from '@/shared/data/BridgeHealthCards';
import { TokenAggregateCards } from '@/domains/tokens/TokenAggregateCards';
import { SubscriptionMeters } from '@/domains/tokens/SubscriptionMeters';
import { api } from '@/shared/lib/api';
import type { ProjectMetadata } from '@/domains/projects/types';

const GENESIS_SESSION_ID = 'genesis-root';

export default function Dashboard() {
  const [isChatOpen, setIsChatOpen] = useState(() => {
    const saved = localStorage.getItem('genesis-chat-open');
    return saved ? JSON.parse(saved) : false;
  });
  const [genesisStatus, setGenesisStatus] = useState<'active' | 'idle'>('idle');
  const [budgetPercent, setBudgetPercent] = useState(0);
  const [selectedProject, setSelectedProject] = useState<ProjectMetadata | null>(null);

  // Fetch Genesis status periodically
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await api.get<{
          status: string;
          active_sessions: number;
          max_sessions: number;
        }>('/health');
        // Simple heuristic: active sessions > 1 means Genesis is active
        setGenesisStatus(response.active_sessions > 1 ? 'active' : 'idle');
      } catch (err) {
        console.error('Failed to fetch Genesis status:', err);
      }
    };

    const interval = setInterval(fetchStatus, 5000);
    fetchStatus(); // Initial fetch

    return () => clearInterval(interval);
  }, []);

  // Calculate budget percent from session details
  useEffect(() => {
    const fetchSessionDetails = async () => {
      try {
        // Try to get Genesis session details if available
        const response = await api.get<{
          budget?: {
            max_agents?: number;
            agents_spawned?: number;
          };
        }>(`/sessions/${GENESIS_SESSION_ID}`);

        if (response.budget) {
          const percent = (response.budget.agents_spawned ?? 0) / (response.budget.max_agents ?? 10) * 100;
          setBudgetPercent(Math.min(percent, 100));
        }
      } catch {
        // Genesis session may not exist yet, use default
        setBudgetPercent(0);
      }
    };

    const interval = setInterval(fetchSessionDetails, 10000);
    if (isChatOpen) {
      fetchSessionDetails(); // Fetch immediately when opening
    }

    return () => clearInterval(interval);
  }, [isChatOpen]);

  const handleToggleChat = (isOpen: boolean) => {
    setIsChatOpen(isOpen);
    localStorage.setItem('genesis-chat-open', JSON.stringify(isOpen));
  };

  return (
    <>
      <PageShell title="Dashboard">
        <div className="space-y-sp-6">
          {/* Bridge Health Cards */}
          <BridgeHealthCards />

          {/* Token Aggregate Cards */}
          <TokenAggregateCards />

          {/* Subscription Usage Meters */}
          <SubscriptionMeters />

          {/* Project List Section */}
          <div className="pt-sp-4 border-t border-bdr">
            <ProjectListView onProjectSelect={setSelectedProject} />
          </div>

          {/* Event Stream Section */}
          <div className="pt-sp-4 border-t border-bdr">
            <EventStreamPanel
              initialProjectId={selectedProject?.id}
              autoScroll={true}
            />
          </div>
        </div>
      </PageShell>

      {/* Genesis FAB */}
      <GenesisFAB
        onToggle={handleToggleChat}
        isOpen={isChatOpen}
        status={genesisStatus}
      />

      {/* Genesis Chat Panel */}
      <GenesisChatPanel
        isOpen={isChatOpen}
        onClose={() => handleToggleChat(false)}
        sessionId={GENESIS_SESSION_ID}
        status={genesisStatus}
        budgetPercent={budgetPercent}
      />
    </>
  );
}
