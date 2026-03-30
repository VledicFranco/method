/**
 * RunDetail — per-run trace view (PRD 041).
 *
 * Renders at /lab/:id/run/:runId. Shows the run header, a cycle trace
 * (reusing CycleTrace from the sessions domain), and a collapsible JSON
 * config snapshot.
 *
 * Adaptation strategy:
 *   TraceRecord[] (cognitive.* events from events.jsonl) are grouped by
 *   cycleNumber and mapped to CognitiveCycleData. If the payload doesn't
 *   carry the expected fields, a fallback table is rendered instead.
 */

import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageShell } from '@/shared/layout/PageShell';
import { Badge } from '@/shared/components/Badge';
import { CycleTrace } from '@/domains/sessions/CycleTrace';
import { useRun, useRunTraces } from '@/domains/experiments/useExperiments';
import { formatRelativeTime, formatDateTime } from '@/shared/lib/formatters';
import type { TraceRecord, RunStatus } from '@/domains/experiments/types';
import type {
  CognitiveTurnData,
  CognitiveCycleData,
} from '@/domains/sessions/types';
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────

type BadgeVariant = 'default' | 'bio' | 'cyan' | 'solar' | 'error' | 'nebular' | 'muted' | 'outlined';

const RUN_STATUS_BADGE: Record<RunStatus, { variant: BadgeVariant; label: string }> = {
  running:   { variant: 'bio',   label: 'running'   },
  completed: { variant: 'cyan',  label: 'completed' },
  failed:    { variant: 'error', label: 'failed'    },
};

// ── Trace adaptation ─────────────────────────────────────────────

/**
 * Extract a string from an unknown payload field.
 * Returns a fallback if the field is absent or not a string.
 */
function extractString(
  payload: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const v = payload[key];
  return typeof v === 'string' ? v : fallback;
}

function extractNumber(
  payload: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const v = payload[key];
  return typeof v === 'number' ? v : fallback;
}

/**
 * Convert TraceRecord[] to CognitiveTurnData for CycleTrace.
 *
 * Groups records by cycleNumber, picks a representative action per cycle
 * (preferring the 'act' phase record), and extracts confidence/tokens from
 * the payload. Returns null if no cycle data can be extracted (triggers
 * fallback table rendering).
 */
function adaptTracesToCycleData(traces: TraceRecord[]): CognitiveTurnData | null {
  const cycleRecords = traces.filter((t) => t.cycleNumber !== undefined);
  if (cycleRecords.length === 0) return null;

  // Group by cycle number
  const byNumber = new Map<number, TraceRecord[]>();
  for (const t of cycleRecords) {
    const n = t.cycleNumber!;
    if (!byNumber.has(n)) byNumber.set(n, []);
    byNumber.get(n)!.push(t);
  }

  const cycles: CognitiveCycleData[] = [];

  for (const [num, recs] of [...byNumber.entries()].sort((a, b) => a[0] - b[0])) {
    // Prefer 'act' phase record for the primary action
    const actRec =
      recs.find((r) => r.phase === 'act') ??
      recs.find((r) => r.phase === 'reason') ??
      recs[recs.length - 1];

    const action = extractString(actRec.payload, 'action', actRec.phase ?? 'step');
    const confidence = extractNumber(actRec.payload, 'confidence', 1.0);
    const tokens = extractNumber(actRec.payload, 'tokens', 0);

    // Check for monitor intervention in this cycle's records
    const monitorRec = recs.find((r) => r.phase === 'monitor');
    let monitor: CognitiveCycleData['monitor'];
    if (monitorRec) {
      const intervention = extractString(
        monitorRec.payload,
        'intervention',
        'intervention',
      );
      const restricted = monitorRec.payload['restricted'];
      monitor = {
        intervention,
        restricted: Array.isArray(restricted)
          ? restricted.filter((r): r is string => typeof r === 'string')
          : undefined,
      };
    }

    // Affect data
    const affectRec = recs.find(
      (r) => r.payload['affect'] && typeof r.payload['affect'] === 'object',
    );
    let affect: CognitiveCycleData['affect'];
    if (affectRec) {
      const raw = affectRec.payload['affect'] as Record<string, unknown>;
      affect = {
        label: extractString(raw, 'label', 'neutral'),
        valence: extractNumber(raw, 'valence', 0),
        arousal: extractNumber(raw, 'arousal', 0),
      };
    }

    cycles.push({ number: num, action, confidence, tokens, monitor, affect });
  }

  if (cycles.length === 0) return null;
  return { cycles };
}

// ── Fallback trace table ─────────────────────────────────────────

function TraceTable({ traces }: { traces: TraceRecord[] }) {
  return (
    <div className="rounded-card border border-bdr bg-abyss overflow-hidden">
      <div className="px-4 py-2.5 border-b border-bdr bg-abyss-light/50">
        <span className="text-xs font-medium text-txt-dim">Trace Events ({traces.length})</span>
      </div>
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-bdr">
            {['#', 'Timestamp', 'Type', 'Cycle', 'Phase', 'Module'].map((col) => (
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
          {traces.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-sm text-txt-dim">
                No trace events yet.
              </td>
            </tr>
          )}
          {traces.map((t, i) => (
            <tr key={t.id} className="border-b border-bdr hover:bg-abyss-light/30 transition-colors">
              <td className="px-3 py-2 font-mono text-[0.68rem] text-txt-muted">{i + 1}</td>
              <td className="px-3 py-2 font-mono text-[0.68rem] text-txt-muted whitespace-nowrap">
                {formatDateTime(t.timestamp)}
              </td>
              <td className="px-3 py-2 font-mono text-[0.7rem] text-cyan">{t.type}</td>
              <td className="px-3 py-2 text-xs text-txt-dim text-center">
                {t.cycleNumber ?? '—'}
              </td>
              <td className="px-3 py-2 text-xs text-txt-dim">{t.phase ?? '—'}</td>
              <td className="px-3 py-2 text-xs text-txt-dim">{t.moduleId ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Collapsible JSON config ──────────────────────────────────────

function CollapsibleConfig({ config }: { config: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-card border border-bdr bg-abyss overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-abyss-light/30 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-xs font-medium text-txt-dim">Config Snapshot</span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-txt-muted" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-txt-muted" />
        )}
      </button>
      {open && (
        <div className="border-t border-bdr px-4 py-3 bg-void/40">
          <pre className="font-mono text-[0.7rem] text-txt-dim whitespace-pre-wrap overflow-auto max-h-64">
            {JSON.stringify(config, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────

export default function RunDetail() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const navigate = useNavigate();

  const { data: run, isLoading: runLoading, error: runError } = useRun(
    id ?? '',
    runId ?? '',
  );
  const { data: traces = [], isLoading: tracesLoading } = useRunTraces(
    id ?? '',
    runId ?? '',
  );

  const statusBadge = run
    ? (RUN_STATUS_BADGE[run.status] ?? { variant: 'muted' as BadgeVariant, label: run.status })
    : null;

  // Attempt CycleTrace adaptation; fall back to table if it fails
  const cycleData = traces.length > 0 ? adaptTracesToCycleData(traces) : null;
  const isRunning = run?.status === 'running';

  return (
    <PageShell>
      {/* Back button */}
      <button
        onClick={() => navigate(`/lab/${id}`)}
        className="inline-flex items-center gap-1.5 text-xs text-txt-dim hover:text-txt mb-4 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to experiment
      </button>

      {/* Error state */}
      {runError && (
        <div className="rounded-lg border border-error/30 bg-error-dim px-4 py-3 text-sm text-error mb-4">
          Failed to load run: {(runError as Error).message}
        </div>
      )}

      {/* Run header skeleton */}
      {runLoading && !run && (
        <div className="mb-6">
          <div className="h-5 w-48 rounded bg-abyss-light animate-pulse mb-2" />
          <div className="h-4 w-80 rounded bg-abyss-light animate-pulse" />
        </div>
      )}

      {/* Run header */}
      {run && (
        <div className="mb-6 rounded-card border border-bdr bg-abyss p-sp-4">
          <div className="flex items-center gap-3 mb-3">
            <h1 className="font-display text-lg text-txt tracking-tight">
              {run.conditionName}
            </h1>
            {statusBadge && (
              <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
            )}
          </div>

          <p className="text-sm text-txt-dim mb-3 leading-relaxed">{run.task}</p>

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-txt-muted">
            <span>
              <span className="text-txt-dim">Started:</span>{' '}
              {formatDateTime(run.startedAt)}
            </span>
            {run.completedAt && (
              <span>
                <span className="text-txt-dim">Completed:</span>{' '}
                {formatRelativeTime(run.completedAt)}
              </span>
            )}
            {run.metrics && (
              <>
                <span>
                  <span className="text-txt-dim">Cycles:</span> {run.metrics.cycles}
                </span>
                <span>
                  <span className="text-txt-dim">Tokens:</span>{' '}
                  {run.metrics.totalTokens.toLocaleString()}
                </span>
                {run.metrics.interventions > 0 && (
                  <span>
                    <span className="text-txt-dim">Interventions:</span>{' '}
                    {run.metrics.interventions}
                  </span>
                )}
                {run.metrics.verdict && (
                  <span>
                    <span className="text-txt-dim">Verdict:</span>{' '}
                    {run.metrics.verdict}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Trace section */}
      <div className="mb-4 rounded-card border border-bdr bg-abyss p-sp-4">
        <h2 className="font-display text-sm text-txt mb-3">Cognitive Trace</h2>

        {tracesLoading && (
          <div className="h-10 rounded bg-abyss-light animate-pulse" />
        )}

        {!tracesLoading && cycleData ? (
          /* CycleTrace — adapted from TraceRecord[] */
          <CycleTrace data={cycleData} isStreaming={isRunning} />
        ) : !tracesLoading ? (
          /* Fallback: raw trace table */
          <TraceTable traces={traces} />
        ) : null}
      </div>

      {/* Config snapshot */}
      {run?.config && <CollapsibleConfig config={run.config} />}
    </PageShell>
  );
}
