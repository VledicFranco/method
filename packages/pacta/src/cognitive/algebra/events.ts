// SPDX-License-Identifier: Apache-2.0
/**
 * Cognitive Events — typed lifecycle signals for the cognitive composition system.
 *
 * These are algebra-local event types. They model cognitive-specific signals
 * (module steps, monitoring, workspace writes, cycle phases) that are distinct
 * from the base AgentEvent vocabulary in pacta/events.ts.
 *
 * Each event uses a 'type' discriminant for exhaustive matching.
 */

import type { ModuleId, MonitoringSignal, ControlDirective, StepError } from './module.js';
import type { WorkspaceEntry } from './workspace-types.js';

// ── Cognitive Event Union ────────────────────────────────────────

export type CognitiveEvent =
  | CognitiveModuleStep
  | CognitiveMonitoringSignal
  | CognitiveControlDirective
  | CognitiveControlPolicyViolation
  | CognitiveWorkspaceWrite
  | CognitiveWorkspaceEviction
  | CognitiveCyclePhase
  | CognitiveLEARNFailed
  | CognitiveCycleAborted
  | CognitiveConstraintPinned
  | CognitiveConstraintViolation
  | CognitiveMonitorDirectiveApplied;

// ── Individual Event Types ───────────────────────────────────────

/** Emitted after a cognitive module completes a step. */
export interface CognitiveModuleStep {
  type: 'cognitive:module_step';
  moduleId: ModuleId;
  phase: string;
  durationMs: number;
  hasError: boolean;
  timestamp: number;
}

/** Emitted when a module produces a monitoring signal. */
export interface CognitiveMonitoringSignal {
  type: 'cognitive:monitoring_signal';
  signal: MonitoringSignal;
  timestamp: number;
}

/** Emitted when a control directive is issued by the meta-level. */
export interface CognitiveControlDirective {
  type: 'cognitive:control_directive';
  directive: ControlDirective;
  timestamp: number;
}

/** Emitted when a control directive is rejected by the policy. */
export interface CognitiveControlPolicyViolation {
  type: 'cognitive:control_policy_violation';
  directive: ControlDirective;
  reason: string;
  timestamp: number;
}

/** Emitted when a module writes to the workspace. */
export interface CognitiveWorkspaceWrite {
  type: 'cognitive:workspace_write';
  entry: WorkspaceEntry;
  timestamp: number;
}

/** Emitted when an entry is evicted from the workspace due to capacity or TTL. */
export interface CognitiveWorkspaceEviction {
  type: 'cognitive:workspace_eviction';
  entry: WorkspaceEntry;
  reason: 'capacity' | 'ttl';
  timestamp: number;
}

/** Emitted at the start of each cognitive cycle phase. */
export interface CognitiveCyclePhase {
  type: 'cognitive:cycle_phase';
  phase: string;
  cycleNumber: number;
  timestamp: number;
}

/** Emitted when the LEARN phase fails (fire-and-forget with state-lock rollback). */
export interface CognitiveLEARNFailed {
  type: 'cognitive:learn_failed';
  error: StepError;
  cycleNumber: number;
  timestamp: number;
}

/** Emitted when a cognitive cycle is aborted due to unrecoverable error or budget. */
export interface CognitiveCycleAborted {
  type: 'cognitive:cycle_aborted';
  reason: string;
  phase: string;
  cycleNumber: number;
  timestamp: number;
}

// ── Diagnostic Event Types (PRD 043) ────────────────────────────

/** Emitted when a workspace entry is classified as a constraint and pinned. */
export interface CognitiveConstraintPinned {
  type: 'cognitive:constraint_pinned';
  content: string;
  matchedPatterns: string[];
  pinnedCount: number;
  timestamp: number;
}

/** Emitted when actor output violates a pinned constraint. */
export interface CognitiveConstraintViolation {
  type: 'cognitive:constraint_violation';
  constraint: string;
  violation: string;
  pattern: string;
  timestamp: number;
}

/** Emitted when monitor or constraint-violation recovery applies a directive. */
export interface CognitiveMonitorDirectiveApplied {
  type: 'cognitive:monitor_directive_applied';
  restrictedActions: string[];
  forceReplan: boolean;
  source: 'monitor' | 'constraint-violation';
  targetModule: string;
  timestamp: number;
}
