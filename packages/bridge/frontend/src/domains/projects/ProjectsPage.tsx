/**
 * WS-3: Dedicated Projects page with one-tap spawn from any discovered project.
 * Each project shows its path, status, and a direct "Spawn" button.
 * Spawn pre-fills workdir from the project's path — no manual typing needed.
 */

import { useState, useCallback } from 'react';
import { PageShell } from '@/shared/layout/PageShell';
import { Card } from '@/shared/components/Card';
import { Badge } from '@/shared/components/Badge';
import { Button } from '@/shared/components/Button';
import { useProjects } from '@/domains/projects/useProjects';
import { useSessions } from '@/domains/sessions/useSessions';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/shared/lib/cn';
import { RefreshCw, AlertCircle, Terminal, FolderOpen, Play, Loader2 } from 'lucide-react';
import type { ProjectMetadata } from '@/domains/projects/types';

function ProjectSpawnCard({
  project,
  onSpawn,
  isSpawning,
}: {
  project: ProjectMetadata;
  onSpawn: (project: ProjectMetadata) => void;
  isSpawning: boolean;
}) {
  const getStatusColor = (status: string): 'bio' | 'solar' | 'error' => {
    switch (status) {
      case 'healthy': return 'bio';
      case 'degraded': return 'solar';
      case 'error': return 'error';
      default: return 'solar';
    }
  };

  return (
    <div className="rounded-card border border-bdr bg-abyss p-sp-4 hover:border-bio/30 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <FolderOpen className="h-4 w-4 text-bio shrink-0" />
            <h3 className="font-display text-sm font-semibold text-txt truncate">
              {project.name}
            </h3>
            <Badge
              variant="outlined"
              color={getStatusColor(project.status)}
              size="sm"
            >
              {project.status}
            </Badge>
          </div>

          {project.description && (
            <p className="text-xs text-txt-dim mb-2 line-clamp-1">{project.description}</p>
          )}

          <p className="font-mono text-[0.65rem] text-txt-muted truncate" title={project.path}>
            {project.path}
          </p>

          {project.installed_methodologies.length > 0 && (
            <div className="flex gap-1 mt-2 flex-wrap">
              {project.installed_methodologies.slice(0, 3).map((m) => (
                <Badge key={m} variant="outlined" color="cyan" size="sm">
                  {m}
                </Badge>
              ))}
              {project.installed_methodologies.length > 3 && (
                <Badge variant="muted" size="sm">
                  +{project.installed_methodologies.length - 3}
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* One-tap spawn button */}
        <Button
          variant="primary"
          size="sm"
          leftIcon={isSpawning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          onClick={() => onSpawn(project)}
          disabled={isSpawning}
          className="shrink-0"
        >
          Spawn
        </Button>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const { projects, loading, error, refetch } = useProjects();
  const { spawn, isSpawning } = useSessions();
  const navigate = useNavigate();
  const [spawningProjectId, setSpawningProjectId] = useState<string | null>(null);

  const handleSpawn = useCallback(
    async (project: ProjectMetadata) => {
      setSpawningProjectId(project.id);
      try {
        await spawn({
          workdir: project.path,
          purpose: `Session for ${project.name}`,
          mode: 'pty',
        });
        // Navigate to sessions page to see the new session
        navigate('/sessions');
      } catch (err) {
        console.error('Spawn failed:', err);
      } finally {
        setSpawningProjectId(null);
      }
    },
    [spawn, navigate],
  );

  return (
    <PageShell
      title="Projects"
      actions={
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />}
          onClick={() => refetch()}
          loading={loading}
        >
          {loading ? 'Scanning' : 'Scan'}
        </Button>
      }
    >
      {error ? (
        <Card>
          <div className="flex gap-sp-3 items-start">
            <AlertCircle className="h-5 w-5 text-error shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-txt">Failed to load projects</p>
              <p className="text-sm text-txt-dim mt-1">{error}</p>
            </div>
          </div>
        </Card>
      ) : projects.length === 0 ? (
        <Card className="text-center py-sp-8">
          <FolderOpen className="h-8 w-8 text-txt-muted mx-auto mb-3" />
          <p className="text-txt-dim text-sm mb-1">No projects discovered</p>
          <p className="text-txt-muted text-xs">
            Projects with .method directories will appear here.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {projects.map((project) => (
            <ProjectSpawnCard
              key={project.id}
              project={project}
              onSpawn={handleSpawn}
              isSpawning={isSpawning && spawningProjectId === project.id}
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}
