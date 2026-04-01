/**
 * PRD-044 C-4: GateApprovalPanel — human-approval gate decision UI.
 *
 * Renders the artifact for review via GlyphReport, shows gate metadata and a
 * countdown timer, and presents three action buttons: Approve, Reject, and
 * Request Changes. Reject / Request Changes reveal a feedback textarea before
 * the response is sent. On submission the panel serialises a
 * StrategyGateApprovalResponsePayload and publishes it to the bridge via
 * wsManager.send().
 */

import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, MessageSquare, Timer } from 'lucide-react';
import { GlyphReport } from '@/domains/reports/index';
import { wsManager } from '@/shared/websocket/ws-manager';
import { Card } from '@/shared/components/Card';
import { Button } from '@/shared/components/Button';
import { Badge } from '@/shared/components/Badge';
import { cn } from '@/shared/lib/cn';

// ── Payload types (mirrors packages/bridge/src/ports/event-bus.ts) ──

export interface GateAwaitingApprovalData {
  strategy_id: string;
  execution_id: string;
  gate_id: string;
  node_id: string;
  artifact_markdown: string;
  artifact_type: 'surface_record' | 'prd' | 'plan' | 'review_report' | 'custom';
  timeout_ms: number;
}

// ── Countdown hook ──────────────────────────────────────────────

function useCountdown(timeoutMs: number): number | null {
  const [remaining, setRemaining] = useState<number | null>(
    timeoutMs > 0 ? Math.ceil(timeoutMs / 1000) : null,
  );

  useEffect(() => {
    if (timeoutMs <= 0) return;

    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timeoutMs]);

  return remaining;
}

// ── Feedback input ──────────────────────────────────────────────

interface FeedbackFormProps {
  placeholder: string;
  onSubmit: (feedback: string) => void;
  onCancel: () => void;
  submitLabel: string;
  submitVariant: 'error' | 'primary';
}

function FeedbackForm({
  placeholder,
  onSubmit,
  onCancel,
  submitLabel,
  submitVariant,
}: FeedbackFormProps) {
  const [feedback, setFeedback] = useState('');

  return (
    <div className="mt-sp-4 space-y-sp-3">
      <textarea
        className={cn(
          'w-full rounded-card border border-bdr bg-void px-sp-3 py-sp-2',
          'text-sm text-txt font-mono resize-none placeholder:text-txt-muted',
          'focus:outline-none focus:border-bio/50 transition-colors',
        )}
        rows={4}
        placeholder={placeholder}
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        autoFocus
      />
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant={submitVariant === 'error' ? 'secondary' : 'primary'}
          size="sm"
          onClick={() => onSubmit(feedback)}
          className={submitVariant === 'error' ? 'border-error/30 text-error hover:bg-error-dim' : ''}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────

export interface GateApprovalPanelProps {
  gate: GateAwaitingApprovalData;
  className?: string;
}

type ActionState = 'idle' | 'rejecting' | 'requesting_changes' | 'submitted';

export function GateApprovalPanel({ gate, className }: GateApprovalPanelProps) {
  const [actionState, setActionState] = useState<ActionState>('idle');
  const [submittedDecision, setSubmittedDecision] = useState<string | null>(null);

  const remainingSeconds = useCountdown(gate.timeout_ms);

  const sendDecision = useCallback(
    (decision: 'approved' | 'rejected' | 'changes_requested', feedback?: string) => {
      const payload: Record<string, unknown> = {
        type: 'event',
        domain: 'strategy',
        event_type: 'gate.approval_response',
        payload: {
          execution_id: gate.execution_id,
          gate_id: gate.gate_id,
          decision,
          ...(feedback ? { feedback } : {}),
        },
      };
      wsManager.send(payload);
      setSubmittedDecision(decision);
      setActionState('submitted');
    },
    [gate.execution_id, gate.gate_id],
  );

  const handleApprove = useCallback(() => {
    sendDecision('approved');
  }, [sendDecision]);

  const handleRejectSubmit = useCallback(
    (feedback: string) => {
      sendDecision('rejected', feedback || undefined);
    },
    [sendDecision],
  );

  const handleChangesSubmit = useCallback(
    (feedback: string) => {
      sendDecision('changes_requested', feedback || undefined);
    },
    [sendDecision],
  );

  const artifactTypeLabel: Record<GateAwaitingApprovalData['artifact_type'], string> = {
    surface_record: 'Surface Record',
    prd: 'PRD',
    plan: 'Plan',
    review_report: 'Review Report',
    custom: 'Artifact',
  };

  return (
    <Card accent="solar" className={cn('space-y-sp-4', className)}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-sp-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="solar" label="AWAITING APPROVAL" size="sm" />
            <Badge
              variant="muted"
              label={artifactTypeLabel[gate.artifact_type] ?? gate.artifact_type}
              size="sm"
            />
          </div>
          <div className="flex items-center gap-sp-4 mt-sp-2 font-mono text-[0.65rem] text-txt-muted">
            <span>
              strategy: <span className="text-bio">{gate.strategy_id}</span>
            </span>
            <span>
              node: <span className="text-txt">{gate.node_id}</span>
            </span>
            <span>
              gate: <span className="text-txt">{gate.gate_id}</span>
            </span>
          </div>
        </div>

        {/* Countdown */}
        {remainingSeconds !== null && remainingSeconds > 0 && actionState !== 'submitted' && (
          <div className="flex items-center gap-1 shrink-0">
            <Timer className="h-3.5 w-3.5 text-solar" />
            <span className="font-mono text-xs text-solar tabular-nums">
              {Math.floor(remainingSeconds / 60)}:
              {String(remainingSeconds % 60).padStart(2, '0')}
            </span>
          </div>
        )}
        {remainingSeconds === 0 && actionState !== 'submitted' && (
          <Badge variant="error" label="TIMED OUT" size="sm" />
        )}
      </div>

      {/* Artifact */}
      <div className="rounded-card border border-bdr bg-void overflow-auto max-h-[60vh]">
        <GlyphReport
          markdown={gate.artifact_markdown}
          layout="document"
          fallback={
            <pre className="text-[0.75rem] text-txt-dim font-mono whitespace-pre-wrap leading-relaxed p-sp-4">
              {gate.artifact_markdown}
            </pre>
          }
          className="p-sp-4"
        />
      </div>

      {/* Actions */}
      {actionState === 'submitted' ? (
        <div
          className={cn(
            'flex items-center gap-2 px-sp-3 py-sp-2 rounded-lg text-sm font-medium',
            submittedDecision === 'approved'
              ? 'bg-bio/10 text-bio border border-bio/20'
              : 'bg-solar/10 text-solar border border-solar/20',
          )}
        >
          {submittedDecision === 'approved' ? (
            <CheckCircle className="h-4 w-4" />
          ) : (
            <XCircle className="h-4 w-4" />
          )}
          Decision sent:{' '}
          <span className="font-mono">
            {submittedDecision?.replace('_', ' ')}
          </span>
        </div>
      ) : actionState === 'rejecting' ? (
        <FeedbackForm
          placeholder="Optional: explain why this is being rejected..."
          onSubmit={handleRejectSubmit}
          onCancel={() => setActionState('idle')}
          submitLabel="Confirm Reject"
          submitVariant="error"
        />
      ) : actionState === 'requesting_changes' ? (
        <FeedbackForm
          placeholder="Describe what changes are needed..."
          onSubmit={handleChangesSubmit}
          onCancel={() => setActionState('idle')}
          submitLabel="Request Changes"
          submitVariant="primary"
        />
      ) : (
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            leftIcon={<CheckCircle className="h-3.5 w-3.5" />}
            onClick={handleApprove}
          >
            Approve
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<MessageSquare className="h-3.5 w-3.5" />}
            onClick={() => setActionState('requesting_changes')}
          >
            Request Changes
          </Button>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<XCircle className="h-3.5 w-3.5" />}
            onClick={() => setActionState('rejecting')}
            className="text-error hover:text-error hover:bg-error-dim"
          >
            Reject
          </Button>
        </div>
      )}
    </Card>
  );
}
