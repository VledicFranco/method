/**
 * PRD 020 Phase 3: Copy Methodology Modal
 *
 * Modal for copying a methodology from a source project to one or more target projects.
 * Includes project and methodology selection, multi-select for targets, and error/success feedback.
 */

import { useState, useEffect } from 'react';
import { Copy, AlertCircle, CheckCircle, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SlideOverPanel } from '@/components/layout/SlideOverPanel';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useProjectList, useCopyMethodology } from '@/hooks/useResourceCopy';
import type { ProjectMetadata } from '@/hooks/useResourceCopy';

export interface CopyMethodologyModalProps {
  open: boolean;
  onClose: () => void;
  initialSourceId?: string;
  initialMethodName?: string;
  onSuccess?: () => void;
}

interface FormState {
  sourceProjectId: string;
  methodologyName: string;
  targetProjectIds: Set<string>;
}

interface CopyResult {
  projectId: string;
  status: 'success' | 'error';
  errorDetail?: string;
}

export function CopyMethodologyModal({
  open,
  onClose,
  initialSourceId,
  initialMethodName,
  onSuccess,
}: CopyMethodologyModalProps) {
  const { data: projects, isLoading: projectsLoading } = useProjectList();
  const copyMutation = useCopyMethodology();

  const [formState, setFormState] = useState<FormState>({
    sourceProjectId: initialSourceId || '',
    methodologyName: initialMethodName || '',
    targetProjectIds: new Set(),
  });

  const [results, setResults] = useState<CopyResult[]>([]);
  const [showResults, setShowResults] = useState(false);

  // Initialize form if props change
  useEffect(() => {
    if (initialSourceId || initialMethodName) {
      setFormState(prev => ({
        ...prev,
        sourceProjectId: initialSourceId || prev.sourceProjectId,
        methodologyName: initialMethodName || prev.methodologyName,
      }));
    }
  }, [initialSourceId, initialMethodName]);

  // Reset form when modal closes
  useEffect(() => {
    if (!open) {
      setResults([]);
      setShowResults(false);
    }
  }, [open]);

  const handleSourceProjectChange = (projectId: string) => {
    setFormState(prev => ({
      ...prev,
      sourceProjectId: projectId,
      methodologyName: '', // Reset methodology when source changes
    }));
  };

  const handleMethodologyChange = (methodName: string) => {
    setFormState(prev => ({
      ...prev,
      methodologyName: methodName,
    }));
  };

  const handleToggleTarget = (projectId: string) => {
    setFormState(prev => {
      const newTargets = new Set(prev.targetProjectIds);
      if (newTargets.has(projectId)) {
        newTargets.delete(projectId);
      } else {
        newTargets.add(projectId);
      }
      return { ...prev, targetProjectIds: newTargets };
    });
  };

  const handleCopy = async () => {
    if (!formState.sourceProjectId || !formState.methodologyName || formState.targetProjectIds.size === 0) {
      return;
    }

    try {
      const response = await copyMutation.mutateAsync({
        source_id: formState.sourceProjectId,
        method_name: formState.methodologyName,
        target_ids: Array.from(formState.targetProjectIds),
      });

      // Display results
      const copyResults = response.copied_to.map((result: any) => ({
        projectId: result.project_id,
        status: result.status,
        errorDetail: result.error_detail,
      }));
      setResults(copyResults);
      setShowResults(true);

      // Call success callback if all succeeded
      if (copyResults.every(r => r.status === 'success')) {
        onSuccess?.();
        // Auto-close after 2 seconds on success
        setTimeout(() => {
          onClose();
        }, 2000);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setResults([
        {
          projectId: 'error',
          status: 'error',
          errorDetail: errorMessage,
        },
      ]);
      setShowResults(true);
    }
  };

  const isFormValid =
    formState.sourceProjectId &&
    formState.methodologyName &&
    formState.targetProjectIds.size > 0;

  const allSuccessful = results.length > 0 && results.every(r => r.status === 'success');
  const hasErrors = results.length > 0 && results.some(r => r.status === 'error');

  return (
    <SlideOverPanel
      open={open}
      onClose={onClose}
      title="Copy Methodology"
      subtitle="Share a methodology across projects"
    >
      <div className="space-y-6">
        {!showResults ? (
          <>
            {/* Source Project Selection */}
            <div className="space-y-2">
              <label className="font-mono text-[0.75rem] text-txt-muted uppercase tracking-wider">
                Source Project
              </label>
              <select
                value={formState.sourceProjectId}
                onChange={e => handleSourceProjectChange(e.target.value)}
                className={cn(
                  'w-full px-3 py-2 rounded-lg font-body text-sm',
                  'border border-bdr bg-abyss text-txt',
                  'hover:border-bdr-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bio focus-visible:ring-offset-2 focus-visible:ring-offset-void',
                  'transition-colors',
                )}
                disabled={projectsLoading}
              >
                <option value="">
                  {projectsLoading ? 'Loading projects...' : 'Select a project'}
                </option>
                {projects?.map(project => (
                  <option key={project.id} value={project.id}>
                    {project.id} — {project.path}
                  </option>
                ))}
              </select>
            </div>

            {/* Methodology Selection */}
            {formState.sourceProjectId && (
              <div className="space-y-2">
                <label className="font-mono text-[0.75rem] text-txt-muted uppercase tracking-wider">
                  Methodology Name
                </label>
                <input
                  type="text"
                  value={formState.methodologyName}
                  onChange={e => handleMethodologyChange(e.target.value)}
                  placeholder="e.g., P2-SD, P1-EXEC, M1-COUNCIL"
                  className={cn(
                    'w-full px-3 py-2 rounded-lg font-body text-sm',
                    'border border-bdr bg-abyss text-txt placeholder-txt-muted',
                    'hover:border-bdr-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bio focus-visible:ring-offset-2 focus-visible:ring-offset-void',
                    'transition-colors',
                  )}
                />
                <p className="text-[0.75rem] text-txt-muted">
                  Enter the methodology or protocol ID (e.g., P2-SD, M1-COUNCIL)
                </p>
              </div>
            )}

            {/* Target Projects Multi-Select */}
            {formState.sourceProjectId && (
              <div className="space-y-2">
                <label className="font-mono text-[0.75rem] text-txt-muted uppercase tracking-wider">
                  Target Projects
                </label>
                <div className="space-y-1 border border-bdr rounded-lg p-3 bg-abyss-light/30">
                  {projects
                    ?.filter(p => p.id !== formState.sourceProjectId)
                    .map(project => (
                      <label
                        key={project.id}
                        className="flex items-center gap-2 cursor-pointer hover:bg-abyss-light/50 p-2 rounded transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={formState.targetProjectIds.has(project.id)}
                          onChange={() => handleToggleTarget(project.id)}
                          className="rounded border-bdr w-4 h-4 cursor-pointer accent-bio"
                        />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-txt block">
                            {project.id}
                          </span>
                          <span className="text-[0.7rem] text-txt-muted">
                            {project.path}
                          </span>
                        </div>
                        <Badge
                          variant={project.status === 'healthy' ? 'bio' : project.status === 'git_corrupted' ? 'error' : 'solar'}
                          label={project.status}
                          size="sm"
                        />
                      </label>
                    ))}
                  {projects?.filter(p => p.id !== formState.sourceProjectId).length === 0 && (
                    <p className="text-[0.85rem] text-txt-muted p-2">
                      No other projects available
                    </p>
                  )}
                </div>
                {formState.targetProjectIds.size > 0 && (
                  <p className="text-[0.75rem] text-txt-dim">
                    {formState.targetProjectIds.size} project{formState.targetProjectIds.size !== 1 ? 's' : ''} selected
                  </p>
                )}
              </div>
            )}

            {/* Copy Button */}
            <div className="flex gap-2">
              <Button
                onClick={handleCopy}
                disabled={!isFormValid || copyMutation.isPending}
                loading={copyMutation.isPending}
                className="flex-1"
              >
                <Copy className="h-4 w-4" />
                Copy Methodology
              </Button>
              <Button
                variant="secondary"
                onClick={onClose}
                disabled={copyMutation.isPending}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* Results Display */}
            <div className="space-y-3">
              {allSuccessful ? (
                <Card accent="bio" padding="md">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 text-bio shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-bio mb-1">
                        Successfully copied!
                      </p>
                      <p className="text-[0.85rem] text-txt-dim">
                        {formState.methodologyName} copied to{' '}
                        {results.length === 1 ? '1 project' : `${results.length} projects`}
                      </p>
                    </div>
                  </div>
                </Card>
              ) : hasErrors ? (
                <Card accent="error" padding="md">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-error shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-error mb-1">
                        Copy failed
                      </p>
                      <p className="text-[0.85rem] text-txt-dim">
                        {results.find(r => r.status === 'error')?.errorDetail ||
                          'An error occurred during copying'}
                      </p>
                    </div>
                  </div>
                </Card>
              ) : null}

              {/* Per-project Results */}
              {results.length > 1 && (
                <div className="space-y-1">
                  <p className="font-mono text-[0.7rem] text-txt-muted uppercase tracking-wider mb-2">
                    Project Results
                  </p>
                  {results.map(result => (
                    <div
                      key={result.projectId}
                      className={cn(
                        'flex items-center gap-2 p-2 rounded text-sm',
                        result.status === 'success'
                          ? 'bg-bio-dim/50 text-txt'
                          : 'bg-error-dim/50 text-txt',
                      )}
                    >
                      {result.status === 'success' ? (
                        <CheckCircle className="h-4 w-4 text-bio shrink-0" />
                      ) : (
                        <X className="h-4 w-4 text-error shrink-0" />
                      )}
                      <span className="font-mono text-[0.8rem] flex-1">
                        {result.projectId}
                      </span>
                      {result.status === 'error' && result.errorDetail && (
                        <span className="text-[0.7rem] text-txt-dim">
                          {result.errorDetail.substring(0, 50)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-2 pt-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setResults([]);
                    setShowResults(false);
                    // Keep form data for retry
                  }}
                  className="flex-1"
                >
                  Back
                </Button>
                <Button
                  variant="secondary"
                  onClick={onClose}
                  className="flex-1"
                >
                  Close
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </SlideOverPanel>
  );
}
