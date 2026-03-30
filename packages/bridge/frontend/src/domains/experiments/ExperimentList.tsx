/**
 * ExperimentList — Lab dashboard landing page (PRD 041).
 *
 * Renders at /lab. Shows all experiments with status badges, condition/run
 * counts, and last-activity timestamps. Clicking a row navigates to /lab/:id.
 */

import { useNavigate } from 'react-router-dom';
import { PageShell } from '@/shared/layout/PageShell';
import { Badge } from '@/shared/components/Badge';
import { useExperimentList } from '@/domains/experiments/useExperiments';
import { formatRelativeTime } from '@/shared/lib/formatters';
import type { Experiment, ExperimentStatus } from '@/domains/experiments/types';
import { FlaskConical, RefreshCw } from 'lucide-react';

// ── Status badge config ──────────────────────────────────────────

type BadgeVariant = 'default' | 'bio' | 'cyan' | 'solar' | 'error' | 'nebular' | 'muted' | 'outlined';

const STATUS_BADGE: Record<
  ExperimentStatus,
  { variant: BadgeVariant; label: string }
> = {
  drafting:  { variant: 'muted',   label: 'drafting'   },
  running:   { variant: 'bio',     label: 'running'    },
  analyzing: { variant: 'solar',   label: 'analyzing'  },
  concluded: { variant: 'cyan',    label: 'concluded'  },
};

// ── Loading skeleton ─────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-bdr">
      {[180, 260, 80, 60, 60, 100].map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div
            className="h-3 rounded bg-abyss-light animate-pulse"
            style={{ width: w }}
          />
        </td>
      ))}
    </tr>
  );
}

// ── Experiment row ───────────────────────────────────────────────

function ExperimentRow({ experiment }: { experiment: Experiment }) {
  const navigate = useNavigate();
  const badge = STATUS_BADGE[experiment.status] ?? { variant: 'muted' as BadgeVariant, label: experiment.status };
  const hypothesis =
    experiment.hypothesis.length > 80
      ? `${experiment.hypothesis.slice(0, 80)}…`
      : experiment.hypothesis;

  return (
    <tr
      className="border-b border-bdr hover:bg-abyss-light/50 cursor-pointer transition-colors"
      onClick={() => navigate(`/lab/${experiment.id}`)}
    >
      <td className="px-4 py-3 font-display text-sm text-txt font-medium whitespace-nowrap">
        {experiment.name}
      </td>
      <td className="px-4 py-3 text-xs text-txt-dim max-w-[300px]">
        <span title={experiment.hypothesis}>{hypothesis}</span>
      </td>
      <td className="px-4 py-3">
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </td>
      <td className="px-4 py-3 text-sm text-txt-dim text-center">
        {experiment.conditions.length}
      </td>
      <td className="px-4 py-3 text-sm text-txt-dim text-center">
        {/* Runs count not returned in list — show dash until detail is loaded */}
        —
      </td>
      <td className="px-4 py-3 text-xs text-txt-muted whitespace-nowrap">
        {formatRelativeTime(experiment.updatedAt)}
      </td>
    </tr>
  );
}

// ── Main component ───────────────────────────────────────────────

export default function ExperimentList() {
  const { data: experiments, isLoading, error, refetch } = useExperimentList();

  return (
    <PageShell
      title="Experiment Lab"
      actions={
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-txt-dim hover:text-txt hover:bg-abyss-light transition-colors"
          title="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      }
    >
      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-error/30 bg-error-dim px-4 py-3 text-sm text-error mb-4">
          Failed to load experiments: {(error as Error).message}
        </div>
      )}

      {/* Table */}
      <div className="rounded-card border border-bdr bg-abyss overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-bdr bg-abyss-light/50">
              <th className="px-4 py-2.5 text-[0.7rem] font-medium text-txt-muted uppercase tracking-wide">
                Name
              </th>
              <th className="px-4 py-2.5 text-[0.7rem] font-medium text-txt-muted uppercase tracking-wide">
                Hypothesis
              </th>
              <th className="px-4 py-2.5 text-[0.7rem] font-medium text-txt-muted uppercase tracking-wide">
                Status
              </th>
              <th className="px-4 py-2.5 text-[0.7rem] font-medium text-txt-muted uppercase tracking-wide text-center">
                Conditions
              </th>
              <th className="px-4 py-2.5 text-[0.7rem] font-medium text-txt-muted uppercase tracking-wide text-center">
                Runs
              </th>
              <th className="px-4 py-2.5 text-[0.7rem] font-medium text-txt-muted uppercase tracking-wide">
                Last activity
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            )}

            {!isLoading && !error && experiments && experiments.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <FlaskConical className="h-8 w-8 text-txt-muted mx-auto mb-3 opacity-50" />
                  <p className="text-sm text-txt-dim">No experiments yet.</p>
                  <p className="text-xs text-txt-muted mt-1">
                    Create one using MCP tools or the API.
                  </p>
                </td>
              </tr>
            )}

            {!isLoading &&
              experiments?.map((exp) => (
                <ExperimentRow key={exp.id} experiment={exp} />
              ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
