/**
 * StructuredCard — Rich card renderer within chat messages.
 *
 * Card types:
 *   - feature-spec: problem, scope, criteria list with inline edit
 *   - commission-plan: commission DAG as a list with dependencies
 *   - review-findings: findings grouped by severity
 *   - debate-decision: collapsible card with decision and arguments
 *   - evidence-report: verdict badge + mini stats
 *
 * @see PRD 047 §Conversation Panel — Structured Cards
 */

import { useState, useRef, useCallback } from 'react';
import { cn } from '@/shared/lib/cn';
import type { StructuredCard as StructuredCardType } from './types';

// ── Feature Spec Card ──

function FeatureSpecCard({ data }: { data: Record<string, unknown> }) {
  const problem = data.problem as string | undefined;
  const scope = data.scope as string | undefined;
  const approach = data.approach as string | undefined;
  const criteria = data.criteria as string[] | undefined;
  const addedIndex = data.addedIndex as number | undefined;
  const constraints = data.constraints as string[] | undefined;

  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const editRef = useRef<HTMLSpanElement>(null);

  const handleEdit = useCallback((idx: number) => {
    setEditingIdx(idx);
    // Focus after React re-render
    requestAnimationFrame(() => editRef.current?.focus());
  }, []);

  const handleUpdate = useCallback(() => {
    // In a real implementation this would POST to the backend
    setEditingIdx(null);
  }, []);

  return (
    <div className="bg-void border border-bdr rounded-[5px] p-3 mt-2 font-mono text-[11px] leading-[1.7] relative group/spec">
      <button
        className="absolute top-2 right-2 bg-transparent border border-bdr text-[#64748b] w-[22px] h-[22px] rounded-[3px] cursor-pointer flex items-center justify-center text-[11px] transition-all duration-150 opacity-0 group-hover/spec:opacity-100 hover:text-txt hover:border-[#6d5aed]"
        title="Edit spec"
        onClick={() => handleEdit(0)}
      >
        &#9998;
      </button>

      {problem && (
        <div>
          <span className="text-[#6d5aed] font-semibold">problem:</span>{' '}
          <span className="text-txt">{problem}</span>
        </div>
      )}
      {scope && (
        <div>
          <span className="text-[#6d5aed] font-semibold">scope:</span>{' '}
          <span className="text-txt">{scope}</span>
        </div>
      )}
      {approach && (
        <div>
          <span className="text-[#6d5aed] font-semibold">approach:</span>{' '}
          <span className="text-txt">{approach}</span>
        </div>
      )}
      {constraints && constraints.length > 0 && (
        <div>
          <span className="text-[#6d5aed] font-semibold">constraints:</span>
          {constraints.map((c, i) => (
            <div key={i} className="text-txt-dim pl-3">
              {i + 1}. {c}
            </div>
          ))}
        </div>
      )}
      {criteria && criteria.length > 0 && (
        <div>
          <span className="text-[#6d5aed] font-semibold">criteria:</span>
          {criteria.map((c, i) => {
            const isAdded = addedIndex !== undefined && i === addedIndex;
            const isEditing = editingIdx === i + 1;

            return (
              <div
                key={i}
                className={cn(
                  'pl-3 flex items-center gap-1',
                  isAdded && 'text-[#10b981]',
                  !isAdded && 'text-txt-dim',
                )}
              >
                <span className="shrink-0">{i + 1}.</span>
                {isEditing ? (
                  <>
                    <span
                      ref={editRef}
                      contentEditable
                      suppressContentEditableWarning
                      className="bg-[#ffffff08] px-1.5 py-0 rounded-[3px] outline outline-1 outline-[#6d5aed] flex-1"
                    >
                      {c}
                    </span>
                    <button
                      onClick={handleUpdate}
                      className="bg-[#6d5aed] text-white text-[10px] font-semibold px-2 py-0.5 rounded-[3px] border-none cursor-pointer hover:bg-[#7d6cf7] transition-colors ml-1"
                    >
                      Update
                    </button>
                  </>
                ) : (
                  <span
                    className="cursor-pointer hover:underline"
                    onClick={() => handleEdit(i + 1)}
                  >
                    {c}
                    {isAdded && ' \u2713'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Commission Plan Card ──

function CommissionPlanCard({ data }: { data: Record<string, unknown> }) {
  const commissions = data.commissions as Array<{
    id: string;
    name: string;
    deps?: string[];
    status?: string;
  }> | undefined;

  if (!commissions) return null;

  return (
    <div className="bg-void border border-bdr rounded-[5px] p-3 mt-2 font-mono text-[11px] leading-[1.7]">
      <div className="text-[#6d5aed] font-semibold mb-1">Commission Plan</div>
      {commissions.map((c) => (
        <div key={c.id} className="flex items-center gap-2 py-1 border-b border-[#ffffff06] last:border-b-0">
          <span className="text-txt font-semibold w-12 shrink-0">{c.id}</span>
          <span className="text-txt-dim flex-1">{c.name}</span>
          {c.deps && c.deps.length > 0 && (
            <span className="text-[#64748b] text-[10px]">
              deps: {c.deps.join(', ')}
            </span>
          )}
          {c.status && (
            <span
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded-full',
                c.status === 'completed' && 'bg-[#10b98122] text-[#10b981]',
                c.status === 'running' && 'bg-[#3b82f622] text-[#3b82f6]',
                c.status === 'pending' && 'bg-[#ffffff08] text-[#64748b]',
              )}
            >
              {c.status}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Review Findings Card ──

function ReviewFindingsCard({ data }: { data: Record<string, unknown> }) {
  type Finding = { severity: string; message: string; file?: string; line?: number };
  const findings = data.findings as Finding[] | undefined;

  if (!findings) return null;

  const severityOrder: Record<string, number> = { 'Fix-Now': 0, 'Fix-Soon': 1, 'Suggestion': 2 };
  const sorted = [...findings].sort(
    (a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9),
  );

  const severityColor: Record<string, string> = {
    'Fix-Now': 'text-[#ef4444] bg-[#ef444422]',
    'Fix-Soon': 'text-[#f59e0b] bg-[#f59e0b22]',
    'Suggestion': 'text-[#64748b] bg-[#ffffff08]',
  };

  return (
    <div className="bg-void border border-bdr rounded-[5px] p-3 mt-2 font-mono text-[11px] leading-[1.7]">
      <div className="text-[#6d5aed] font-semibold mb-2">Review Findings</div>
      {sorted.map((f, i) => (
        <div key={i} className="flex items-start gap-2 mb-1.5 last:mb-0">
          <span
            className={cn(
              'text-[9px] font-bold px-1.5 py-0.5 rounded-[3px] shrink-0 uppercase',
              severityColor[f.severity] ?? 'text-[#64748b] bg-[#ffffff08]',
            )}
          >
            {f.severity}
          </span>
          <span className="text-txt-dim flex-1">{f.message}</span>
          {f.file && (
            <span className="text-[#64748b] text-[10px] shrink-0">
              {f.file}{f.line ? `:${f.line}` : ''}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Debate Decision Card ──

function DebateDecisionCard({ data }: { data: Record<string, unknown> }) {
  const [isOpen, setIsOpen] = useState(false);
  const motion = data.motion as string | undefined;
  const advisors = data.advisors as Array<{
    name: string;
    position: 'for' | 'against';
    argument: string;
  }> | undefined;
  const verdict = data.verdict as string | undefined;

  return (
    <div className="bg-void border border-bdr rounded-[5px] mt-2 overflow-hidden">
      <button
        className="w-full px-3 py-2 flex items-center gap-2 cursor-pointer text-xs text-[#6d5aed] font-semibold bg-transparent border-none transition-colors duration-150 hover:bg-[#ffffff06] text-left"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span
          className={cn(
            'text-[10px] transition-transform duration-150',
            isOpen && 'rotate-90',
          )}
        >
          &#9654;
        </span>
        Council Debate: {motion ?? 'Decision'}
      </button>
      {isOpen && (
        <div className="px-3 pb-3 pt-2 font-mono text-[11px] leading-[1.7] text-txt-dim border-t border-bdr">
          {motion && (
            <div>
              <span className="text-txt">motion:</span> {motion}
            </div>
          )}
          {advisors && (
            <>
              <div>
                <span className="text-txt">advisors:</span> {advisors.length}
              </div>
              {advisors.map((a, i) => (
                <div key={i}>
                  <span
                    className={cn(
                      a.position === 'for' ? 'text-[#10b981]' : 'text-[#ef4444]',
                    )}
                  >
                    {a.name}:
                  </span>{' '}
                  &ldquo;{a.argument}&rdquo;
                </div>
              ))}
            </>
          )}
          {verdict && (
            <div>
              <span className="text-txt">verdict:</span>{' '}
              <span className="text-[#10b981]">{verdict}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Evidence Report Card ──

function EvidenceReportCard({ data }: { data: Record<string, unknown> }) {
  const verdict = data.verdict as string | undefined;
  const totalCost = data.totalCost as number | undefined;
  const overheadPct = data.overheadPct as number | undefined;
  const interventions = data.interventions as number | undefined;
  const durationMin = data.durationMin as number | undefined;

  const verdictColor =
    verdict === 'FULLY_VALIDATED'
      ? 'bg-[#10b98122] text-[#10b981] border-[#10b98133]'
      : verdict === 'PARTIALLY_VALIDATED'
        ? 'bg-[#f59e0b22] text-[#f59e0b] border-[#f59e0b33]'
        : 'bg-[#ef444422] text-[#ef4444] border-[#ef444433]';

  const verdictIcon =
    verdict === 'FULLY_VALIDATED' ? '\u2713' : verdict === 'PARTIALLY_VALIDATED' ? '~' : '\u2717';

  const verdictLabel =
    verdict === 'FULLY_VALIDATED'
      ? 'Fully Validated'
      : verdict === 'PARTIALLY_VALIDATED'
        ? 'Partially Validated'
        : 'Failed';

  return (
    <div className="bg-void border border-bdr rounded-[5px] p-3 mt-2">
      {/* Verdict badge */}
      <div
        className={cn(
          'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold tracking-wider mb-3 border',
          verdictColor,
        )}
      >
        <span className="text-base">{verdictIcon}</span>
        {verdictLabel}
      </div>

      {/* Mini stats */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { value: totalCost !== undefined ? `$${totalCost.toFixed(2)}` : '-', label: 'Cost' },
          { value: overheadPct !== undefined ? `${overheadPct}%` : '-', label: 'Overhead' },
          { value: interventions !== undefined ? String(interventions) : '-', label: 'Interventions' },
          { value: durationMin !== undefined ? `${durationMin}m` : '-', label: 'Duration' },
        ].map((s, i) => (
          <div key={i} className="text-center bg-[#ffffff06] rounded-[3px] py-1.5 px-1">
            <div className="font-mono text-sm font-bold text-txt">{s.value}</div>
            <div className="text-[9px] text-[#64748b] uppercase tracking-wider mt-0.5">
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Export ──

export interface StructuredCardProps {
  card: StructuredCardType;
}

export function StructuredCard({ card }: StructuredCardProps) {
  switch (card.type) {
    case 'feature-spec':
      return <FeatureSpecCard data={card.data} />;
    case 'commission-plan':
      return <CommissionPlanCard data={card.data} />;
    case 'review-findings':
      return <ReviewFindingsCard data={card.data} />;
    case 'debate-decision':
      return <DebateDecisionCard data={card.data} />;
    case 'evidence-report':
      return <EvidenceReportCard data={card.data} />;
    default:
      return null;
  }
}
