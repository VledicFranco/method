/**
 * Build domain types — mirrors backend build orchestrator types.
 *
 * @see PRD 047 — Build Orchestrator
 */

export type Phase =
  | 'explore'
  | 'specify'
  | 'design'
  | 'plan'
  | 'implement'
  | 'review'
  | 'validate'
  | 'measure'
  | 'completed';

export const PHASES: Phase[] = [
  'explore',
  'specify',
  'design',
  'plan',
  'implement',
  'review',
  'validate',
  'measure',
];

export const PHASE_LABELS: Record<Phase, string> = {
  explore: 'Explore',
  specify: 'Specify',
  design: 'Design',
  plan: 'Plan',
  implement: 'Implement',
  review: 'Review',
  validate: 'Validate',
  measure: 'Measure',
  completed: 'Complete',
};

export type PhaseStatus =
  | 'completed'
  | 'running'
  | 'waiting'
  | 'failed'
  | 'recovered'
  | 'future';

export type BuildStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'paused';

export type AutonomyLevel = 'discuss-all' | 'auto-routine' | 'full-auto';

export type Verdict = 'FULLY_VALIDATED' | 'PARTIALLY_VALIDATED' | 'FAILED';

export interface PhaseInfo {
  readonly phase: Phase;
  readonly status: PhaseStatus;
  /** Duration in minutes (undefined for future phases) */
  readonly durationMin?: number;
  /** Retry count if recovered */
  readonly retryCount?: number;
}

export interface GanttBar {
  readonly phase: Phase;
  readonly label: string;
  readonly leftPct: number;
  readonly widthPct: number;
  readonly status: 'completed' | 'running' | 'waiting' | 'future' | 'gate';
  /** For stacked bars (parallel commissions) */
  readonly stack?: number;
  readonly tooltip?: string;
}

export interface Commission {
  readonly id: string;
  readonly name: string;
  readonly progressPct: number;
  readonly status: 'completed' | 'running' | 'retrying' | 'failed' | 'pending';
  readonly activity?: string;
}

export interface TestableAssertion {
  readonly name: string;
  readonly status: 'pending' | 'passed' | 'failed';
  readonly evidence?: string;
}

export interface FailureRecovery {
  readonly commissionId: string;
  readonly commissionName: string;
  readonly gateName: string;
  readonly description: string;
  readonly recovery: string;
}

export interface EvidenceStats {
  readonly totalCost: number;
  readonly overheadPct: number;
  readonly interventions: number;
  readonly durationMin: number;
  readonly failureRecoveries: number;
}

export interface Refinement {
  readonly target: 'strategy' | 'gate' | 'orchestrator' | 'bridge';
  readonly description: string;
  readonly frequency: string;
}

export interface BuildEvent {
  readonly time: string;
  readonly type: string;
  readonly target: string;
  readonly detail: string;
  readonly category?: 'failure' | 'recovery' | 'gate' | 'system';
}

export interface BuildSummary {
  readonly id: string;
  readonly name: string;
  readonly requirement: string;
  readonly status: BuildStatus;
  readonly currentPhase: Phase;
  readonly phases: PhaseInfo[];
  readonly costUsd: number;
  readonly budgetUsd: number;
  readonly commissions: Commission[];
  readonly criteria: TestableAssertion[];
  readonly failures: FailureRecovery[];
  readonly events: BuildEvent[];
  readonly gantt: GanttBar[];
  readonly autonomy: AutonomyLevel;
  readonly verdict?: Verdict;
  readonly evidence?: EvidenceStats;
  readonly refinements: Refinement[];
  /** Per-phase cost breakdown (phase name -> USD) */
  readonly phaseCosts?: Record<string, number>;
  /** Conversation messages for the build's chat panel */
  readonly conversation?: ConversationMessage[];
  /** Active gate type (if any) */
  readonly activeGate?: GateType;
}

// ── Conversation Types ──

export type MessageSender = 'agent' | 'human' | 'system';

export type GateType = 'specify' | 'design' | 'plan' | 'review' | 'escalation';

export type StructuredCardType =
  | 'feature-spec'
  | 'commission-plan'
  | 'review-findings'
  | 'debate-decision'
  | 'evidence-report';

export interface StructuredCard {
  readonly type: StructuredCardType;
  readonly data: Record<string, unknown>;
}

export interface ConversationMessage {
  readonly id: string;
  readonly sender: MessageSender;
  readonly content: string;
  readonly timestamp: string;
  readonly replyTo?: string;
  readonly card?: StructuredCard;
}

/** Per-gate action button definitions */
export const GATE_ACTIONS: Record<GateType, readonly string[]> = {
  specify: ['Approve Spec'],
  design: ['Approve Design'],
  plan: ['Approve Plan'],
  review: ['Approve', 'Approve with Comments', 'Request Changes'],
  escalation: ['Retry with Direction', 'Fix Manually', 'Abort'],
} as const;

export type SkillType = 'debate' | 'review' | 'surface';
