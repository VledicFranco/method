/**
 * ExperimentDetail — per-experiment view (PRD 041).
 *
 * Renders at /lab/:id. Shows experiment header with status badge and a table
 * of runs with condition/task/metrics columns. Clicking a run row navigates
 * to /lab/:id/run/:runId.
 */

import { useNavigate, useParams } from 'react-router-dom';
import { PageShell } from '@/shared/layout/PageShell';
import { Badge } from '@/shared/components/Badge';
import { useExperiment } from '@/domains/experiments/useExperiments';
import { formatRelativeTime, formatTokens } from '@/shared/lib/formatters';
import type { Run, ExperimentStatus, RunStatus } from '@/domains/experiments/types';
import { ArrowLeft, FlaskConical } from 'lucide-react';

// ── Status badge configs ─────────────────────────────────────────

type BadgeVariant = 'default' | 'bio' | 'cyan' | 'solar' | 'error' | 'nebular' | 'muted' | 'outlined';

const EXPERIMENT_STATUS_BADGE: Record<
  ExperimentStatus,
  { variant: BadgeVariant; label: string }
> = {
  drafting:  { variant: 'muted',  label: 'drafting'  },
  running:   { variant: 'bio',    label: 'running'   },
  analyzing: { variant: 'solar',  label: 'analyzing' },
  concluded: { variant: 'cyan',   label: 'concluded' },
};

const RUN_STATUS_BADGE: Record<
  RunStatus,
  { variant: BadgeVariant; label: string }
> = {
  running:   { variant: 'bio',   label: 'running'   },
  completed: { variant: 'cyan',  label: 'completed' },
  failed:    { variant: 'error', label: 'failed'    },
};

// ── Helpers ──────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// ── Loading skeleton ─────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-bdr">
      {[90, 120, 180, 70, 60, 80, 70, 80, 110].map((w, i) => (
        <td key={i} className="px-3 py-3">
          <div
            className="h-3 rounded bg-abyss-light animate-pulse"
            style={{ width: w }}
          />
        </td>
      ))}
    </tr>
  );
}

// ── Run row ──────────────────────────────────────────────────────

function RunRow({ run, experimentId }: { run: Run; experimentId: string }) {
  const navigate = useNavigate();
  const statusBadge = RUN_STATUS_BADGE[run.status] ?? { variant: 'muted' as BadgeVariant, label: run.status };

  return (
    <tr
      className="border-b border-bdr hover:bg-abyss-light/50 cursor-pointer transition-colors"
      onClick={() => navigate(`/lab/${experimentId}/run/${run.id}`)}
    >
      {/* Run ID — first 8 chars */}
      <td className="px-3 py-3 font-mono text-[0.7rem] text-txt-muted whitespace-nowrap">
        {run.id.slice(0, 8)}
      </td>

      {/* Condition name */}
      <td className="px-3 py-3 text-xs text-txt font-medium whitespace-nowrap">
        {run.conditionName}
      </td>

      {/* Task — truncated to 50 chars */}
      <td className="px-3 py-3 text-xs text-txt-dim max-w-[200px]">
        <span title={run.task}>{truncate(run.task, 50)}</span>
      </td>

      {/* Status */}
      <td className="px-3 py-3">
        <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
      </td>

      {/* Cycles */}
      <td className="px-3 py-3 text-xs text-txt-dim text-center">
        {run.metrics?.cycles ?? '—'}
      </td>

      {/* Tokens */}
      <td className="px-3 py-3 text-xs text-txt-dim text-center">
        {run.metrics ? formatTokens(run.metrics.totalTokens) : '—'}
      </td>

      {/* Interventions */}
      <td className="px-3 py-3 text-xs text-txt-dim text-center">
        {run.metrics?.interventions ?? '—'}
      </td>

      {/* Verdict */}
      <td className="px-3 py-3 text-xs text-txt-muted">
        {run.metrics?.verdict ?? '—'}
      </td>

      {/* Started at */}
      <td className="px-3 py-3 text-xs text-txt-muted whitespace-nowrap">
        {formatRelativeTime(run.startedAt)}
      </td>
    </tr>
  );
}

// ── Main component ───────────────────────────────────────────────

export default function ExperimentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useExperiment(id ?? '');

  const experiment = data?.experiment;
  const runs = data?.runs ?? [];

  const expBadge = experiment
    ? (EXPERIMENT_STATUS_BADGE[experiment.status] ?? { variant: 'muted' as BadgeVariant, label: experiment.status })
    : null;

  return (
    <PageShell>
      {/* Back button */}
      <button
        onClick={() => navigate('/lab')}
        className="inline-flex items-center gap-1.5 text-xs text-txt-dim hover:text-txt mb-4 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Experiment Lab
      </button>

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-error/30 bg-error-dim px-4 py-3 text-sm text-error mb-4">
          Failed to load experiment: {(error as Error).message}
        </div>
      )}

      {/* Header skeleton */}
      {isLoading && !experiment && (
        <div className="mb-6">
          <div className="h-6 w-64 rounded bg-abyss-light animate-pulse mb-2" />
          <div className="h-4 w-96 rounded bg-abyss-light animate-pulse" />
        </div>
      )}

      {/* Experiment header */}
      {experiment && (
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <FlaskConical className="h-5 w-5 text-bio shrink-0" />
            <h1 className="font-display text-xl text-txt tracking-tight">
              {experiment.name}
            </h1>
            {expBadge && (
              <Badge variant={expBadge.variant}>{expBadge.label}</Badge>
            )}
          </div>
          <p className="text-sm text-txt-dim ml-8">{experiment.hypothesis}</p>
        </div>
      )}

      {/* Runs table */}
      <div className="rounded-card border border-bdr bg-abyss overflow-hidden">
        <div className="px-4 py-2.5 border-b border-bdr bg-abyss-light/50 flex items-center justify-between">
          <span className="text-xs font-medium text-txt-dim">
            Runs
            {!isLoading && (
              <span className="ml-2 text-txt-muted">({runs.length})</span>
            )}
          </span>
        </div>

        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-bdr">
              {[
                'Run ID',
                'Condition',
                'Task',
                'Status',
                'Cycles',
                'Tokens',
                'Interventions',
                'Verdict',
                'Started',
              ].map((col) => (
                <th
                  key={col}
                  className="px-3 py-2.5 text-[0.68rem] font-medium text-txt-muted uppercase tracking-wide whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
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

            {!isLoading && runs.length === 0 && !error && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center">
                  <p className="text-sm text-txt-dim">No runs yet.</p>
                  <p className="text-xs text-txt-muted mt-1">
                    Create a run using MCP tools or the API.
                  </p>
                </td>
              </tr>
            )}

            {!isLoading &&
              runs.map((run) => (
                <RunRow key={run.id} run={run} experimentId={id ?? ''} />
              ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
