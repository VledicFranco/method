/**
 * WS-3: Modal for spawning a new bridge session.
 * Now with workdir autocomplete from discovered projects.
 * If only one project exists, auto-fills workdir immediately.
 */

import { useState, useCallback, useEffect, useMemo, type FormEvent } from 'react';
import { Button } from '@/shared/components/Button';
import { cn } from '@/shared/lib/cn';
import { usePreferenceStore } from '@/shared/stores/preference-store';
import { X, Terminal, FolderOpen, ChevronDown } from 'lucide-react';
import type { SpawnRequest } from '@/domains/sessions/types';

interface ProjectInfo {
  id: string;
  name: string;
  path: string;
}

export interface SpawnSessionModalProps {
  open: boolean;
  onClose: () => void;
  onSpawn: (req: SpawnRequest) => Promise<unknown>;
  isSpawning?: boolean;
  /** Pre-fill workdir (e.g. from project spawn action) */
  initialWorkdir?: string;
  /** Discovered projects for workdir autocomplete */
  projects?: ProjectInfo[];
}

export function SpawnSessionModal({
  open,
  onClose,
  onSpawn,
  isSpawning = false,
  initialWorkdir,
  projects = [],
}: SpawnSessionModalProps) {
  const defaultWorkdir = usePreferenceStore((s) => s.defaultWorkdir);

  const [workdir, setWorkdir] = useState(initialWorkdir || defaultWorkdir || '');
  const [prompt, setPrompt] = useState('');
  const [nickname, setNickname] = useState('');
  const [purpose, setPurpose] = useState('');
  const [showProjectPicker, setShowProjectPicker] = useState(false);

  // Auto-fill workdir when only one project exists
  useEffect(() => {
    if (!workdir && projects.length === 1) {
      setWorkdir(projects[0].path);
    }
  }, [projects, workdir]);

  // Update workdir when initialWorkdir changes
  useEffect(() => {
    if (initialWorkdir) {
      setWorkdir(initialWorkdir);
    }
  }, [initialWorkdir]);

  // Filter projects based on workdir input for autocomplete
  const filteredProjects = useMemo(() => {
    if (!workdir.trim()) return projects;
    const lower = workdir.toLowerCase();
    return projects.filter(
      (p) =>
        p.path.toLowerCase().includes(lower) ||
        p.name.toLowerCase().includes(lower),
    );
  }, [projects, workdir]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!workdir.trim() || isSpawning) return;

      const req: SpawnRequest = {
        workdir: workdir.trim(),
        mode: 'print',
      };
      if (prompt.trim()) req.initial_prompt = prompt.trim();
      if (nickname.trim()) req.nickname = nickname.trim();
      if (purpose.trim()) req.purpose = purpose.trim();

      await onSpawn(req);
      // Reset form on success
      setPrompt('');
      setNickname('');
      setPurpose('');
      onClose();
    },
    [workdir, prompt, nickname, purpose, onSpawn, onClose],
  );

  const handleSelectProject = useCallback(
    (path: string) => {
      setWorkdir(path);
      setShowProjectPicker(false);
    },
    [],
  );

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
          className={cn(
            'w-full max-w-lg rounded-xl border border-bdr bg-abyss shadow-2xl',
            'animate-slide-over-in',
          )}
          role="dialog"
          aria-modal="true"
          aria-label="Spawn Session"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-bdr px-sp-5 py-sp-4">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-bio" />
              <h2 className="font-display text-md text-txt font-semibold">Spawn Session</h2>
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
            {/* Workdir with project picker */}
            <div className="relative">
              <label className="block text-xs text-txt-dim font-medium mb-1.5">
                <FolderOpen className="inline h-3 w-3 mr-1" />
                Working Directory
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={workdir}
                  onChange={(e) => {
                    setWorkdir(e.target.value);
                    if (projects.length > 0) setShowProjectPicker(true);
                  }}
                  onFocus={() => {
                    if (projects.length > 0) setShowProjectPicker(true);
                  }}
                  placeholder={projects.length > 0 ? 'Select a project or type a path...' : '/path/to/project'}
                  required
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
                      className="w-full text-left px-3 py-2 hover:bg-abyss-light transition-colors border-b border-bdr last:border-b-0"
                      onClick={() => handleSelectProject(p.path)}
                    >
                      <div className="text-sm text-txt font-medium">{p.name}</div>
                      <div className="font-mono text-[0.65rem] text-txt-muted truncate">{p.path}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Nickname */}
            <div>
              <label className="block text-xs text-txt-dim font-medium mb-1.5">Nickname</label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="optional"
                className="w-full rounded-lg border border-bdr bg-void px-3 py-2 text-sm text-txt font-mono placeholder:text-txt-muted focus:border-bio focus:outline-none focus:ring-1 focus:ring-bio"
              />
            </div>

            {/* Purpose */}
            <div>
              <label className="block text-xs text-txt-dim font-medium mb-1.5">Purpose</label>
              <input
                type="text"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="What should this agent do?"
                className="w-full rounded-lg border border-bdr bg-void px-3 py-2 text-sm text-txt placeholder:text-txt-muted focus:border-bio focus:outline-none focus:ring-1 focus:ring-bio"
              />
            </div>

            {/* Initial Prompt */}
            <div>
              <label className="block text-xs text-txt-dim font-medium mb-1.5">Initial Prompt</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Optional first message to send after spawn..."
                rows={4}
                className="w-full rounded-lg border border-bdr bg-void px-3 py-2 text-sm text-txt font-mono placeholder:text-txt-muted focus:border-bio focus:outline-none focus:ring-1 focus:ring-bio resize-y"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-sp-2">
              <Button variant="secondary" size="md" type="button" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="md"
                type="submit"
                loading={isSpawning}
                leftIcon={<Terminal className="h-4 w-4" />}
              >
                Spawn
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
