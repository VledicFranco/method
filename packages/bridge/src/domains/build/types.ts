/**
 * Build Orchestrator domain types.
 *
 * @see PRD 047 — Build Orchestrator
 */

import type { Phase, FeatureSpec, TestableAssertion } from '../../ports/checkpoint.js';

// Re-export port types used throughout the domain
export type { Phase, FeatureSpec, TestableAssertion, PipelineCheckpoint, PipelineCheckpointSummary, ConversationMessage } from '../../ports/checkpoint.js';
export type { GateType, GateDecision, AgentMessage, HumanMessage, SkillRequest, StructuredCard } from '../../ports/conversation.js';

// ── Exploration ──

export interface ExplorationReport {
  readonly domains: readonly string[];
  readonly patterns: readonly string[];
  readonly constraints: readonly string[];
  readonly approach: string;
  readonly debateDecision?: string;
}

// ── Validation ──

export interface ValidationReport {
  readonly criteria: readonly CriterionResult[];
  readonly allPassed: boolean;
}

export interface CriterionResult {
  readonly name: string;
  readonly type: TestableAssertion['type'];
  readonly passed: boolean;
  readonly evidence: string;
}

// ── Evidence ──

export interface EvidenceReport {
  readonly requirement: string;
  readonly phases: readonly PhaseResult[];
  readonly validation: {
    readonly criteriaTotal: number;
    readonly criteriaPassed: number;
    readonly criteriaFailed: number;
    readonly details: readonly CriterionResult[];
  };
  readonly delivery: {
    readonly totalCost: { tokens: number; usd: number };
    readonly orchestratorCost: { tokens: number; usd: number };
    readonly overheadPercent: number;
    readonly wallClockMs: number;
    readonly humanInterventions: number;
    readonly failureRecoveries: { attempted: number; succeeded: number };
  };
  readonly verdict: "fully_validated" | "partially_validated" | "validation_failed";
  readonly artifacts: Record<string, string>;
  readonly refinements: readonly Refinement[];
}

// ── Refinement ──

export interface Refinement {
  readonly target: "product" | "strategy" | "gate" | "bridge" | "pacta" | "orchestrator";
  readonly observation: string;
  readonly proposal: string;
  readonly evidence: string;
  readonly frequency?: number;
}

// ── Phase Result ──

export interface PhaseResult {
  readonly phase: Phase;
  readonly strategyId?: string;
  readonly executionId?: string;
  readonly status: "completed" | "failed" | "skipped";
  readonly cost: { tokens: number; usd: number };
  readonly durationMs: number;
  readonly retries: number;
  readonly failureContext?: string;
}

// ── Build State ──

export type AutonomyLevel = "discuss-all" | "auto-routine" | "full-auto";

export type BuildStatus = "running" | "waiting" | "completed" | "failed" | "paused" | "aborted";

export interface BuildState {
  readonly id: string;
  readonly requirement: string;
  readonly phase: Phase;
  readonly status: BuildStatus;
  readonly autonomyLevel: AutonomyLevel;
  readonly featureSpec?: FeatureSpec;
  readonly phases: readonly PhaseResult[];
  readonly costAccumulator: { tokens: number; usd: number };
  readonly budget: { maxTokens: number; maxCostUsd: number };
  readonly startedAt: string;
  readonly completedAt?: string;
}
