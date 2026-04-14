/**
 * CheckpointPort — Pipeline state persistence for the Build Orchestrator.
 *
 * Saves and loads pipeline checkpoints at phase boundaries so builds
 * can resume after crashes, restarts, or deliberate pauses.
 *
 * PRD-057 / S2 §14 Q1: Interface moves to @method/runtime/ports; the
 * FS-backed implementation stays in bridge.
 *
 * @see PRD 047 — Build Orchestrator §Surfaces
 */

// ── Port Interface ──

export interface CheckpointPort {
  /** Save pipeline state at a phase boundary. */
  save(sessionId: string, checkpoint: PipelineCheckpoint): Promise<void>;
  /** Load the most recent checkpoint for a session, or null if none. */
  load(sessionId: string): Promise<PipelineCheckpoint | null>;
  /** List all checkpoints (for dashboard build list). */
  list(): Promise<PipelineCheckpointSummary[]>;
}

// ── Types ──

export interface PipelineCheckpointSummary {
  readonly sessionId: string;
  readonly phase: Phase;
  readonly requirement: string;
  readonly costAccumulator: { tokens: number; usd: number };
  readonly savedAt: string;
}

export interface PipelineCheckpoint {
  readonly sessionId: string;
  readonly phase: Phase;
  readonly completedStrategies: readonly string[];
  readonly artifactManifest: Record<string, string>;
  readonly featureSpec?: FeatureSpec;
  readonly costAccumulator: { tokens: number; usd: number };
  readonly conversationHistory: readonly ConversationMessage[];
  readonly savedAt: string;
}

export type Phase =
  | "explore"
  | "specify"
  | "design"
  | "plan"
  | "implement"
  | "review"
  | "validate"
  | "measure"
  | "completed";

export interface FeatureSpec {
  readonly requirement: string;
  readonly problem: string;
  readonly criteria: readonly TestableAssertion[];
  readonly scope: { in: string[]; out: string[] };
  readonly constraints: string[];
}

export interface TestableAssertion {
  readonly name: string;
  readonly type: "command" | "grep" | "endpoint" | "typescript" | "custom";
  readonly check: string;
  readonly expect: string;
}

export interface ConversationMessage {
  readonly id: string;
  readonly sender: "agent" | "human" | "system";
  readonly content: string;
  readonly timestamp: string;
  readonly replyTo?: string;
  readonly card?: unknown;
}
