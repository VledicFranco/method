/**
 * PRD 019.2: Registry Page
 *
 * Two-column layout: sidebar tree (340px) + main content detail panel.
 * Uses PageShell with `wide` prop for the expanded content area.
 */

import { useState, useCallback } from 'react';
import { RefreshCw, BookOpen, Package, Copy } from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { RegistryTree } from '@/components/domain/RegistryTree';
import { MethodDetail } from '@/components/domain/MethodDetail';
import { CopyMethodologyModal } from '@/components/domain/CopyMethodologyModal';
import { useRegistryTree, useMethodDetail, useRegistryManifest, useRegistryReload } from '@/hooks/useRegistry';
import { cn } from '@/lib/cn';
import type { ManifestEntry } from '@/lib/registry-types';

// ── Manifest View ──

interface ManifestViewProps {
  onCopyClick?: (sourceId: string, methodologyName: string) => void;
}

function ManifestView({ onCopyClick }: ManifestViewProps) {
  const { data: manifest, isLoading } = useRegistryManifest();

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-16 bg-abyss-light rounded-card" />
        <div className="h-16 bg-abyss-light rounded-card" />
        <div className="h-16 bg-abyss-light rounded-card" />
      </div>
    );
  }

  if (!manifest) {
    return <p className="text-sm text-txt-dim py-8 text-center">Failed to load manifest.</p>;
  }

  const outdatedCount = manifest.installed.filter((e) => e.sync_status === 'outdated').length;

  return (
    <div className="space-y-4">
      {/* Outdated warning */}
      {outdatedCount > 0 && (
        <Card accent="solar" padding="md">
          <p className="text-sm text-solar">
            {outdatedCount} installed {outdatedCount === 1 ? 'methodology has' : 'methodologies have'} a newer
            version available in the registry.
          </p>
        </Card>
      )}

      <div className="flex items-center gap-3 mb-2">
        <span className="font-mono text-[0.75rem] text-txt-dim">Project: {manifest.project}</span>
        <span className="font-mono text-[0.75rem] text-txt-muted">Last updated: {manifest.last_updated}</span>
      </div>

      {manifest.installed.map((entry) => (
        <ManifestCard key={entry.id} entry={entry} onCopyClick={onCopyClick} />
      ))}
    </div>
  );
}

function SyncStatusBadge({ status }: { status: ManifestEntry['sync_status'] }) {
  const variants: Record<string, 'bio' | 'solar' | 'error' | 'muted'> = {
    current: 'bio',
    outdated: 'solar',
    ahead: 'error',
    not_found: 'muted',
  };
  return <Badge variant={variants[status] ?? 'muted'} label={status} size="sm" />;
}

interface ManifestCardProps {
  entry: ManifestEntry;
  onCopyClick?: (sourceId: string, methodologyName: string) => void;
}

function ManifestCard({ entry, onCopyClick }: ManifestCardProps) {
  const [showArtifacts, setShowArtifacts] = useState(false);

  return (
    <Card padding="md">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm text-bio font-medium">{entry.id}</span>
            <Badge variant="muted" label={entry.type} size="sm" />
            <SyncStatusBadge status={entry.sync_status} />
            {entry.status && (
              <Badge
                variant={entry.status === 'promoted' ? 'cyan' : entry.status === 'trial' ? 'solar' : 'muted'}
                label={entry.status}
                size="sm"
              />
            )}
          </div>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="font-mono text-[0.75rem] text-txt-dim">
              installed: v{entry.version}
            </span>
            <span className="font-mono text-[0.75rem] text-txt-muted">
              registry: {entry.registry_version ? `v${entry.registry_version}` : 'N/A'}
            </span>
            {entry.instance_id && (
              <span className="font-mono text-[0.7rem] text-txt-muted">{entry.instance_id}</span>
            )}
          </div>
          {entry.extends && (
            <p className="mt-1 text-[0.7rem] text-txt-muted">extends: {entry.extends}</p>
          )}
          {entry.note && (
            <p className="mt-1 text-[0.7rem] text-txt-muted italic">{entry.note}</p>
          )}
        </div>
        {entry.type === 'methodology' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onCopyClick?.(entry.id, entry.id)}
            title="Copy this methodology to other projects"
          >
            <Copy className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Artifacts */}
      {entry.artifacts.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowArtifacts(!showArtifacts)}
            className="text-[0.7rem] text-txt-muted hover:text-txt-dim transition-colors"
          >
            {showArtifacts ? 'Hide' : 'Show'} artifacts ({entry.artifacts.length})
          </button>
          {showArtifacts && (
            <ul className="mt-1 space-y-0.5">
              {entry.artifacts.map((art, i) => (
                <li key={i} className="font-mono text-[0.7rem] text-txt-dim pl-2">{art}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Main Page ──

type ViewMode = 'registry' | 'manifest';

export default function Registry() {
  const [viewMode, setViewMode] = useState<ViewMode>('registry');
  const [selectedMethodology, setSelectedMethodology] = useState<string | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copySourceId, setCopySourceId] = useState<string>('');
  const [copyMethodologyName, setCopyMethodologyName] = useState<string>('');

  const { data: tree, isLoading: treeLoading } = useRegistryTree();
  const { data: methodDetail, isLoading: detailLoading } = useMethodDetail(selectedMethodology, selectedMethod);
  const reload = useRegistryReload();

  const handleSelect = useCallback((methodologyId: string, methodId: string) => {
    setSelectedMethodology(methodologyId);
    setSelectedMethod(methodId);
  }, []);

  const handleReload = useCallback(() => {
    reload.mutate();
  }, [reload]);

  const handleCopyClick = useCallback((sourceId: string, methodologyName: string) => {
    setCopySourceId(sourceId);
    setCopyMethodologyName(methodologyName);
    setCopyModalOpen(true);
  }, []);

  const handleCopySuccess = useCallback(() => {
    // Refetch manifest after successful copy
    reload.mutate();
  }, [reload]);

  return (
    <>
      <PageShell
        wide
        title="Registry"
        actions={
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex items-center rounded-lg border border-bdr overflow-hidden">
              <button
                onClick={() => setViewMode('registry')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-[0.75rem] font-medium transition-colors',
                  viewMode === 'registry'
                    ? 'bg-bio-dim text-bio'
                    : 'text-txt-dim hover:text-txt hover:bg-abyss-light',
                )}
              >
                <BookOpen className="h-3.5 w-3.5" />
                Browse
              </button>
              <button
                onClick={() => setViewMode('manifest')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-[0.75rem] font-medium transition-colors',
                  viewMode === 'manifest'
                    ? 'bg-bio-dim text-bio'
                    : 'text-txt-dim hover:text-txt hover:bg-abyss-light',
                )}
              >
                <Package className="h-3.5 w-3.5" />
                Manifest
              </button>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleReload}
              disabled={reload.isPending}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', reload.isPending && 'animate-spin')} />
            </Button>
          </div>
        }
      >
        {viewMode === 'manifest' ? (
          <ManifestView onCopyClick={handleCopyClick} />
      ) : (
        <div className="flex gap-0 -mx-sp-4">
          {/* Sidebar tree (340px) */}
          <div className="w-[340px] shrink-0 border-r border-bdr h-[calc(100vh-130px)] sticky top-[82px]">
            {treeLoading ? (
              <div className="p-4 space-y-3 animate-pulse">
                <div className="h-5 w-24 bg-abyss-light rounded" />
                <div className="h-3 w-40 bg-abyss-light rounded" />
                <div className="h-8 w-full bg-abyss-light rounded-lg mt-3" />
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-8 w-full bg-abyss-light/50 rounded ml-4" />
                ))}
              </div>
            ) : tree ? (
              <RegistryTree
                methodologies={tree.methodologies}
                totals={tree.totals}
                selectedMethodology={selectedMethodology}
                selectedMethod={selectedMethod}
                onSelect={handleSelect}
              />
            ) : (
              <div className="p-4">
                <p className="text-sm text-txt-dim">Failed to load registry.</p>
              </div>
            )}
          </div>

          {/* Main detail panel */}
          <div className="flex-1 min-w-0 px-sp-6 py-sp-2 max-w-[720px]">
            {!selectedMethod ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <BookOpen className="h-10 w-10 text-txt-muted mb-4" />
                <p className="text-sm text-txt-dim">Select a method or protocol from the tree to view its details.</p>
                {tree && (
                  <p className="text-[0.7rem] text-txt-muted mt-2 font-mono">
                    {tree.totals.methodologies} methodologies, {tree.totals.methods} methods, {tree.totals.protocols} protocols
                  </p>
                )}
              </div>
            ) : detailLoading ? (
              <div className="space-y-4 animate-pulse">
                <div className="h-6 w-48 bg-abyss-light rounded" />
                <div className="h-4 w-72 bg-abyss-light rounded" />
                <div className="h-8 w-full bg-abyss-light rounded-lg mt-4" />
                <div className="h-48 w-full bg-abyss-light/50 rounded-card mt-4" />
              </div>
            ) : methodDetail ? (
              <MethodDetail
                data={methodDetail}
                methodologyId={selectedMethodology!}
              />
            ) : (
              <Card padding="lg">
                <p className="text-sm text-txt-dim text-center py-4">Failed to load method detail.</p>
              </Card>
            )}
          </div>
        </div>
      )}
      </PageShell>

      <CopyMethodologyModal
        open={copyModalOpen}
        onClose={() => setCopyModalOpen(false)}
        initialSourceId={copySourceId}
        initialMethodName={copyMethodologyName}
        onSuccess={handleCopySuccess}
      />
    </>
  );
}
