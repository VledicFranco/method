import { useProjects } from '@/domains/projects/useProjects';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ProjectMetadata } from '@/lib/types';
import { memo } from 'react';

export interface ProjectListViewProps {
  onProjectSelect?: (project: ProjectMetadata) => void;
}

// F-P-3: Memoize with custom comparator
function ProjectListViewComponent({ onProjectSelect }: ProjectListViewProps) {
  const { projects, loading, error, refetch } = useProjects();

  const getStatusColor = (status: string): 'bio' | 'solar' | 'error' | 'nebular' | 'cyan' => {
    switch (status) {
      case 'healthy':
        return 'bio';
      case 'degraded':
        return 'solar';
      case 'error':
        return 'error';
      default:
        return 'nebular';
    }
  };

  const getStatusLabel = (status: string): string => {
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  const formatDate = (dateString: string): string => {
    try {
      return new Date(dateString).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return 'N/A';
    }
  };

  if (error) {
    return (
      <div className="space-y-sp-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-txt">Projects</h2>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => refetch()}
            leftIcon={<RefreshCw className="h-4 w-4" />}
          >
            Retry
          </Button>
        </div>
        <Card variant="default" padding="md" accent="error" role="alert" aria-live="polite" aria-atomic="true">
          <div className="flex gap-sp-3 items-start">
            <AlertCircle className="h-5 w-5 text-error shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-txt">Failed to load projects</p>
              <p className="text-sm text-txt-dim mt-1">{error}</p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-sp-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-txt">Projects</h2>
          <p className="text-sm text-txt-dim mt-1">
            {loading ? 'Discovering...' : `${projects.length} project${projects.length !== 1 ? 's' : ''} found`}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => refetch()}
          loading={loading}
          leftIcon={<RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />}
        >
          {loading ? 'Scanning' : 'Scan'}
        </Button>
      </div>

      {projects.length === 0 ? (
        <Card variant="default" padding="md" className="text-center py-sp-8">
          <p className="text-txt-dim">No projects discovered yet.</p>
          <p className="text-xs text-txt-muted mt-2">Check that your projects contain .method directories.</p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-card border border-bdr bg-abyss">
          <table className="w-full text-sm" role="table">
            <thead>
              <tr className="border-b border-bdr" role="row">
                <th className="px-sp-4 py-sp-3 text-left font-medium text-txt-dim" role="columnheader">ID</th>
                <th className="px-sp-4 py-sp-3 text-left font-medium text-txt-dim" role="columnheader">Name</th>
                <th className="px-sp-4 py-sp-3 text-left font-medium text-txt-dim" role="columnheader">Description</th>
                <th className="px-sp-4 py-sp-3 text-left font-medium text-txt-dim" role="columnheader">Status</th>
                <th className="px-sp-4 py-sp-3 text-left font-medium text-txt-dim" role="columnheader">Methodologies</th>
                <th className="px-sp-4 py-sp-3 text-left font-medium text-txt-dim" role="columnheader">Last Scanned</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project, index) => (
                <tr
                  key={project.id}
                  className={cn(
                    'border-b border-bdr transition-colors hover:bg-abyss-light cursor-pointer',
                    index === projects.length - 1 && 'border-b-0',
                  )}
                  onClick={() => onProjectSelect?.(project)}
                  role="row"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      onProjectSelect?.(project);
                    }
                  }}
                >
                  <td className="px-sp-4 py-sp-3" role="cell">
                    <code className="text-xs bg-void/50 px-2 py-1 rounded text-txt-muted">
                      {project.id.slice(0, 8)}
                    </code>
                  </td>
                  <td className="px-sp-4 py-sp-3 font-medium text-txt" role="cell">{project.name}</td>
                  <td className="px-sp-4 py-sp-3 text-txt-dim max-w-xs truncate" role="cell">
                    {project.description || '—'}
                  </td>
                  <td className="px-sp-4 py-sp-3" role="cell">
                    <Badge
                      variant="outlined"
                      color={getStatusColor(project.status)}
                      className="w-fit"
                    >
                      {getStatusLabel(project.status)}
                    </Badge>
                  </td>
                  <td className="px-sp-4 py-sp-3" role="cell">
                    {project.installed_methodologies && project.installed_methodologies.length > 0 ? (
                      <div className="flex gap-1 flex-wrap max-w-xs">
                        {project.installed_methodologies.slice(0, 3).map((method) => (
                          <Badge key={method} variant="outlined" color="cyan" className="text-xs">
                            {method}
                          </Badge>
                        ))}
                        {project.installed_methodologies.length > 3 && (
                          <Badge variant="outlined" color="nebular" className="text-xs">
                            +{project.installed_methodologies.length - 3}
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-txt-muted">None</span>
                    )}
                  </td>
                  <td className="px-sp-4 py-sp-3 text-xs text-txt-muted whitespace-nowrap" role="cell">
                    {formatDate(project.last_scanned)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// F-P-3: Export memoized component
export const ProjectListView = memo(ProjectListViewComponent, (prevProps, nextProps) => {
  // Re-render only if onProjectSelect callback changes (functions are compared by reference)
  return prevProps.onProjectSelect === nextProps.onProjectSelect;
});
