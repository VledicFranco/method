/**
 * BuildList — Left sidebar listing all builds with mini pipeline strips.
 *
 * Shows: build name, status dot, 8 mini dots for pipeline progress,
 * current phase label, and cost. "+ New Build" button in header.
 *
 * @see PRD 047 §Dashboard Architecture — Build List (sidebar)
 */

import { useState, useEffect } from 'react';
import { cn } from '@/shared/lib/cn';
import { api } from '@/shared/lib/api';
import { PHASE_LABELS } from './types';
import type { BuildSummary, PhaseInfo } from './types';

// ── Mini pipeline dots ──

function MiniPipeline({ phases }: { phases: PhaseInfo[] }) {
  const dotColor: Record<string, string> = {
    completed: 'bg-[#10b981]',
    running: 'bg-[#3b82f6] animate-[pulse-dot_2s_infinite]',
    waiting: 'bg-[#f59e0b]',
    recovered: 'bg-[#10b981] border border-[#f59e0b]',
    failed: 'bg-[#ef4444]',
    future: 'bg-bdr',
  };

  return (
    <div className="flex items-center gap-[3px]">
      {phases.map((p, i) => (
        <div key={i} className={cn('w-1.5 h-1.5 rounded-full', dotColor[p.status])} />
      ))}
    </div>
  );
}

// ── Status dot ──

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: 'bg-[#3b82f6] shadow-[0_0_6px_#3b82f6] animate-[pulse-dot_2s_infinite]',
    waiting: 'bg-[#f59e0b] shadow-[0_0_6px_#f59e0b] animate-[pulse-dot_1.5s_infinite]',
    completed: 'bg-[#10b981]',
    failed: 'bg-[#ef4444]',
    paused: 'bg-[#64748b]',
  };

  return <div className={cn('w-2 h-2 rounded-full shrink-0', colors[status])} />;
}

// ── Build item ──

function BuildItem({
  build,
  active,
  onClick,
}: {
  build: BuildSummary;
  active: boolean;
  onClick: () => void;
}) {
  const phaseLabel =
    build.status === 'completed' ? 'Complete' : PHASE_LABELS[build.currentPhase];

  return (
    <div
      className={cn(
        'px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150 mb-1 border border-transparent',
        active
          ? 'bg-[#6d5aed33] border-[#6d5aed]'
          : 'hover:bg-[#ffffff06]',
      )}
      onClick={onClick}
    >
      {/* Top row: status dot + name + optional checkmark */}
      <div className="flex items-center gap-2 mb-1">
        <StatusDot status={build.status} />
        <span className="text-[13px] font-semibold text-txt flex-1 truncate">
          {build.name}
        </span>
        {build.status === 'completed' && (
          <span className="text-[#10b981] text-sm">&#10003;</span>
        )}
      </div>

      {/* Mini pipeline + phase label + cost */}
      <div className="flex items-center gap-[3px]">
        <MiniPipeline phases={build.phases} />
        <span className="font-mono text-[10px] text-txt-dim ml-1">{phaseLabel}</span>
        <span className="font-mono text-[10px] text-[#64748b] ml-auto">
          ${build.costUsd.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

// ── Project option type ──

interface ProjectOption {
  id: string;
  name: string;
  path: string;
  description: string;
}

// ── New Build Modal ──

function NewBuildModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (requirement: string, projectId?: string) => void;
}) {
  const [text, setText] = useState('');
  const [projectId, setProjectId] = useState<string>('');
  const [projects, setProjects] = useState<ProjectOption[]>([]);

  // Fetch projects when modal opens
  useEffect(() => {
    if (!open) return;
    void api.get<{ projects: ProjectOption[] }>('/api/projects').then((res) => {
      const healthy = (res.projects ?? []).filter((p: ProjectOption & { status?: string }) =>
        !('status' in p) || p.status === 'healthy',
      );
      setProjects(healthy);
    }).catch(() => {
      // Projects API unavailable — allow builds without project
    });
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[900] flex items-center justify-center bg-black/65">
      <div className="w-[520px] bg-abyss border border-bdr rounded-lg p-7 shadow-2xl">
        <h3 className="text-base font-bold text-txt mb-4">New Build</h3>

        {/* Project selector */}
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-txt-dim mb-1.5">
          Project
        </label>
        <select
          className="w-full bg-void border border-bdr rounded-[5px] px-3 py-2 text-txt text-[13px] mb-4 outline-none focus:border-[#6d5aed] cursor-pointer"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">Select a project...</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}{p.description ? ` — ${p.description.slice(0, 60)}` : ''}
            </option>
          ))}
        </select>

        {/* Requirement textarea */}
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-txt-dim mb-1.5">
          Requirement
        </label>
        <textarea
          className="w-full h-[100px] bg-void border border-bdr rounded-[5px] p-3 text-txt text-[13px] resize-y outline-none focus:border-[#6d5aed] placeholder:text-[#ffffff22]"
          placeholder="Describe the feature requirement..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-[5px] text-[13px] font-semibold bg-[#ffffff08] text-txt-dim border border-bdr hover:text-txt cursor-pointer transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (text.trim()) {
                onSubmit(text.trim(), projectId || undefined);
                setText('');
                setProjectId('');
                onClose();
              }
            }}
            className="px-5 py-2 rounded-[5px] text-[13px] font-semibold bg-[#6d5aed] text-white hover:bg-[#7d6cf7] cursor-pointer transition-colors"
          >
            Start Build
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main export ──

export interface BuildListProps {
  builds: BuildSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onStartBuild: (requirement: string, projectId?: string) => void;
}

export function BuildList({ builds, selectedId, onSelect, onStartBuild }: BuildListProps) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <div className="w-[260px] min-w-[260px] bg-abyss border-r border-bdr flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-bdr flex items-center gap-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-txt-dim">
            Builds
          </h2>
          <span className="font-mono text-[11px] text-txt-dim bg-[#ffffff08] px-2 py-0.5 rounded-full">
            {builds.length}
          </span>
          <button
            onClick={() => setModalOpen(true)}
            className="ml-auto bg-[#6d5aed] text-white border-none text-[11px] font-semibold px-3 py-1 rounded-[5px] cursor-pointer hover:bg-[#7d6cf7] transition-colors whitespace-nowrap"
          >
            + New Build
          </button>
        </div>

        {/* Build list */}
        <div className="flex-1 overflow-y-auto p-2">
          {builds.map((build) => (
            <BuildItem
              key={build.id}
              build={build}
              active={build.id === selectedId}
              onClick={() => onSelect(build.id)}
            />
          ))}
          {builds.length === 0 && (
            <div className="text-center text-[13px] text-txt-dim py-8">
              No builds yet. Start one above.
            </div>
          )}
        </div>
      </div>

      <NewBuildModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={(req, projId) => {
          onStartBuild(req, projId);
        }}
      />
    </>
  );
}
