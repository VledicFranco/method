/**
 * WS-3: Modal for spawning a new bridge session.
 * Now with workdir autocomplete from discovered projects.
 * If only one project exists, auto-fills workdir immediately.
 */

import { useState, useCallback, useEffect, useMemo, useRef, type FormEvent } from 'react';
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
  const [providerType, setProviderType] = useState<'print' | 'cognitive-agent'>('cognitive-agent');
  const [llmProvider, setLlmProvider] = useState<'anthropic' | 'ollama'>('anthropic');
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState('http://chobits:11434');
  const [ollamaModel, setOllamaModel] = useState('qwen3-coder:30b');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaFetchFailed, setOllamaFetchFailed] = useState(false);
  const [ollamaFetching, setOllamaFetching] = useState(false);
  const [anthropicModel, setAnthropicModel] = useState('claude-sonnet-4-6');
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

  // Fetch Ollama models when Ollama is selected and base URL changes
  const ollamaFetchRef = useRef(0);
  useEffect(() => {
    if (llmProvider !== 'ollama' || providerType !== 'cognitive-agent') return;
    const fetchId = ++ollamaFetchRef.current;
    const url = ollamaBaseUrl.trim();
    if (!url) return;

    setOllamaFetching(true);
    setOllamaFetchFailed(false);

    fetch(`${url}/api/tags`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: { models?: { name: string }[] }) => {
        if (fetchId !== ollamaFetchRef.current) return; // stale
        const names = (data.models ?? []).map((m) => m.name).filter(Boolean);
        if (names.length > 0) {
          setOllamaModels(names);
          setOllamaFetchFailed(false);
          // Default to first model if current selection isn't in the list
          if (!names.includes(ollamaModel)) {
            setOllamaModel(names[0]);
          }
        } else {
          setOllamaModels([]);
          setOllamaFetchFailed(true);
        }
      })
      .catch(() => {
        if (fetchId !== ollamaFetchRef.current) return;
        setOllamaModels([]);
        setOllamaFetchFailed(true);
        if (!ollamaModel.trim()) setOllamaModel('qwen3-coder:30b');
      })
      .finally(() => {
        if (fetchId === ollamaFetchRef.current) setOllamaFetching(false);
      });
  }, [llmProvider, providerType, ollamaBaseUrl]);

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

  const [spawnError, setSpawnError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!workdir.trim() || isSpawning) return;
      setSpawnError(null);

      const req: SpawnRequest = {
        workdir: workdir.trim(),
      };
      if (providerType !== 'print') {
        req.provider_type = providerType;
        req.mode = 'cognitive-agent';
        if (llmProvider === 'ollama') {
          req.llm_provider = llmProvider;
          req.llm_config = {
            baseUrl: ollamaBaseUrl.trim() || undefined,
            model: ollamaModel.trim() || undefined,
          };
        } else {
          // Anthropic — include model selection
          req.llm_config = {
            model: anthropicModel || undefined,
          };
        }
      }
      if (prompt.trim()) req.initial_prompt = prompt.trim();
      if (nickname.trim()) req.nickname = nickname.trim();
      if (purpose.trim()) req.purpose = purpose.trim();

      try {
        await onSpawn(req);
        // Reset form on success
        setPrompt('');
        setNickname('');
        setPurpose('');
        setProviderType('cognitive-agent');
        setLlmProvider('anthropic');
        onClose();
      } catch (err) {
        setSpawnError(err instanceof Error ? err.message : String(err));
      }
    },
    [workdir, prompt, nickname, purpose, providerType, llmProvider, anthropicModel, ollamaBaseUrl, ollamaModel, isSpawning, onSpawn, onClose],
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
          onClick={(e) => e.stopPropagation()}
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
                  onBlur={() => {
                    // Delay to allow click on dropdown item to register first
                    setTimeout(() => setShowProjectPicker(false), 200);
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

            {/* Session Mode */}
            <div>
              <label className="block text-xs text-txt-dim font-medium mb-1.5">Session Mode</label>
              <div className="flex rounded-lg border border-bdr overflow-hidden">
                <button
                  type="button"
                  onClick={() => { setProviderType('print'); setLlmProvider('anthropic'); }}
                  className={cn(
                    'flex-1 px-3 py-2 text-sm font-mono transition-colors',
                    providerType === 'print'
                      ? 'bg-bio text-abyss font-semibold'
                      : 'bg-void text-txt-dim hover:text-txt hover:bg-abyss-light',
                  )}
                >
                  Standard
                </button>
                <button
                  type="button"
                  onClick={() => setProviderType('cognitive-agent')}
                  className={cn(
                    'flex-1 px-3 py-2 text-sm font-mono transition-colors border-l border-bdr',
                    providerType === 'cognitive-agent'
                      ? 'bg-bio text-abyss font-semibold'
                      : 'bg-void text-txt-dim hover:text-txt hover:bg-abyss-light',
                  )}
                >
                  🧠 Cognitive Agent
                </button>
              </div>
            </div>

            {/* LLM Provider (visible only in cognitive-agent mode) */}
            {providerType === 'cognitive-agent' && (
              <>
                <div>
                  <label className="block text-xs text-txt-dim font-medium mb-1.5">LLM Provider</label>
                  <div className="flex rounded-lg border border-bdr overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setLlmProvider('anthropic')}
                      className={cn(
                        'flex-1 px-3 py-2 text-sm font-mono transition-colors',
                        llmProvider === 'anthropic'
                          ? 'bg-bio text-abyss font-semibold'
                          : 'bg-void text-txt-dim hover:text-txt hover:bg-abyss-light',
                      )}
                    >
                      Anthropic (Claude)
                    </button>
                    <button
                      type="button"
                      onClick={() => setLlmProvider('ollama')}
                      className={cn(
                        'flex-1 px-3 py-2 text-sm font-mono transition-colors border-l border-bdr',
                        llmProvider === 'ollama'
                          ? 'bg-bio text-abyss font-semibold'
                          : 'bg-void text-txt-dim hover:text-txt hover:bg-abyss-light',
                      )}
                    >
                      Ollama
                    </button>
                  </div>
                </div>

                {/* Anthropic model picker */}
                {llmProvider === 'anthropic' && (
                  <div>
                    <label className="block text-xs text-txt-dim font-medium mb-1.5">Model</label>
                    <select
                      value={anthropicModel}
                      onChange={(e) => setAnthropicModel(e.target.value)}
                      className="w-full rounded-lg border border-bdr bg-void px-3 py-2 text-sm text-txt font-mono focus:border-bio focus:outline-none focus:ring-1 focus:ring-bio"
                    >
                      <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
                      <option value="claude-opus-4-6">claude-opus-4-6</option>
                      <option value="claude-haiku-4-5">claude-haiku-4-5</option>
                    </select>
                  </div>
                )}

                {/* Ollama config */}
                {llmProvider === 'ollama' && (
                  <div className="space-y-sp-3 pl-3 border-l-2 border-bio/30">
                    <div>
                      <label className="block text-xs text-txt-dim font-medium mb-1.5">Base URL</label>
                      <input
                        type="text"
                        value={ollamaBaseUrl}
                        onChange={(e) => setOllamaBaseUrl(e.target.value)}
                        className="w-full rounded-lg border border-bdr bg-void px-3 py-2 text-sm text-txt font-mono placeholder:text-txt-muted focus:border-bio focus:outline-none focus:ring-1 focus:ring-bio"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-txt-dim font-medium mb-1.5">Model</label>
                      {!ollamaFetchFailed && ollamaModels.length > 0 ? (
                        <select
                          value={ollamaModel}
                          onChange={(e) => setOllamaModel(e.target.value)}
                          className="w-full rounded-lg border border-bdr bg-void px-3 py-2 text-sm text-txt font-mono focus:border-bio focus:outline-none focus:ring-1 focus:ring-bio"
                        >
                          {ollamaModels.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      ) : (
                        <>
                          <input
                            type="text"
                            value={ollamaModel}
                            onChange={(e) => setOllamaModel(e.target.value)}
                            placeholder="e.g. qwen3-coder:30b"
                            className="w-full rounded-lg border border-bdr bg-void px-3 py-2 text-sm text-txt font-mono placeholder:text-txt-muted focus:border-bio focus:outline-none focus:ring-1 focus:ring-bio"
                          />
                          {ollamaFetchFailed && !ollamaFetching && (
                            <p className="mt-1 text-[0.65rem] text-txt-muted">
                              Could not fetch models from Ollama — enter a model name manually
                            </p>
                          )}
                        </>
                      )}
                      {ollamaFetching && (
                        <p className="mt-1 text-[0.65rem] text-txt-muted">Fetching models...</p>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

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

            {/* Error display */}
            {spawnError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {spawnError}
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
