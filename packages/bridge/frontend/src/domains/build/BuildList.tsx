/**
 * BuildList — Left sidebar listing all builds with mini pipeline strips.
 *
 * Shows: build name, status dot, 8 mini dots for pipeline progress,
 * current phase label, and cost. "+ New Build" button in header.
 *
 * @see PRD 047 §Dashboard Architecture — Build List (sidebar)
 */

import { useState, useEffect, useCallback, useMemo, type FormEvent } from 'react';
import { cn } from '@/shared/lib/cn';
import { api } from '@/shared/lib/api';
import { Button } from '@/shared/components/Button';
import { X, Hammer, FolderOpen, ChevronDown } from 'lucide-react';
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

      {/* Project badge (if set) */}
      {build.projectId && (
        <div className="flex items-center gap-1 mb-1 ml-4">
          <FolderOpen className="w-2.5 h-2.5 text-[#6d5aed]" />
          <span className="font-mono text-[10px] text-[#6d5aed] truncate">
            {build.projectId}
          </span>
        </div>
      )}

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
// Follows the same modal pattern as SpawnSessionModal:
// backdrop + centered dialog + header with icon + form + shared Button actions.

function NewBuildModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (requirement: string, projectId?: string) => Promise<unknown>;
}) {
  const [text, setText] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const [projectId, setProjectId] = useState<string>('');
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Fetch projects when modal opens
  useEffect(() => {
    if (!open) return;
    void api.get<{ projects: ProjectOption[] }>('/api/projects').then((res) => {
      const healthy = (res.projects ?? []).filter((p: ProjectOption & { status?: string }) =>
        !('status' in p) || p.status === 'healthy',
      );
      setProjects(healthy);
      // Auto-select when only one project exists
      if (healthy.length === 1) {
        setProjectId(healthy[0].id);
        setProjectSearch(healthy[0].name);
      }
    }).catch(() => {
      // Projects API unavailable — allow builds without project
    });
  }, [open]);

  // Filter projects based on search input
  const filteredProjects = useMemo(() => {
    if (!projectSearch.trim()) return projects;
    const lower = projectSearch.toLowerCase();
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(lower) ||
        p.path.toLowerCase().includes(lower) ||
        (p.description && p.description.toLowerCase().includes(lower)),
    );
  }, [projects, projectSearch]);

  const handleSelectProject = useCallback((p: ProjectOption) => {
    setProjectId(p.id);
    setProjectSearch(p.name);
    setShowProjectPicker(false);
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || isSubmitting) return;
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      await onSubmit(text.trim(), projectId || undefined);
      setText('');
      setProjectSearch('');
      setProjectId('');
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }, [text, projectId, isSubmitting, onSubmit, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-void/60 backdrop-blur-sm animate-backdrop-fade"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-lg rounded-xl border border-bdr bg-abyss shadow-2xl animate-slide-over-in"
          role="dialog"
          aria-modal="true"
          aria-label="New Build"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-bdr px-sp-5 py-sp-4">
            <div className="flex items-center gap-2">
              <Hammer className="h-4 w-4 text-bio" />
              <h2 className="font-display text-md text-txt font-semibold">New Build</h2>
            </div>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-txt-dim hover:text-txt hover:bg-abyss-light transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-sp-5 space-y-sp-4">
            {/* Project autocomplete picker */}
            <div className="relative">
              <label className="block text-xs text-txt-dim font-medium mb-1.5">
                <FolderOpen className="inline h-3 w-3 mr-1" />
                Project
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={projectSearch}
                  onChange={(e) => {
                    setProjectSearch(e.target.value);
                    setProjectId(''); // clear selection when typing
                    if (projects.length > 0) setShowProjectPicker(true);
                  }}
                  onFocus={() => {
                    if (projects.length > 0) setShowProjectPicker(true);
                  }}
                  onBlur={() => {
                    setTimeout(() => setShowProjectPicker(false), 200);
                  }}
                  placeholder={projects.length > 0 ? 'Search projects...' : 'No projects discovered'}
                  className="flex-1 rounded-lg border border-bdr bg-void px-3 py-2 text-sm text-txt font-mono placeholder:text-txt-muted focus:border-bio focus:outline-none focus:ring-1 focus:ring-bio"
                />
                {projects.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowProjectPicker(!showProjectPicker)}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-bdr bg-void text-txt-dim hover:text-txt hover:bg-abyss-light transition-colors"
                    aria-label="Pick project"
                  >
                    <ChevronDown className={cn('h-4 w-4 transition-transform', showProjectPicker && 'rotate-180')} />
                  </button>
                )}
              </div>

              {/* Project autocomplete dropdown */}
              {showProjectPicker && filteredProjects.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 z-10 max-h-48 overflow-y-auto rounded-lg border border-bdr bg-void shadow-lg">
                  {filteredProjects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={cn(
                        'w-full text-left px-3 py-2 hover:bg-abyss-light transition-colors border-b border-bdr last:border-b-0',
                        p.id === projectId && 'bg-abyss-light',
                      )}
                      onClick={() => handleSelectProject(p)}
                    >
                      <div className="text-sm text-txt font-medium">{p.name}</div>
                      <div className="font-mono text-[0.65rem] text-txt-muted truncate">
                        {p.description ? p.description.slice(0, 80) : p.path}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Requirement */}
            <div>
              <label className="block text-xs text-txt-dim font-medium mb-1.5">Requirement</label>
              <textarea
                className="w-full rounded-lg border border-bdr bg-void px-3 py-2 text-sm text-txt font-mono placeholder:text-txt-muted focus:border-bio focus:outline-none focus:ring-1 focus:ring-bio resize-y"
                placeholder="Describe the feature requirement..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                autoFocus
              />
            </div>

            {/* Error display */}
            {submitError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {submitError}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-sp-2">
              <Button variant="secondary" size="md" type="button" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="md"
                type="submit"
                loading={isSubmitting}
                leftIcon={<Hammer className="h-4 w-4" />}
              >
                Start Build
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

// ── Main export ──

export interface BuildListProps {
  builds: BuildSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onStartBuild: (requirement: string, projectId?: string) => Promise<unknown>;
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
        onSubmit={onStartBuild}
      />
    </>
  );
}
