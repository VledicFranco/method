/**
 * BuildsPage — Top-level /builds route. 3-column layout:
 *   Left sidebar (260px): BuildList
 *   Main area (flex): ContextBar + BuildDetail with tabs
 *   Right panel (380px, collapsible): placeholder for ConversationPanel (C-5)
 *
 * @see PRD 047 — Build Orchestrator §Dashboard Architecture
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { cn } from '@/shared/lib/cn';
import { BuildList } from './BuildList';
import { BuildDetail } from './BuildDetail';
import { ContextBar } from './ContextBar';
import { ConversationPanel } from './ConversationPanel';
import { useBuilds } from './useBuilds';

export default function BuildsPage() {
  const { id } = useParams<{ id: string }>();
  const { builds, selectedBuild, selectedId, selectBuild } = useBuilds(id);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

  return (
    <div className="flex h-screen w-full bg-void overflow-hidden">
      {/* Left sidebar — Build list */}
      <BuildList
        builds={builds}
        selectedId={selectedId}
        onSelect={selectBuild}
      />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {selectedBuild ? (
          <>
            <ContextBar build={selectedBuild} />
            <BuildDetail build={selectedBuild} />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-txt-dim font-mono text-[13px]">
            Select a build or start a new one.
          </div>
        )}
      </div>

      {/* Right panel — Conversation */}
      <div
        className={cn(
          'bg-abyss border-l border-bdr flex flex-col transition-all duration-300 overflow-hidden',
          rightPanelOpen
            ? 'w-[400px] min-w-[400px] opacity-100'
            : 'w-0 min-w-0 border-l-0 opacity-0 pointer-events-none',
        )}
      >
        {/* Panel header */}
        <div className="px-4 py-3 border-b border-bdr flex items-center gap-2 shrink-0">
          <span className="text-xs font-semibold uppercase tracking-wider text-txt-dim">
            Conversation
          </span>
          <button
            onClick={() => setRightPanelOpen(false)}
            className="ml-auto text-[#64748b] hover:text-txt text-xs cursor-pointer transition-colors"
            aria-label="Close conversation panel"
          >
            &#10005;
          </button>
        </div>

        {/* Conversation panel */}
        <ConversationPanel
          builds={builds}
          selectedBuildId={selectedId}
          onSelectBuild={selectBuild}
        />
      </div>

      {/* Toggle button when panel is collapsed */}
      {!rightPanelOpen && (
        <button
          onClick={() => setRightPanelOpen(true)}
          className="fixed right-2 top-[56px] z-50 bg-abyss border border-bdr text-txt-dim w-7 h-7 rounded-[5px] flex items-center justify-center cursor-pointer text-sm hover:text-txt hover:border-[#6d5aed] transition-colors"
          aria-label="Open conversation panel"
        >
          &#9664;
        </button>
      )}
    </div>
  );
}
