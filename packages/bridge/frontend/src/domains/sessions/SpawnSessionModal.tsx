/**
 * Modal for spawning a new bridge session.
 * Ported from the old dashboard's spawn form — now a pluggable component.
 */

import { useState, useCallback, type FormEvent } from 'react';
import { Button } from '@/shared/components/Button';
import { cn } from '@/shared/lib/cn';
import { usePreferenceStore } from '@/shared/stores/preference-store';
import { X, Terminal, FolderOpen } from 'lucide-react';
import type { SpawnRequest } from '@/lib/types';

export interface SpawnSessionModalProps {
  open: boolean;
  onClose: () => void;
  onSpawn: (req: SpawnRequest) => Promise<unknown>;
  isSpawning?: boolean;
}

export function SpawnSessionModal({
  open,
  onClose,
  onSpawn,
  isSpawning = false,
}: SpawnSessionModalProps) {
  const defaultWorkdir = usePreferenceStore((s) => s.defaultWorkdir);

  const [workdir, setWorkdir] = useState(defaultWorkdir || '');
  const [prompt, setPrompt] = useState('');
  const [nickname, setNickname] = useState('');
  const [purpose, setPurpose] = useState('');
  const [mode, setMode] = useState<'pty' | 'print'>('pty');

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!workdir.trim()) return;

      const req: SpawnRequest = {
        workdir: workdir.trim(),
        mode,
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
    [workdir, prompt, nickname, purpose, mode, onSpawn, onClose],
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
            {/* Workdir */}
            <div>
              <label className="block text-xs text-txt-dim font-medium mb-1.5">
                <FolderOpen className="inline h-3 w-3 mr-1" />
                Working Directory
              </label>
              <input
                type="text"
                value={workdir}
                onChange={(e) => setWorkdir(e.target.value)}
                placeholder="/path/to/project"
                required
                className="w-full rounded-lg border border-bdr bg-void px-3 py-2 text-sm text-txt font-mono placeholder:text-txt-muted focus:border-bio focus:outline-none focus:ring-1 focus:ring-bio"
              />
            </div>

            {/* Nickname + Mode row */}
            <div className="grid grid-cols-2 gap-3">
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
              <div>
                <label className="block text-xs text-txt-dim font-medium mb-1.5">Mode</label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as 'pty' | 'print')}
                  className="w-full rounded-lg border border-bdr bg-void px-3 py-2 text-sm text-txt focus:border-bio focus:outline-none focus:ring-1 focus:ring-bio"
                >
                  <option value="pty">PTY (terminal)</option>
                  <option value="print">Print (--print)</option>
                </select>
              </div>
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
