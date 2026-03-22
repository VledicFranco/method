/**
 * Shared enums and literal union types used across @method packages.
 *
 * These are string unions that appear identically in core, methodts, and bridge.
 * Zero runtime cost — erased at compile time.
 */

/** Methodology session lifecycle status. */
export type MethodologySessionStatus =
  | "initialized"
  | "routing"
  | "executing"
  | "transitioning"
  | "completed"
  | "failed";

/** Global objective satisfaction status. */
export type GlobalObjectiveStatus = "in_progress" | "satisfied" | "failed";

/** Methodology/strategy execution outcome. */
export type ExecutionStatus = "completed" | "safety_violation" | "failed" | "aborted";

/** Step execution mode — agent (LLM) or script (TypeScript). */
export type StepExecutionTag = "agent" | "script";

/** Session transport mode. */
export type SessionMode = "pty" | "print";

/** Worktree isolation mode. */
export type IsolationMode = "worktree" | "shared";

/** What to do with a worktree after the session completes. */
export type WorktreeAction = "merge" | "keep" | "discard";

/** Gate classification. */
export type GateType = "algorithmic" | "observation" | "human_approval";

/** Validation finding severity. */
export type ValidationSeverity = "error" | "warning" | "info";

/** Method compilation status (registry). */
export type CompilationStatus = "proposed" | "compiled" | "deprecated";

/** Gap severity levels. */
export type GapSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
