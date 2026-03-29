import { useState } from 'react';
import { PageShell } from '@/shared/layout/PageShell';
import { ProjectListView } from '@/domains/projects/ProjectListView';
import { EventStreamPanel } from '@/domains/projects/EventStreamPanel';
import { BridgeHealthCards } from '@/shared/data/BridgeHealthCards';
import { TokenAggregateCards } from '@/domains/tokens/TokenAggregateCards';
import { SubscriptionMeters } from '@/domains/tokens/SubscriptionMeters';
import { useGenesisStore } from '@/shared/stores/genesis-store';
import { useGenesisPageContext } from '@/domains/genesis/useGenesisPageContext';
import { useGenesisAction } from '@/domains/genesis/useGenesisAction';
import type { ProjectMetadata } from '@/domains/projects/types';

export default function Dashboard() {
  const [selectedProject, setSelectedProject] = useState<ProjectMetadata | null>(null);

  useGenesisPageContext('dashboard', {
    selectedProject: selectedProject?.id ?? null,
  });

  // Handle Genesis-dispatched actions for the dashboard domain
  useGenesisAction((action) => {
    if (action.type === 'focusProject') {
      // Scroll to and highlight the target project in the list
      const el = document.querySelector(`[data-project-id="${action.projectId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-bio', 'ring-offset-2', 'ring-offset-void', 'transition-all');
        setTimeout(() => {
          el.classList.remove('ring-2', 'ring-bio', 'ring-offset-2', 'ring-offset-void', 'transition-all');
        }, 2000);
      }
    }
  });

  // Sync selected project to genesis store for cross-page awareness
  const handleProjectSelect = (project: ProjectMetadata) => {
    setSelectedProject(project);
    useGenesisStore.getState().setSelectedProject(project);
  };

  return (
    <PageShell breadcrumbs={[{ label: 'Dashboard' }]}>
      <div className="space-y-sp-6">
        {/* Projects — primary action area with built-in stats, search, filters */}
        <ProjectListView
          onProjectSelect={handleProjectSelect}
        />

        {/* Subscription Usage Meters */}
        <div className="pt-sp-4 border-t border-bdr">
          <SubscriptionMeters />
        </div>

        {/* Token Aggregate Cards */}
        <div className="pt-sp-4 border-t border-bdr">
          <TokenAggregateCards />
        </div>

        {/* Bridge Health Cards */}
        <div className="pt-sp-4 border-t border-bdr">
          <BridgeHealthCards />
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
  );
}
